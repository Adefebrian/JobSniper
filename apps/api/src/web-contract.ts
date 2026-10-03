// The dashboard's API contract (apps/web/src/types.ts) mapped onto the real services.
// /dashboard serves everything the SPA filters client-side; /targets/* serves detail and actions.
import type { Hono } from "hono";
import { ApiError, ok, requireObject } from "./core/http";
import type { Queryable } from "./core/ports/database";
import type { LlmUsage, LunaPort, TailoredCv } from "./core/ports/ai";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

type Services = {
  database: Queryable;
  draft(jobId: string, contactId?: string): Promise<unknown>;
  dashboardStatus(): Promise<Record<string, unknown>>;
  companies(): Promise<unknown[]>;
  sources(): Promise<unknown[]>;
  outreach(): Promise<unknown[]>;
  settings(): Promise<unknown>;
  blacklist(jobId: string): Promise<void>;
  luna: LunaPort;
  recordUsage(usage: LlmUsage): Promise<void>;
  parseProfile(cvText: string): Promise<unknown>;
  budgetLeft(): Promise<boolean>;
};

const CV_DIR = join(homedir(), "Documents", "JobSniper", "CVs");

/** CV file -> plain text with macOS tools only (textutil for docx/doc/rtf/html, Spotlight text for pdf). */
async function cvText(path: string): Promise<string> {
  const full = path.replace(/^~(?=\/)/, homedir());
  if (/\.txt$/i.test(full)) return Bun.file(full).text();
  if (/\.pdf$/i.test(full)) {
    const out = Bun.spawnSync(["mdls", "-raw", "-name", "kMDItemTextContent", full]).stdout.toString();
    if (out.trim().length < 100 || out.trim() === "(null)") throw new ApiError(422, "cv_unreadable", "This PDF has no extractable text. Use the .docx version.");
    return out;
  }
  const proc = Bun.spawnSync(["textutil", "-convert", "txt", "-stdout", full]);
  if (proc.exitCode !== 0) throw new ApiError(422, "cv_unreadable", `Could not read ${path}.`);
  return proc.stdout.toString();
}

const esc = (v: string) => v.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function cvHtml(cv: TailoredCv): string {
  const list = (items: string[]) => `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:Helvetica,Arial,sans-serif;font-size:10.5pt;color:#111418;line-height:1.35}
    h1{font-size:18pt;margin:0}h2{font-size:11pt;margin:14pt 0 4pt;text-transform:none;border-bottom:0}
    p{margin:2pt 0}ul{margin:2pt 0 6pt 16pt;padding:0}.muted{color:#5b6370}</style></head><body>
    <h1>${esc(cv.name)}</h1><p><b>${esc(cv.headline)}</b></p><p class="muted">${cv.contact.map(esc).join(" | ")}</p>
    <h2>Summary</h2><p>${esc(cv.summary)}</p>
    <h2>Skills</h2><p>${cv.skills.map(esc).join(", ")}</p>
    <h2>Experience</h2>${cv.experience.map((e) => `<p><b>${esc(e.role)}</b>, ${esc(e.company)} <span class="muted">${esc(e.period)}</span></p>${list(e.bullets)}`).join("")}
    ${cv.projects.length ? `<h2>Projects</h2>${cv.projects.map((p) => `<p><b>${esc(p.name)}</b></p>${list(p.bullets)}`).join("")}` : ""}
    ${cv.education.length ? `<h2>Education</h2>${list(cv.education)}` : ""}
  </body></html>`;
}

