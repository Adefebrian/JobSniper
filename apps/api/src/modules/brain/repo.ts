import type { DecisionInput, DecisionVerdict, Evidence, JobStatus, ScoreBreakdown } from "../../core/domain";
import type { Queryable } from "../../core/ports/database";
import type { LlmUsage } from "../../core/ports/ai";
import type { JobFilters } from "./service";

export type JobRow = Record<string, unknown> & { id: string };

export class BrainRepository {
  constructor(private readonly database: Queryable) {}

  async getJob(id: string): Promise<JobRow | undefined> {
    const result = await this.database.query<JobRow>(
      "SELECT * FROM jobs WHERE id = $1",
      [id],
    );
    return result.rows[0];
  }

  async updateJudgment(input: {
    id: string;
    status: JobStatus;
    aiEvidence: Evidence[];
    languageEvidence: Evidence[];
    score: number;
    scoreBreakdown: ScoreBreakdown;
    skipReason: string | null;
  }): Promise<void> {
    await this.database.query(
      `UPDATE jobs
       SET status = $2, ai_evidence = $3::jsonb, language_evidence = $4::jsonb,
           score = $5, score_breakdown = $6::jsonb, skip_reason = $7, updated_at = now()
       WHERE id = $1`,
      [
        input.id,
        input.status,
        JSON.stringify(input.aiEvidence),
        JSON.stringify(input.languageEvidence),
        input.score,
        JSON.stringify(input.scoreBreakdown),
        input.skipReason,
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
      add("j.first_seen_at >= now() - ($? * interval '1 hour')", filters.maxAgeHours);
    }
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
