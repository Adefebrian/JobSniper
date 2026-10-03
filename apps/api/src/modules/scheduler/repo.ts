import type { DatabasePort } from "./ports";
import { nextDue, queuePriority, type Tier } from "./policy";

export type CrawlTaskRow = Record<string, unknown> & {
  id: string;
  kind: "discover" | "crawl" | "closed_check";
  payload: Record<string, unknown>;
};

export class SchedulerRepository {
  constructor(private readonly database: DatabasePort) {}

  async scheduleDue(now: Date): Promise<number> {
    return this.database.transaction(async (client) => {
      const due = await client.query<{
        id: string;
        source_id: string | null;
        company_id: string;
        url: string;
        tier: number;
        crawl_due: boolean;
        closed_due: boolean;
      }>(
        `SELECT id, source_id, company_id, url, tier,
                next_due_at <= $1 AS crawl_due,
                closed_check_due_at <= $1 AS closed_due
         FROM career_sources
         WHERE (next_due_at <= $1 OR closed_check_due_at <= $1)
           AND (blocked_until IS NULL OR blocked_until <= $1)
         ORDER BY tier, least(next_due_at, closed_check_due_at)
         LIMIT 1000
         FOR UPDATE SKIP LOCKED`,
        [now.toISOString()],
      );

      let inserted = 0;
      for (const row of due.rows) {
        const crawlDueAt = nextDue(now, row.tier as Tier);
        const closedDueAt = nextDue(now, row.tier as Tier, "closed_check");
        await client.query(
          `UPDATE career_sources SET
             next_due_at = CASE WHEN $2::boolean THEN $3 ELSE next_due_at END,
             closed_check_due_at = CASE WHEN $4::boolean THEN $5 ELSE closed_check_due_at END,
             updated_at = now()
           WHERE id = $1`,
          [row.id, row.crawl_due, crawlDueAt.toISOString(), row.closed_due, closedDueAt.toISOString()],
        );
        const kinds = [
          ...(row.crawl_due ? [{ kind: "crawl" as const, dueAt: crawlDueAt }] : []),
          ...(row.closed_due ? [{ kind: "closed_check" as const, dueAt: closedDueAt }] : []),
        ];
        for (const item of kinds) {
          const task = await client.query(
            `INSERT INTO crawl_tasks
             (id, source_id, kind, priority, payload, dedupe_key)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6)
             ON CONFLICT (dedupe_key) DO NOTHING`,
            [
              crypto.randomUUID(),
              row.source_id,
              item.kind,
              queuePriority(row.tier as Tier, item.kind),
              JSON.stringify({
                kind: item.kind,
                url: row.url,
                source_id: row.source_id,
                company_id: row.company_id,
                career_source_id: row.id,
              }),
              `${item.kind}:${row.id}:${item.dueAt.toISOString()}`,
            ],
          );
          inserted += task.rowCount;
        }
      }
      return inserted;
    });
  }

  async enqueueDiscovery(input: {
    sourceId: string | null;
    payload: Record<string, unknown>;
    dedupeKey: string;
  }): Promise<boolean> {
    return this.enqueueTask("discover", input);
  }

  async enqueueCrawl(input: {
    sourceId: string | null;
    payload: Record<string, unknown>;
    dedupeKey: string;
  }): Promise<boolean> {
    return this.enqueueTask("crawl", input);
  }