// Skills an AI-SWE role commonly asks for; counted in this week's targets and checked against the CV.
const SKILLS: Array<[string, RegExp]> = [
  ["Python", /\bpython\b/i], ["TypeScript", /\btypescript\b/i], ["JavaScript", /\bjavascript\b/i], ["Go", /\bgolang\b|\bgo\b(?= |,|\))/],
  ["Rust", /\brust\b/i], ["Java", /\bjava\b/i], ["Kotlin", /\bkotlin\b/i], ["C++", /c\+\+/i], ["React", /\breact\b/i],
  ["Next.js", /next\.js/i], ["Node.js", /node\.?js/i], ["Bun", /\bbun\b/i], ["SQL", /\bsql\b/i], ["PostgreSQL", /postgres/i],
  ["Redis", /\bredis\b/i], ["Kafka", /\bkafka\b/i], ["Docker", /\bdocker\b/i], ["Kubernetes", /kubernetes|\bk8s\b/i],
  ["AWS", /\baws\b/i], ["GCP", /\bgcp\b|google cloud/i], ["Azure", /\bazure\b/i], ["Terraform", /terraform/i],
  ["LLMs", /\bllms?\b|large language model/i], ["RAG", /\brag\b|retrieval[- ]augmented/i], ["AI agents", /agentic|ai agents?|\bagents\b/i],
  ["Prompt engineering", /prompt engineering/i], ["Evals", /\bevals?\b|evaluation harness/i], ["Fine-tuning", /fine[- ]tun/i],
  ["PyTorch", /pytorch/i], ["TensorFlow", /tensorflow/i], ["LangChain", /langchain/i], ["Vector DBs", /vector (database|db|store|search)|pinecone|weaviate|pgvector/i],
  ["OpenAI API", /openai/i], ["Anthropic API", /anthropic|claude/i], ["MLOps", /mlops/i], ["GraphQL", /graphql/i],
  ["REST APIs", /\brest(ful)?\b/i], ["Microservices", /microservice/i], ["CI/CD", /ci\/cd|continuous (integration|delivery)/i],
  ["Distributed systems", /distributed systems?/i], ["System design", /system design/i],
];

const slugPart = (v: string) => v.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

const REMOTE: Record<string, string> = {
  remote_global: "global", remote_apac: "apac", remote_restricted: "restricted", onsite: "onsite", unknown: "unknown",
};

type Row = Record<string, unknown>;

/** Quotes stay verbatim except pictographs (JAL UI law: no emoji on screen). */
const noEmoji = (text: string) =>
  text.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "").replace(/\s{2,}/g, " ").trim();

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? new Date(value).toISOString() : "";
}

function contactView(c: Row) {
  const verdict = c.jev_verdict as { value?: unknown } | null;
  return {
    id: String(c.id), name: String(c.name ?? ""), role: String(c.role ?? ""), email: String(c.email),
    kind: c.kind, sourceUrl: String(c.source_url), sourceQuote: String(c.source_quote),
    jevVerdict: c.invalid_at ? "invalid" : verdict?.value === true ? "verified" : verdict?.value === false ? "invalid" : "unverified",
    invalidAt: c.invalid_at ? iso(c.invalid_at) : null,
  };
}

