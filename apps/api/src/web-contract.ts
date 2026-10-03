// The dashboard's API contract (apps/web/src/types.ts) mapped onto the real services.
// /dashboard serves everything the SPA filters client-side; /targets/* serves detail and actions.
import type { Hono } from "hono";
import { ApiError, ok, requireObject } from "./core/http";
import type { Queryable } from "./core/ports/database";

type Services = {
  database: Queryable;
  draft(jobId: string, contactId?: string): Promise<unknown>;
  dashboardStatus(): Promise<Record<string, unknown>>;
  companies(): Promise<unknown[]>;
  sources(): Promise<unknown[]>;
  outreach(): Promise<unknown[]>;
  settings(): Promise<unknown>;
  blacklist(jobId: string): Promise<void>;
};

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
    },
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
      `SELECT j.*, c.name AS company_name FROM jobs j JOIN companies c ON c.id = j.company_id
       WHERE j.status IN ('targeted', 'drafted', 'sent', 'replied') AND j.closed_at IS NULL
       ORDER BY j.score DESC NULLS LAST, coalesce(j.posted_at, j.first_seen_at) DESC
       LIMIT 600`,
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
      "SELECT j.*, c.name AS company_name FROM jobs j JOIN companies c ON c.id = j.company_id WHERE j.id = $1",
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
      await s.database.query("UPDATE jobs SET status = 'drafted', updated_at = now() WHERE id = $1 AND status = 'targeted'", [id]);
    } else if (action !== "open") {
      throw new ApiError(400, "unknown_action", "Action must be draft, skip, blacklist, or open.");
    }
    return ok(await detail(id));
  });
}