  private async enqueueTask(kind: "discover" | "crawl" | "closed_check", input: {
    sourceId: string | null;
    payload: Record<string, unknown>;
    dedupeKey: string;
  }): Promise<boolean> {
    const result = await this.database.query(
      `INSERT INTO crawl_tasks (id, source_id, kind, priority, payload, dedupe_key)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [crypto.randomUUID(), input.sourceId, kind, kind === "discover" ? 100 : 90, JSON.stringify(input.payload), input.dedupeKey],
    );
    return result.rowCount > 0;
  }

  async claim(workerId: string, leaseSeconds: number, limit: number): Promise<CrawlTaskRow[]> {
    return this.database.transaction(async (client) => {
      const result = await client.query<CrawlTaskRow>(
        `UPDATE crawl_tasks
         SET status = 'leased', leased_by = $1,
             lease_until = now() + ($2 * interval '1 second'), updated_at = now()
         WHERE id IN (
           SELECT id FROM crawl_tasks
           WHERE (status = 'queued' AND (lease_until IS NULL OR lease_until <= now()))
              OR (status = 'leased' AND lease_until < now())
           ORDER BY priority DESC, created_at
           LIMIT $3
           FOR UPDATE SKIP LOCKED
         )
         RETURNING *`,
        [workerId, leaseSeconds, limit],
      );
      return result.rows;
    });
  }

  async complete(id: string): Promise<void> {
    await this.database.transaction(async (client) => {
      const result = await client.query<{ payload: Record<string, unknown> }>(
        `UPDATE crawl_tasks SET status = 'done', lease_until = NULL, leased_by = NULL, last_error = NULL, updated_at = now()
         WHERE id = $1 RETURNING payload`,
        [id],
      );
      const careerSourceId = result.rows[0]?.payload?.career_source_id;
      if (typeof careerSourceId === "string") {
        await client.query(
          `UPDATE career_sources SET fail_count = 0, last_ok_at = now(), last_error = NULL, updated_at = now() WHERE id = $1`,
          [careerSourceId],
        );
        await client.query(
          `UPDATE companies SET health = 'ok', updated_at = now()
           WHERE id = (SELECT company_id FROM career_sources WHERE id = $1)`,
          [careerSourceId],
        );
      }
    });
  }

  async retry(id: string, error: string, backoffSeconds: number): Promise<"queued" | "failed"> {
    return this.database.transaction(async (client) => {
      const result = await client.query<{ attempts: number; max_attempts: number; payload: Record<string, unknown> }>(
        `UPDATE crawl_tasks
         SET attempts = attempts + 1,
             status = CASE WHEN attempts + 1 >= max_attempts THEN 'failed' ELSE 'queued' END,
             lease_until = CASE WHEN attempts + 1 >= max_attempts THEN NULL
                                ELSE now() + (least(86400, power(2, greatest(attempts + 1, 1)) * $2) * interval '1 second') END,
             leased_by = NULL, last_error = $3, updated_at = now()
         WHERE id = $1
         RETURNING attempts, max_attempts, payload`,
        [id, backoffSeconds, error],
      );
      const row = result.rows[0];
      if (row?.payload && typeof row.payload.career_source_id === "string") {
        await client.query(
          `UPDATE career_sources
           SET fail_count = fail_count + 1,
               blocked_until = CASE WHEN fail_count + 1 >= 3 OR $2::text ILIKE '%blocked%' OR $2::text ILIKE '%captcha%'
                                    THEN now() + interval '24 hours' ELSE blocked_until END,
               last_error = $2, updated_at = now()
           WHERE id = $1`,
          [row.payload.career_source_id, error],
        );
        await client.query(
          `UPDATE companies SET health = CASE WHEN $2::text ILIKE '%blocked%' OR $2::text ILIKE '%captcha%' THEN 'blocked' ELSE 'failing' END, updated_at = now()
           WHERE id = (SELECT company_id FROM career_sources WHERE id = $1)`,
          [row.payload.career_source_id, error],
        );
        if (typeof row.payload.source_id === "string" && (error.toLowerCase().includes("blocked") || error.toLowerCase().includes("captcha"))) {
          await client.query(
            `UPDATE sources SET status = 'blocked', last_error = $2, updated_at = now() WHERE id = $1`,
            [row.payload.source_id, error],
          );
        }
      }
      return row && row.attempts >= row.max_attempts ? "failed" : "queued";
    });
  }

  async status(now: Date): Promise<Record<string, number>> {
    const tasks = await this.database.query<{
      queued: string;
      leased: string;
      expired: string;
      failed: string;
    }>(
      `SELECT
        count(*) FILTER (WHERE status = 'queued')::text AS queued,
        count(*) FILTER (WHERE status = 'leased')::text AS leased,
        count(*) FILTER (WHERE status = 'leased' AND lease_until < $1::timestamptz)::text AS expired,
        count(*) FILTER (WHERE status = 'failed')::text AS failed
       FROM crawl_tasks`,
      [now.toISOString()],
    );
    const tiers = await this.database.query<{ tier: string; due: string }>(
      `SELECT tier::text AS tier, count(*) FILTER (WHERE next_due_at <= $1::timestamptz)::text AS due
       FROM career_sources GROUP BY tier`,
      [now.toISOString()],
    );
    const row = tasks.rows[0];
    return {
      queued: Number(row?.queued ?? 0),
      leased: Number(row?.leased ?? 0),
      expiredLeases: Number(row?.expired ?? 0),
      failed: Number(row?.failed ?? 0),
      t1Due: Number(tiers.rows.find((item) => item.tier === "1")?.due ?? 0),
      t2Due: Number(tiers.rows.find((item) => item.tier === "2")?.due ?? 0),
      t3Due: Number(tiers.rows.find((item) => item.tier === "3")?.due ?? 0),
    };
  }

  async lastRuns(): Promise<Record<string, string | null>> {
    const result = await this.database.query<{ kind: string; updated_at: string }>(
      `SELECT kind, max(updated_at)::text AS updated_at FROM crawl_tasks WHERE status = 'done' GROUP BY kind`,
    );
    return Object.fromEntries(result.rows.map((row) => [row.kind, row.updated_at]));
  }

  async lastRunsByTier(): Promise<Record<string, string | null>> {
    const result = await this.database.query<{ tier: string; updated_at: string }>(
      `SELECT cs.tier::text AS tier, max(t.updated_at)::text AS updated_at
       FROM crawl_tasks t
       JOIN career_sources cs ON cs.id = (t.payload->>'career_source_id')::uuid
       WHERE t.status = 'done' AND t.kind = 'crawl'
       GROUP BY cs.tier`,
    );
    return Object.fromEntries(result.rows.map((row) => [`t${row.tier}`, row.updated_at]));
  }

  async setTier(careerSourceId: string, tier: Tier): Promise<boolean> {
    const result = await this.database.query(
      "UPDATE career_sources SET tier = $2, updated_at = now() WHERE id = $1",
      [careerSourceId, tier],
    );
    return result.rowCount > 0;
  }
}
