import type { DecisionInput, DecisionVerdict, Evidence, JobStatus, ScoreBreakdown } from "@core/domain";
import type { Queryable } from "@core/ports/database";
import type { LlmUsage } from "@core/ports/ai";
import type { JobFilters } from "./service";

export type JobRow = Record<string, unknown> & { id: string };

export class BrainRepository {
  constructor(private readonly database: Queryable) {}

  async getJob(id: string): Promise<JobRow | undefined> {
    const result = await this.database.query<JobRow>(
      `SELECT j.*, c.name AS company_name, c.domain AS company_domain,
              EXISTS (SELECT 1 FROM do_not_contact d
                      WHERE d.email_or_domain IN (coalesce(c.domain, ''), 'company:' || lower(c.name))) AS company_blacklisted
       FROM jobs j JOIN companies c ON c.id = j.company_id
       WHERE j.id = $1`,
      [id],
    );
    return result.rows[0];
  }

  /** A job no source has listed for 14 days is treated as closed (feeds never announce closures). */
  async expireStale(): Promise<number> {
    const result = await this.database.query(
      `UPDATE jobs SET closed_at = now(), status = 'closed', updated_at = now()
       WHERE closed_at IS NULL AND last_seen_at < now() - interval '14 days'
         AND status NOT IN ('sent', 'replied')`,
    );
    return result.rowCount;
  }

  /** Recent likes and dislikes with what the job was about: Jev's examples and the local model's data. */
  async feedbackExamples(limitPerSide: number) {
    const result = await this.database.query<{ verdict: "like" | "dislike"; title: string; company: string; evidence: string; note: string | null }>(
      `SELECT * FROM (
         SELECT f.verdict, j.title, c.name AS company,
                coalesce((SELECT string_agg(e->>'quote', ' | ') FROM jsonb_array_elements(j.ai_evidence) e), '') AS evidence,
                f.note, f.created_at,
                row_number() OVER (PARTITION BY f.verdict ORDER BY f.created_at DESC) AS rn
         FROM job_feedback f JOIN jobs j ON j.id = f.job_id JOIN companies c ON c.id = j.company_id
       ) x WHERE rn <= $1`,
      [limitPerSide],
    );
    return result.rows.map((r) => ({ verdict: r.verdict, title: r.title, company: r.company, evidence: r.evidence.slice(0, 400), note: r.note }));
  }

  async feedbackFor(jobId: string): Promise<"like" | "dislike" | null> {
    const result = await this.database.query<{ verdict: "like" | "dislike" }>("SELECT verdict FROM job_feedback WHERE job_id = $1", [jobId]);
    return result.rows[0]?.verdict ?? null;
  }

  async setApply(id: string, apply: { email: string; quote: string } | null): Promise<void> {
    await this.database.query(
      `UPDATE jobs SET apply_method = CASE WHEN $2::text IS NULL THEN (CASE WHEN apply_method = 'email' THEN 'unknown' ELSE apply_method END) ELSE 'email' END,
                       apply_email = $2, apply_quote = $3 WHERE id = $1`,
      [id, apply?.email ?? null, apply?.quote ?? null],
    );
    if (apply) {
      await this.database.query(
        `INSERT INTO contacts (id, company_id, job_id, email, role, kind, source_url, source_quote)
         SELECT gen_random_uuid(), j.company_id, j.id, $2, 'apply',
                CASE WHEN s.trust = 'public_listing' THEN 'portal_public' ELSE 'public' END, j.url, $3
         FROM jobs j LEFT JOIN sources s ON s.id = j.source_id
         WHERE j.id = $1
           AND NOT EXISTS (SELECT 1 FROM do_not_contact d WHERE d.email_or_domain IN (lower($2), split_part(lower($2), '@', 2)))
         ON CONFLICT DO NOTHING`,
        [id, apply.email, apply.quote],
      );
      await this.database.query("UPDATE contacts SET role = 'apply' WHERE job_id = $1 AND lower(email) = lower($2)", [id, apply.email]);
    }
  }

  async setFocus(id: string, agenticFocus: number, preferenceFit: number | null): Promise<void> {
    await this.database.query(
      "UPDATE jobs SET agentic_focus = $2, preference_fit = $3, needs_rescore = false WHERE id = $1",
      [id, agenticFocus, preferenceFit],
    );
  }

