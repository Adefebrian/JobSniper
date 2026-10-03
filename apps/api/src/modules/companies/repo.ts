import type { Queryable } from "./ports";

type Row = Record<string, unknown> & { id: string };

export class CompaniesRepository {
  constructor(private readonly database: Queryable) {}

  async listCompanies() {
    return (await this.database.query(
      `SELECT c.*, count(cs.id)::integer AS source_count,
              max(cs.last_ok_at)::text AS last_run_at,
              min(cs.next_due_at)::text AS next_due_at
       FROM companies c
       LEFT JOIN career_sources cs ON cs.company_id = c.id
       GROUP BY c.id
       ORDER BY c.tier, c.name`,
    )).rows;
  }

  async getCompany(id: string): Promise<Row | undefined> {
    return (await this.database.query<Row>(
      `SELECT c.*, count(cs.id)::integer AS source_count,
              max(cs.last_ok_at)::text AS last_run_at,
              min(cs.next_due_at)::text AS next_due_at
       FROM companies c
       LEFT JOIN career_sources cs ON cs.company_id = c.id
       WHERE c.id = $1 GROUP BY c.id`,
      [id],
    )).rows[0];
  }

  async insertCompany(input: {
    id: string;
    name: string;
    domain: string;
    country: string;
    industry: string | null;
    tier: number;
    discoveredVia: string;
    sponsorRegistryHit: boolean;
  }): Promise<Row> {
    const result = await this.database.query<Row>(
      `INSERT INTO companies
       (id, name, domain, country, industry, tier, sponsor_registry_hit, discovered_via)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (domain) DO UPDATE SET updated_at = now()
       RETURNING *`,
      [
        input.id,
        input.name,
        input.domain,
        input.country,
        input.industry,
        input.tier,
        input.sponsorRegistryHit,
        input.discoveredVia,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Company insert did not return a row.");
    return row;
  }

  async listSources(filters: { status?: string; country?: string }) {
    const params: unknown[] = [];
    const conditions: string[] = ["1 = 1"];
    if (filters.status) {
      params.push(filters.status);
      conditions.push(`status = $${params.length}`);
    }
    if (filters.country) {
      params.push(filters.country);
      conditions.push(`$${params.length} = ANY(countries)`);
    }
    return (await this.database.query(
      `SELECT * FROM sources WHERE ${conditions.join(" AND ")} ORDER BY status, name`,
      params,
    )).rows;
  }

  async getSource(id: string): Promise<Row | undefined> {
    return (await this.database.query<Row>("SELECT * FROM sources WHERE id = $1", [id])).rows[0];
  }

  async insertSource(input: {
    id: string;
    name: string;
    kind: string;
    countries: string[];
    roles: string[];
    method: string;
    config: Record<string, unknown>;
    trust: string;
    status: string;
    admittedBy: string | null;
    trialUntil: Date | null;
  }): Promise<Row> {
    const result = await this.database.query<Row>(
      `INSERT INTO sources
       (id, name, kind, countries, roles, method, config, trust, status, admitted_by, trial_until)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11)
       RETURNING *`,
      [
        input.id,
        input.name,
        input.kind,
        input.countries,
        input.roles,
        input.method,
        JSON.stringify(input.config),
        input.trust,
        input.status,
        input.admittedBy,
        input.trialUntil?.toISOString() ?? null,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Source insert did not return a row.");
    return row;
  }

  async patchSource(id: string, patch: {
    status?: string;
    config?: Record<string, unknown>;
    countries?: string[];
    roles?: string[];
    trialUntil?: Date | null;
    lastError?: string | null;
    admittedBy?: string | null;
  }): Promise<Row | undefined> {
    const result = await this.database.query<Row>(
      `UPDATE sources SET
         status = CASE WHEN $2::boolean THEN $3 ELSE status END,
         config = CASE WHEN $4::boolean THEN $5::jsonb ELSE config END,
         countries = CASE WHEN $6::boolean THEN $7 ELSE countries END,
         roles = CASE WHEN $8::boolean THEN $9 ELSE roles END,
         trial_until = CASE WHEN $10::boolean THEN $11::timestamptz ELSE trial_until END,
         last_error = CASE WHEN $12::boolean THEN $13 ELSE last_error END,
         admitted_by = CASE WHEN $14::boolean THEN $15 ELSE admitted_by END,
         updated_at = now()
       WHERE id = $1 RETURNING *`,
      [
        id,
        patch.status !== undefined, patch.status ?? null,
        patch.config !== undefined, patch.config ? JSON.stringify(patch.config) : null,
        patch.countries !== undefined, patch.countries ?? null,
        patch.roles !== undefined, patch.roles ?? null,
        patch.trialUntil !== undefined, patch.trialUntil?.toISOString() ?? null,
        patch.lastError !== undefined, patch.lastError ?? null,
        patch.admittedBy !== undefined, patch.admittedBy ?? null,
      ],
    );
    return result.rows[0];
  }

  async updateYield(id: string, stats: Record<string, unknown>, status?: string): Promise<void> {
    await this.database.query(
      `UPDATE sources SET yield_stats = $2::jsonb, status = coalesce($3, status), updated_at = now() WHERE id = $1`,
      [id, JSON.stringify(stats), status ?? null],
    );
  }

  async blockedCount(): Promise<number> {
    const result = await this.database.query<{ total: string }>(
      "SELECT count(*)::text AS total FROM sources WHERE status = 'blocked'",
    );
    return Number(result.rows[0]?.total ?? 0);
  }

  async pauseCompany(id: string, until: Date): Promise<void> {
    await this.database.query(
      `UPDATE career_sources SET next_due_at = $2, closed_check_due_at = $2, updated_at = now() WHERE company_id = $1`,
      [id, until.toISOString()],
    );
  }

  async resumeCompany(id: string, now: Date): Promise<void> {
    await this.database.query(
      `UPDATE career_sources SET next_due_at = $2, closed_check_due_at = $2, fail_count = 0, blocked_until = NULL, last_error = NULL, updated_at = now() WHERE company_id = $1`,
      [id, now.toISOString()],
    );
  }
}