function targetView(j: Row, contacts: Row[], decisions: Row[] = [], fullText = false) {
  const b = (j.score_breakdown ?? {}) as Record<string, number>;
  const text = String(j.jd_text_english ?? j.jd_text ?? "");
  return {
    id: String(j.id), companyId: String(j.company_id), companyName: String(j.company_name ?? ""),
    title: String(j.title), externalId: String(j.external_id ?? ""), location: String(j.location ?? ""),
    country: (j.countries as string[] | null)?.[0] ?? "", countries: j.countries ?? [],
    workMode: j.work_mode === "unknown" ? "onsite" : j.work_mode,
    remoteScope: REMOTE[String(j.remote_scope)] ?? "unknown",
    sponsorship: j.sponsorship === "unknown" && j.sponsor_registry_hit ? "registry_hit" : j.sponsorship,
    seniority: j.seniority, salary: String(j.salary ?? ""),
    postedAt: iso(j.posted_at ?? j.first_seen_at),
    firstSeenAt: iso(j.posted_at ?? j.first_seen_at),
    lastSeenAt: iso(j.last_seen_at),
    sourceUrl: String(j.url), applyUrl: String(j.apply_url ?? j.url),
    status: j.status, score: Math.round(Number(j.score ?? 0)), jevVerified: j.jev_verified === true,
    skipReason: j.skip_reason ?? null,
    scoreBreakdown: {
      roleFit: b.roleFit ?? 0, seniority: b.seniorityWeight ?? 0, modeVisa: b.modeVisaWeight ?? 0,
      freshness: b.freshnessWeight ?? 0, skillOverlapCv: b.skillOverlap ?? 0,
      agenticFocus: j.agentic_focus ?? b.agenticFocus ?? null, preferenceFit: j.preference_fit ?? b.preferenceFit ?? null,
    },
    feedback: (j.feedback as string | null) ?? null,
    applyMethod: j.apply_method ?? "unknown",
    applyEmail: j.apply_email ?? null,
    applyQuote: j.apply_quote ? noEmoji(String(j.apply_quote)) : null,
    newCompany: j.new_company === true,
    newCompanyQuote: j.new_company_quote ? noEmoji(String(j.new_company_quote)) : null,
    source: String(j.source_name ?? ""),
    tailoredCv: j.tailored_cv ?? null,
    aiEvidence: ((j.ai_evidence as Array<{ quote: string; reason?: string; source?: string }>) ?? [])
      .map((e) => ({ quote: noEmoji(e.quote), context: e.source === "title" ? "Job title" : e.reason ?? "Job description" })),
    languageEvidence: ((j.language_evidence as Array<{ quote: string }>) ?? []).map((e) => ({ quote: noEmoji(e.quote) })),
    jdText: noEmoji(fullText ? text : text.slice(0, 6_000)),
    translated: Boolean(j.jd_text_english),
    contacts: contacts.map(contactView),
    decisions: decisions.map((d) => ({
      id: String(d.id), decisionId: d.decision_id, subjectType: d.subject_type, subjectId: String(d.subject_id),
      verdict: JSON.stringify((d.verdict as Row)?.value ?? d.verdict), confidence: Number(d.confidence),
      input: JSON.stringify(d.input).slice(0, 500), createdAt: iso(d.created_at),
    })),
  };
}

async function contactsFor(database: Queryable, jobIds: string[]): Promise<Map<string, Row[]>> {
  const map = new Map<string, Row[]>();
  if (jobIds.length === 0) return map;
  const rows = (await database.query<Row>("SELECT * FROM contacts WHERE job_id = ANY($1::uuid[]) ORDER BY created_at", [jobIds])).rows;
  for (const row of rows) {
    const key = String(row.job_id);
    map.set(key, [...(map.get(key) ?? []), row]);
  }
  return map;
}

function lastRun(value: unknown): string {
  return value ? iso(value) : "";
}