  /** Jobs to judge now: new, retry-due, or targeted but still waiting for Jev. */
  async judgeQueue(limit: number): Promise<string[]> {
    const result = await this.database.query<{ id: string }>(
      `SELECT id FROM jobs
       WHERE closed_at IS NULL AND next_judge_at <= now()
         AND (status IN ('new', 'unverified', 'pending_judge') OR (status = 'targeted' AND (NOT jev_verified OR needs_rescore)))
       ORDER BY needs_rescore DESC, coalesce(posted_at, first_seen_at) DESC
       LIMIT $1`,
      [limit],
    );
    return result.rows.map((row) => row.id);
  }

  async park(id: string, status: "pending_judge" | "unverified", reason: string, minutes: number): Promise<void> {
    await this.database.query(
      `UPDATE jobs SET status = $2, skip_reason = $3, next_judge_at = now() + ($4 * interval '1 minute'), updated_at = now()
       WHERE id = $1`,
      [id, status, reason, minutes],
    );
  }

  async scheduleRejudge(id: string, minutes: number): Promise<void> {
    await this.database.query(
      "UPDATE jobs SET next_judge_at = now() + ($2 * interval '1 minute') WHERE id = $1",
      [id, minutes],
    );
  }

  async updateMeta(id: string, meta: { countries: string[]; workMode: string }): Promise<void> {
    await this.database.query(
      "UPDATE jobs SET countries = $2::text[], work_mode = $3 WHERE id = $1",
      [id, meta.countries, meta.workMode],
    );
  }

  async setEnglishText(id: string, text: string): Promise<void> {
    await this.database.query("UPDATE jobs SET jd_text_english = $2 WHERE id = $1", [id, text]);
  }

  async updateClassification(id: string, c: { remoteScope: string; sponsorship: string; seniority: string; language: string }) {
    await this.database.query(
      "UPDATE jobs SET remote_scope = $2, sponsorship = $3, seniority = $4, language = $5 WHERE id = $1",
      [id, c.remoteScope, c.sponsorship, c.seniority, c.language],
    );
  }

  /** Stores public emails quoted from the job's own text (PRD 8.1). Never guesses an address. */
  async insertPublicContacts(jobId: string, contacts: Array<{ email: string; quote: string; verdict: unknown }>): Promise<void> {
    for (const c of contacts) {
      await this.database.query(
        `INSERT INTO contacts (id, company_id, job_id, email, kind, source_url, source_quote, jev_verdict)
         SELECT gen_random_uuid(), j.company_id, j.id, $2,
                CASE WHEN s.trust = 'public_listing' THEN 'portal_public' ELSE 'public' END,
                j.url, $3, $4::jsonb
         FROM jobs j LEFT JOIN sources s ON s.id = j.source_id
         WHERE j.id = $1
           AND NOT EXISTS (SELECT 1 FROM do_not_contact d WHERE d.email_or_domain IN (lower($2), split_part(lower($2), '@', 2)))
         ON CONFLICT DO NOTHING`,
        [jobId, c.email.toLowerCase(), c.quote, c.verdict === undefined ? null : JSON.stringify(c.verdict)],
      );
    }
  }

  async blacklistCompanyOf(jobId: string): Promise<void> {
    await this.database.query(
      `UPDATE jobs SET status = 'blacklisted', updated_at = now()
       WHERE company_id = (SELECT company_id FROM jobs WHERE id = $1) AND status IN ('new','targeted','skipped','unverified','pending_judge')`,
      [jobId],
    );
    await this.database.query(
      `INSERT INTO do_not_contact (id, email_or_domain, reason)
       SELECT gen_random_uuid(), coalesce(c.domain, 'company:' || lower(c.name)), 'Blacklisted from dashboard'
       FROM jobs j JOIN companies c ON c.id = j.company_id WHERE j.id = $1
       ON CONFLICT (email_or_domain) DO NOTHING`,
      [jobId],
    );
  }

  async updateJudgment(input: {
    id: string;
    status: JobStatus;
    aiEvidence: Evidence[];
    languageEvidence: Evidence[];
    score: number;
    scoreBreakdown: ScoreBreakdown;
    skipReason: string | null;
    jevVerified?: boolean;
  }): Promise<void> {
    await this.database.query(
      `UPDATE jobs
       SET status = $2, ai_evidence = $3::jsonb, language_evidence = $4::jsonb,
           score = $5, score_breakdown = $6::jsonb, skip_reason = $7,
           jev_verified = coalesce($8, jev_verified), updated_at = now()
       WHERE id = $1`,
      [
        input.id,
        input.status,
        JSON.stringify(input.aiEvidence),
        JSON.stringify(input.languageEvidence),
        input.score,
        JSON.stringify(input.scoreBreakdown),
        input.skipReason,
        input.jevVerified ?? null,
      ],
    );
  }

