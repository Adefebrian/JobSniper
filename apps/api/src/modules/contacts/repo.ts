import type { ContactRecord } from "../../core/domain";
import type { Queryable } from "./ports";

type ContactRow = Record<string, unknown> & { id: string };

export class ContactsRepository {
  constructor(private readonly database: Queryable) {}

  /** Next company with a target but no usable email, not searched before. */
  async nextCompanyToSearch(): Promise<{ id: string; name: string } | undefined> {
    const result = await this.database.query<{ id: string; name: string }>(
      `SELECT c.id, c.name FROM companies c
       WHERE c.recruiter_searched_at IS NULL AND c.discovered_via <> 'feed_holder'
         AND EXISTS (SELECT 1 FROM jobs j WHERE j.company_id = c.id AND j.status = 'targeted' AND j.closed_at IS NULL
                       AND NOT EXISTS (SELECT 1 FROM contacts x WHERE x.job_id = j.id AND x.invalid_at IS NULL))
       ORDER BY (SELECT max(j.score) FROM jobs j WHERE j.company_id = c.id AND j.status = 'targeted') DESC NULLS LAST
       LIMIT 1`,
    );
    return result.rows[0];
  }

  async markSearched(companyId: string): Promise<void> {
    await this.database.query("UPDATE companies SET recruiter_searched_at = now() WHERE id = $1", [companyId]);
  }

  /** Files a found email under every open target of the company that has no email yet. */
  async insertRecruiterContact(companyId: string, c: { email: string; quote: string; sourceUrl: string; verdict: unknown }) {
    await this.database.query(
      `INSERT INTO contacts (id, company_id, job_id, email, kind, source_url, source_quote, jev_verdict)
       SELECT gen_random_uuid(), j.company_id, j.id, $2, 'recruiter_search', $3, $4, $5::jsonb
       FROM jobs j
       WHERE j.company_id = $1 AND j.status = 'targeted' AND j.closed_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM do_not_contact d WHERE d.email_or_domain IN ($2, split_part($2, '@', 2)))
       ON CONFLICT DO NOTHING`,
      [companyId, c.email, c.sourceUrl, c.quote, c.verdict === undefined ? null : JSON.stringify(c.verdict)],
    );
  }

  async jobExists(jobId: string): Promise<boolean> {
    const result = await this.database.query("SELECT 1 FROM jobs WHERE id = $1", [jobId]);
    return result.rowCount > 0;
  }

  async listForJob(jobId: string): Promise<ContactRow[]> {
    const result = await this.database.query<ContactRow>(
      "SELECT * FROM contacts WHERE job_id = $1 ORDER BY created_at",
      [jobId],
    );
    return result.rows;
  }

  async insert(input: ContactRecord & { verdict: Record<string, unknown> }): Promise<ContactRow> {
    const result = await this.database.query<ContactRow>(
      `INSERT INTO contacts
       (id, company_id, job_id, email, name, role, kind, source_url, source_quote, jev_verdict)
       SELECT $1, j.company_id, j.id, $4, $5, $6, $7, $8, $9, $10::jsonb
       FROM jobs j WHERE j.id = $2
       RETURNING *`,
      [
        input.id,
        input.jobId,
        input.jobId,
        input.email,
        input.name,
        input.role,
        input.kind,
        input.sourceUrl,
        input.sourceQuote,
        JSON.stringify(input.verdict),
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Job disappeared before contact insert.");
    return row;
  }

  async invalidate(id: string, reason: string): Promise<ContactRow | undefined> {
    const result = await this.database.query<ContactRow>(
      `UPDATE contacts SET invalid_at = now(), jev_verdict = jsonb_build_object('value', false, 'reason', $2::text)
       WHERE id = $1 AND invalid_at IS NULL RETURNING *`,
      [id, reason],
    );
    return result.rows[0];
  }

  async isDoNotContact(email: string): Promise<boolean> {
    const result = await this.database.query(
      `SELECT 1 FROM do_not_contact
       WHERE lower($1) = lower(email_or_domain) OR lower(split_part($1, '@', 2)) = lower(email_or_domain)
       LIMIT 1`,
      [email],
    );
    return result.rowCount > 0;
  }
}