export function mountWebContract(app: Hono, s: Services): void {
  app.get("/api/dashboard", async () => {
    const jobs = (await s.database.query<Row>(
      `SELECT j.*, c.name AS company_name, s.name AS source_name,
              (SELECT verdict FROM job_feedback f WHERE f.job_id = j.id) AS feedback
       FROM jobs j JOIN companies c ON c.id = j.company_id LEFT JOIN sources s ON s.id = j.source_id
       WHERE j.status IN ('targeted', 'drafted', 'sent', 'replied') AND j.closed_at IS NULL
       ORDER BY (j.apply_method = 'email') DESC, j.score DESC NULLS LAST, coalesce(j.posted_at, j.first_seen_at) DESC
       LIMIT 800`,
    )).rows;
    const contacts = await contactsFor(s.database, jobs.map((j) => String(j.id)));
    const status = await s.dashboardStatus();
    const scheduler = (status.scheduler ?? {}) as { queue?: Record<string, number>; lastRunsByTier?: Record<string, unknown> };
    return ok({
      targets: jobs.map((j) => targetView(j, contacts.get(String(j.id)) ?? [])),
      outreach: await s.outreach(),
      companies: await s.companies(),
      sources: await s.sources(),
      settings: await s.settings(),
      status: {
        lastRunT1: lastRun(scheduler.lastRunsByTier?.t1),
        lastRunT2: lastRun(scheduler.lastRunsByTier?.t2),
        lastRunT3: lastRun(scheduler.lastRunsByTier?.t3),
        queueDepth: (scheduler.queue?.queued ?? 0) + (scheduler.queue?.leased ?? 0),
        llmSpendUsd: Number(status.monthlyLlmSpendUsd ?? 0),
        blockedSources: Number(status.blockedSources ?? 0),
      },
    });
  });

  const detail = async (id: string) => {
    const row = (await s.database.query<Row>(
      `SELECT j.*, c.name AS company_name, (SELECT name FROM sources WHERE id = j.source_id) AS source_name,
              (SELECT verdict FROM job_feedback f WHERE f.job_id = j.id) AS feedback,
              (SELECT jsonb_build_object('fileName', t.file_name, 'createdAt', t.created_at, 'content', t.content)
                 FROM tailored_cvs t WHERE t.job_id = j.id) AS tailored_cv
       FROM jobs j JOIN companies c ON c.id = j.company_id WHERE j.id = $1`,
      [id],
    )).rows[0];
    if (!row) throw new ApiError(404, "job_not_found", "Job was not found.");
    const contacts = await contactsFor(s.database, [id]);
    const decisions = (await s.database.query<Row>(
      "SELECT * FROM decisions WHERE subject_type = 'job' AND subject_id = $1 ORDER BY created_at DESC LIMIT 20",
      [id],
    )).rows;
    return targetView(row, contacts.get(id) ?? [], decisions, true);
  };

  // Like / dislike: examples Jev and the local model learn Brian's taste from; re-scores the top targets.
  app.post("/api/targets/:id/feedback", async (context) => {
    const id = context.req.param("id");
    const body = requireObject(await context.req.json().catch(() => null));
    const verdict = String(body.verdict);
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : null;
    if (verdict === "clear") {
      await s.database.query("DELETE FROM job_feedback WHERE job_id = $1", [id]);
    } else if (verdict === "like" || verdict === "dislike") {
      await s.database.query(
        `INSERT INTO job_feedback (job_id, verdict, note) VALUES ($1, $2, $3)
         ON CONFLICT (job_id) DO UPDATE SET verdict = EXCLUDED.verdict, note = EXCLUDED.note, created_at = now()`,
        [id, verdict, note],
      );
      if (verdict === "dislike") {
        await s.database.query("UPDATE jobs SET status = 'skipped', skip_reason = 'Disliked by Brian.', updated_at = now() WHERE id = $1", [id]);
      }
    } else {
      throw new ApiError(400, "unknown_feedback", "verdict must be like, dislike, or clear.");
    }
    await s.database.query(
      `UPDATE jobs SET needs_rescore = true, next_judge_at = now()
       WHERE id IN (SELECT id FROM jobs WHERE status = 'targeted' AND closed_at IS NULL ORDER BY score DESC NULLS LAST LIMIT 300)`,
    );
    return ok(await detail(id));
  });

  // CV import: extract text, keep it as the source of truth for tailoring, parse the profile with luna.
  app.post("/api/cv/import", async (context) => {
    const body = requireObject(await context.req.json().catch(() => null));
    const path = typeof body.path === "string" && body.path.trim() ? body.path.trim() : "~/Documents/CV_Ade_Febrian_AI_Engineer.docx";
    const text = await cvText(path);
    if (text.trim().length < 100) throw new ApiError(422, "cv_unreadable", "The CV file has almost no text.");
    await s.database.query(
      `INSERT INTO settings (key, value) VALUES ('cv_text', to_jsonb($1::text))
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [text],
    );
    return ok(await s.parseProfile(text));
  });

  // Tailor CV: one luna call, only when Brian presses the button. Saved as .docx and attached to this job's emails.
  app.post("/api/targets/:id/tailor-cv", async (context) => {
    const id = context.req.param("id");
    if (!s.luna.tailorCv) throw new ApiError(501, "tailor_unavailable", "CV tailoring is not available.");
    const cv = (await s.database.query<{ value: string }>("SELECT value #>> '{}' AS value FROM settings WHERE key = 'cv_text'")).rows[0]?.value;
    if (!cv) throw new ApiError(409, "cv_missing", "Import your CV in Settings first.");
    if (!(await s.budgetLeft())) throw new ApiError(429, "llm_budget_cap", "Monthly LLM budget cap reached.");
    const job = (await s.database.query<Row>(
      `SELECT j.title, j.location, j.url, coalesce(j.jd_text_english, j.jd_text) AS jd, c.name AS company
       FROM jobs j JOIN companies c ON c.id = j.company_id WHERE j.id = $1`, [id],
    )).rows[0];
    if (!job) throw new ApiError(404, "job_not_found", "Job was not found.");
    const out = await s.luna.tailorCv({
      cvText: cv.slice(0, 30_000),
      job: { title: job.title, company: job.company, location: job.location },
      jdText: String(job.jd).slice(0, 12_000),
    });
    await s.recordUsage(out.usage);
    await mkdir(CV_DIR, { recursive: true });
    const fileName = `CV-${slugPart(String(out.result.name || "Ade-Febrian"))}-${slugPart(String(job.company))}-${slugPart(String(job.title))}.docx`;
    const html = join(tmpdir(), `jobsniper-cv-${id}.html`);
    await writeFile(html, cvHtml(out.result));
    const proc = Bun.spawnSync(["textutil", "-convert", "docx", "-output", join(CV_DIR, fileName), html]);
    await rm(html, { force: true });
    if (proc.exitCode !== 0) throw new ApiError(500, "cv_write_failed", "Could not write the tailored CV.");
    await s.database.query(
      `INSERT INTO tailored_cvs (job_id, content, file_name) VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (job_id) DO UPDATE SET content = EXCLUDED.content, file_name = EXCLUDED.file_name, created_at = now()`,
      [id, JSON.stringify(out.result), fileName],
    );
    // Any unsent email for this job now carries the tailored CV.
    await s.database.query(
      "UPDATE outreach SET cv_variant = $2 WHERE job_id = $1 AND status IN ('draft', 'approved', 'scheduled')",
      [id, `tailored:${join(CV_DIR, fileName)}`],
    );
    return ok(await detail(id));
  });

  // Overview: what the sniper caught, what Brian did with it, and the last 7 days' shape.
  app.get("/api/stats", async () => {
    const q = async <T extends Row>(sql: string) => (await s.database.query<T>(sql)).rows;
    const [totals] = await q(`
      SELECT
        (SELECT count(*) FROM jobs)::int AS jobs_total,
        (SELECT count(*) FROM jobs WHERE first_seen_at > now() - interval '24 hours')::int AS jobs_today,
        (SELECT count(*) FROM jobs WHERE first_seen_at > now() - interval '7 days')::int AS jobs_week,
        (SELECT count(*) FROM jobs WHERE status = 'targeted' AND closed_at IS NULL)::int AS targets_open,
        (SELECT count(*) FROM jobs WHERE status = 'targeted' AND closed_at IS NULL
           AND coalesce(posted_at, first_seen_at) > now() - interval '72 hours')::int AS targets_fresh,
        (SELECT count(*) FROM jobs WHERE status IN ('targeted','drafted','sent','replied')
           AND first_seen_at > now() - interval '7 days')::int AS targets_week,
        (SELECT count(*) FROM outreach WHERE status = 'draft')::int AS drafts,
        (SELECT count(*) FROM outreach WHERE status IN ('sent','replied'))::int AS applied,
        (SELECT count(*) FROM outreach WHERE status IN ('sent','replied') AND sent_at > now() - interval '7 days')::int AS applied_week,
        (SELECT count(*) FROM outreach WHERE status = 'replied')::int AS replied,
        (SELECT count(*) FROM outreach WHERE reply_class = 'positive')::int AS positive,
        (SELECT count(DISTINCT email) FROM contacts WHERE invalid_at IS NULL)::int AS emails,
        (SELECT count(*) FROM job_feedback WHERE verdict = 'like')::int AS liked,
        (SELECT count(*) FROM companies WHERE discovered_via <> 'feed_holder')::int AS companies,
        (SELECT count(*) FROM career_sources WHERE last_ok_at > now() - interval '24 hours')::int AS sources_live,
        (SELECT count(*) FROM jobs WHERE apply_method = 'email' AND status = 'targeted' AND closed_at IS NULL)::int AS email_targets,
        (SELECT count(*) FROM jobs WHERE apply_method = 'email' AND status = 'targeted' AND closed_at IS NULL
           AND first_seen_at > now() - interval '24 hours')::int AS email_targets_24h,
        (SELECT count(*) FROM jobs WHERE new_company AND status = 'targeted' AND closed_at IS NULL)::int AS new_company_targets,
        (SELECT count(*) FROM discovered_urls WHERE seen_at > now() - interval '24 hours')::int AS pages_read_24h`);
    const daily = await q(`
      SELECT to_char(d, 'YYYY-MM-DD') AS day,
             (SELECT count(*) FROM jobs j WHERE coalesce(j.posted_at, j.first_seen_at)::date = d::date)::int AS discovered,
             (SELECT count(*) FROM jobs j WHERE coalesce(j.posted_at, j.first_seen_at)::date = d::date
                AND j.status IN ('targeted','drafted','sent','replied'))::int AS targeted,
             (SELECT count(*) FROM outreach o WHERE o.sent_at::date = d::date)::int AS applied
      FROM generate_series(current_date - 6, current_date, interval '1 day') d ORDER BY d`);
    // "This week" = posted in the last 7 days (first sighting when a source has no posting date).
    const week = `j.status IN ('targeted','drafted','sent','replied') AND coalesce(j.posted_at, j.first_seen_at) > now() - interval '7 days'`;
    const roles = await q(`
      SELECT CASE
          WHEN j.title ~* '(agent|agentic)' THEN 'Agentic / AI agents'
          WHEN j.title ~* '(full[- ]?stack)' THEN 'Fullstack'
          WHEN j.title ~* '(\mai\M|\mllm|genai|applied ai)' AND j.title ~* 'engineer' THEN 'AI engineer'
          WHEN j.title ~* '(machine learning|\mml\M)' THEN 'ML engineer'
          WHEN j.title ~* '(back[- ]?end|platform|infra)' THEN 'Backend / platform'
          WHEN j.title ~* '(forward deployed|solutions)' THEN 'Forward deployed'
          WHEN j.title ~* '(front[- ]?end|product engineer|web)' THEN 'Frontend / product'
          ELSE 'Software engineer' END AS label, count(*)::int AS n
      FROM jobs j WHERE ${week} GROUP BY 1 ORDER BY 2 DESC`);
    const countries = await q(`
      SELECT coalesce(nullif(j.countries[1], ''), CASE WHEN j.remote_scope IN ('remote_global','remote_apac') THEN 'Remote' ELSE 'Other' END) AS label,
             count(*)::int AS n
      FROM jobs j WHERE ${week} GROUP BY 1 ORDER BY 2 DESC LIMIT 8`);
    const levels = await q(`SELECT j.seniority AS label, count(*)::int AS n FROM jobs j WHERE ${week} GROUP BY 1 ORDER BY 2 DESC`);
    const modes = await q(`SELECT j.remote_scope AS label, count(*)::int AS n FROM jobs j WHERE ${week} GROUP BY 1 ORDER BY 2 DESC`);
    const companies = await q(`
      SELECT c.name AS label, count(*)::int AS n FROM jobs j JOIN companies c ON c.id = j.company_id
      WHERE ${week} GROUP BY 1 ORDER BY 2 DESC LIMIT 6`);
    const funnel = [
      { label: "Discovered", n: Number(totals?.jobs_total ?? 0) },
      { label: "Targets", n: Number(totals?.targets_open ?? 0) + Number(totals?.drafts ?? 0) + Number(totals?.applied ?? 0) },
      { label: "Drafted", n: Number(totals?.drafts ?? 0) + Number(totals?.applied ?? 0) },
      { label: "Applied", n: Number(totals?.applied ?? 0) },
      { label: "Replied", n: Number(totals?.replied ?? 0) },
    ];
    // Personal layer: what the market asks for vs Brian's CV, how open it is to him, and today's best.
    const weekJobs = await q<{ jd: string }>(`SELECT coalesce(j.jd_text_english, j.jd_text) AS jd FROM jobs j WHERE ${week} LIMIT 600`);
    const profile = ((await q<{ value: Row }>("SELECT value FROM settings WHERE key = 'app'"))[0]?.value?.profile ?? {}) as Row;
    const cvSkills = (Array.isArray(profile.skills) ? profile.skills : []).map((x) => String(x).toLowerCase());
    const skills = SKILLS.map(([label, re]) => ({
      label,
      n: weekJobs.filter((j) => re.test(j.jd)).length,
      inCv: cvSkills.some((c) => c.includes(label.toLowerCase().replace(/s$/, "")) || label.toLowerCase().includes(c)),
    })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 12);
    const [share] = await q(`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE j.remote_scope IN ('remote_global','remote_apac'))::int AS remote_open,
             count(*) FILTER (WHERE j.sponsorship = 'yes')::int AS sponsor_yes,
             count(*) FILTER (WHERE j.seniority = 'mid')::int AS mid,
             count(*) FILTER (WHERE coalesce(j.agentic_focus, 0) >= 0.6)::int AS agentic
      FROM jobs j WHERE ${week}`);
    const best = await q(`
      SELECT j.id, j.title, c.name AS company, j.location, round(j.score)::int AS score, j.remote_scope, j.seniority,
             j.apply_email, j.new_company,
             coalesce(j.posted_at, j.first_seen_at) AS posted_at
      FROM jobs j JOIN companies c ON c.id = j.company_id
      WHERE j.status = 'targeted' AND j.closed_at IS NULL AND coalesce(j.posted_at, j.first_seen_at) > now() - interval '14 days'
      ORDER BY (j.apply_method = 'email') DESC, j.score DESC NULLS LAST LIMIT 3`);
    const goal = Number(profile.weeklyGoal ?? 10) || 10;
    return ok({
      totals, daily, roles, countries, levels, modes, companies, funnel, skills, share, best,
      me: { nickname: String(profile.nickname ?? "Brian"), weeklyGoal: goal, appliedThisWeek: Number(totals?.applied_week ?? 0) },
    });
  });

  app.get("/api/targets/:id/tailored-cv", async (context) => {
    const row = (await s.database.query<{ file_name: string }>("SELECT file_name FROM tailored_cvs WHERE job_id = $1", [context.req.param("id")])).rows[0];
    if (!row) throw new ApiError(404, "tailored_cv_missing", "No tailored CV for this job yet.");
    const file = Bun.file(join(CV_DIR, row.file_name));
    if (!(await file.exists())) throw new ApiError(404, "tailored_cv_missing", "The tailored CV file was moved or deleted.");
    return new Response(file, {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "content-disposition": `attachment; filename="${row.file_name}"`,
      },
    });
  });

  app.get("/api/targets/:id", async (context) => ok(await detail(context.req.param("id"))));

  app.post("/api/targets/:id/actions", async (context) => {
    const id = context.req.param("id");
    const body = requireObject(await context.req.json().catch(() => null));
    const action = String(body.action);
    if (action === "skip") {
      await s.database.query("UPDATE jobs SET status = 'skipped', skip_reason = 'Skipped by Brian', updated_at = now() WHERE id = $1", [id]);
    } else if (action === "blacklist") {
      await s.blacklist(id);
    } else if (action === "draft") {
      const contact = (await s.database.query<{ id: string }>(
        "SELECT id FROM contacts WHERE job_id = $1 AND invalid_at IS NULL ORDER BY (kind = 'public') DESC, created_at LIMIT 1",
        [id],
      )).rows[0];
      await s.draft(id, contact?.id);
      await s.database.query(
        `UPDATE outreach o SET cv_variant = 'tailored:' || $2 || '/' || t.file_name
         FROM tailored_cvs t WHERE t.job_id = o.job_id AND o.job_id = $1 AND o.status = 'draft'`,
        [id, CV_DIR],
      );
      await s.database.query("UPDATE jobs SET status = 'drafted', updated_at = now() WHERE id = $1 AND status = 'targeted'", [id]);
    } else if (action !== "open") {
      throw new ApiError(400, "unknown_action", "Action must be draft, skip, blacklist, or open.");
    }
    return ok(await detail(id));
  });
}