  async updatePending(id: string, status: "pending_judge" | "unverified", reason: string): Promise<void> {
    await this.database.query(
      "UPDATE jobs SET status = $2, skip_reason = $3, updated_at = now() WHERE id = $1",
      [id, status, reason],
    );
  }

  async insertDecision(input: {
    id: string;
    decisionId: string;
    subjectType: string;
    subjectId: string;
    inputDigest: string;
    input: DecisionInput;
    verdict: DecisionVerdict;
    confidence: number;
  }): Promise<void> {
    await this.database.query(
      `INSERT INTO decisions
       (id, decision_id, subject_type, subject_id, input_digest, input, verdict, confidence)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)`,
      [
        input.id,
        input.decisionId,
        input.subjectType,
        input.subjectId,
        input.inputDigest,
        JSON.stringify(input.input),
        JSON.stringify(input.verdict),
        input.confidence,
      ],
    );
  }

  async listDecisions(jobId: string) {
    const result = await this.database.query(
      `SELECT id, decision_id, subject_type, subject_id, input, verdict, confidence, created_at
       FROM decisions WHERE subject_type = 'job' AND subject_id = $1 ORDER BY created_at`,
      [jobId],
    );
    return result.rows;
  }

  async monthlySpend(now: Date): Promise<number> {
    const result = await this.database.query<{ total: string | number | null }>(
      `SELECT coalesce(sum(cost_usd), 0) AS total FROM llm_usage
       WHERE date_trunc('month', created_at) = date_trunc('month', $1::timestamptz)`,
      [now.toISOString()],
    );
    return Number(result.rows[0]?.total ?? 0);
  }

  async insertUsage(id: string, usage: LlmUsage): Promise<void> {
    await this.database.query(
      `INSERT INTO llm_usage (id, model, purpose, request_id, tokens_in, tokens_out, cost_usd)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, usage.model, usage.purpose, usage.requestId, usage.tokensIn, usage.tokensOut, usage.costUsd],
    );
  }

  async databaseCounts(): Promise<Record<string, number>> {
    const result = await this.database.query<{ pending_judge: string; unverified: string }>(
      `SELECT
         count(*) FILTER (WHERE status = 'pending_judge')::text AS pending_judge,
         count(*) FILTER (WHERE status = 'unverified')::text AS unverified
       FROM jobs`,
    );
    const row = result.rows[0];
    return {
      pendingJudge: Number(row?.pending_judge ?? 0),
      unverified: Number(row?.unverified ?? 0),
    };
  }

  async listJobs(filters: JobFilters): Promise<Record<string, unknown>> {
    const conditions: string[] = ["1 = 1"];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      conditions.push(sql.replace("$?", `$${params.length}`));
    };
    if (filters.status) add("j.status = $?", filters.status);
    if (filters.country) add("$? = ANY(j.countries)", filters.country);
    if (filters.workMode) add("j.work_mode = $?", filters.workMode);
    if (filters.sponsorship) add("j.sponsorship = $?", filters.sponsorship);
    if (filters.hasEmail === "true") {
      conditions.push("EXISTS (SELECT 1 FROM contacts c WHERE c.job_id = j.id AND c.invalid_at IS NULL)");
    }
    if (filters.hasEmail === "false") {
      conditions.push("NOT EXISTS (SELECT 1 FROM contacts c WHERE c.job_id = j.id AND c.invalid_at IS NULL)");
    }
    if (filters.maxAgeHours) {
      add("coalesce(j.posted_at, j.first_seen_at) >= now() - ($? * interval '1 hour')", filters.maxAgeHours);
    }
    if (!filters.status || filters.status === "targeted") conditions.push("j.closed_at IS NULL");
    const where = conditions.join(" AND ");
    const countResult = await this.database.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM jobs j WHERE ${where}`,
      params,
    );
    const offset = (filters.page - 1) * filters.perPage;
    const result = await this.database.query(
      `SELECT j.*, c.name AS company_name, c.domain AS company_domain,
              EXISTS (SELECT 1 FROM contacts x WHERE x.job_id = j.id AND x.invalid_at IS NULL) AS has_email
       FROM jobs j JOIN companies c ON c.id = j.company_id
       WHERE ${where}
       ORDER BY j.score DESC NULLS LAST, j.first_seen_at DESC
       LIMIT ${filters.perPage} OFFSET ${offset}`,
      params,
    );
    return {
      items: result.rows,
      page: filters.page,
      perPage: filters.perPage,
      total: Number(countResult.rows[0]?.total ?? 0),
    };
  }
}
