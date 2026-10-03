import type { DatabasePort, OutreachRecord } from "./ports";

export type OutreachRow = Record<string, unknown> & {
  id: string;
  job_id: string;
  contact_id: string | null;
  kind: "initial" | "followup";
  subject: string;
  body: string;
  cv_variant: string;
  status: "draft" | "approved" | "scheduled" | "sending" | "sent" | "replied" | "closed" | "failed";
  scheduled_for: string | null;
  sent_at: string | null;
  gmail_thread_id: string | null;
  reply_class: "positive" | "negative" | "auto_reply" | "bounce" | null;
  reply_text: string | null;
  last_error: string | null;
};

export class OutreachRepository {
  constructor(private readonly database: DatabasePort) {}

  async list(filters: {
    status?: string;
    kind?: string;
    replyClass?: string;
    page: number;
    perPage: number;
  }): Promise<{ items: OutreachRow[]; page: number; perPage: number; total: number }> {
    const conditions: string[] = ["1 = 1"];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      conditions.push(sql.replace("$?", `$${params.length}`));
    };
    if (filters.status && filters.status !== "followup_due" && filters.status !== "scheduled_queue") add("o.status = $?", filters.status);
    if (filters.kind) add("o.kind = $?", filters.kind);
    if (filters.replyClass) add("o.reply_class = $?", filters.replyClass);
    if (filters.status === "scheduled_queue") {
      conditions.push(`o.status IN ('approved', 'scheduled', 'sending')`);
    }
    if (filters.status === "followup_due") {
      conditions.push(`o.kind = 'initial' AND o.status = 'sent' AND o.sent_at <= now() - interval '6 days'
        AND NOT EXISTS (SELECT 1 FROM outreach followup WHERE followup.job_id = o.job_id AND followup.kind = 'followup')`);
    }
    const where = conditions.join(" AND ");
    const total = await this.database.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM outreach o WHERE ${where}`,
      params,
    );
    const rows = await this.database.query<OutreachRow>(
      `SELECT o.*, j.title AS job_title, c.name AS company_name, contact.email AS contact_email
       FROM outreach o
       JOIN jobs j ON j.id = o.job_id
       JOIN companies c ON c.id = j.company_id
       LEFT JOIN contacts contact ON contact.id = o.contact_id
       WHERE ${where}
       ORDER BY coalesce(o.scheduled_for, o.created_at) DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, filters.perPage, (filters.page - 1) * filters.perPage],
    );
    return {
      items: rows.rows,
      page: filters.page,
      perPage: filters.perPage,
      total: Number(total.rows[0]?.total ?? 0),
    };
  }

  async get(id: string): Promise<OutreachRow | undefined> {
    return (await this.database.query<OutreachRow>(
      `SELECT o.*, j.title AS job_title, c.name AS company_name, contact.email AS contact_email
       FROM outreach o
       JOIN jobs j ON j.id = o.job_id
       JOIN companies c ON c.id = j.company_id
       LEFT JOIN contacts contact ON contact.id = o.contact_id
       WHERE o.id = $1`,
      [id],
    )).rows[0];
  }

  async create(input: OutreachRecord): Promise<OutreachRow> {
    const result = await this.database.query<OutreachRow>(
      `INSERT INTO outreach
       (id, job_id, contact_id, kind, subject, body, cv_variant, status, scheduled_for)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        input.id,
        input.jobId,
        input.contactId,
        input.kind,
        input.subject,
        input.body,
        input.cvVariant,
        input.status,
        input.scheduledFor,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Outreach insert did not return a row.");
    return row;
  }

  async patch(id: string, patch: {
    subject?: string;
    body?: string;
    cvVariant?: string;
    scheduledFor?: string | null;
    status?: OutreachRecord["status"];
    contactId?: string | null;
  }): Promise<OutreachRow | undefined> {
    const result = await this.database.query<OutreachRow>(
      `UPDATE outreach SET
         subject = coalesce($2, subject),
         body = coalesce($3, body),
         cv_variant = coalesce($4, cv_variant),
         scheduled_for = CASE WHEN $5::boolean THEN $6::timestamptz ELSE scheduled_for END,
         status = coalesce($7, status),
         contact_id = CASE WHEN $8::boolean THEN $9::uuid ELSE contact_id END,
         updated_at = now()
       WHERE id = $1 RETURNING *`,
      [
        id,
        patch.subject ?? null,
        patch.body ?? null,
        patch.cvVariant ?? null,
        patch.scheduledFor !== undefined,
        patch.scheduledFor ?? null,
        patch.status ?? null,
        patch.contactId !== undefined,
        patch.contactId ?? null,
      ],
    );
    return result.rows[0];
  }

  async dueScheduled(now: Date, limit: number): Promise<OutreachRow[]> {
    return this.database.transaction(async (client) => (await client.query<OutreachRow>(
      `UPDATE outreach SET status = 'sending', updated_at = now()
       WHERE id IN (
         SELECT id FROM outreach
         WHERE (status = 'scheduled' AND scheduled_for <= $1)
            OR (status = 'sending' AND updated_at < $1::timestamptz - interval '10 minutes')
         ORDER BY scheduled_for
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       RETURNING *`,
      [now.toISOString(), limit],
    )).rows);
  }

  async followupCandidates(now: Date, afterMs: number): Promise<OutreachRow[]> {
    return (await this.database.query<OutreachRow>(
      `SELECT o.*, j.title AS job_title, c.name AS company_name, contact.email AS contact_email
       FROM outreach o
       JOIN jobs j ON j.id = o.job_id
       JOIN companies c ON c.id = j.company_id
       LEFT JOIN contacts contact ON contact.id = o.contact_id
       WHERE o.kind = 'initial' AND o.status = 'sent'
         AND o.sent_at <= $1::timestamptz - ($2 * interval '1 millisecond')
         AND o.reply_class IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM outreach followup
           WHERE followup.job_id = o.job_id AND followup.kind = 'followup'
         )
       ORDER BY o.sent_at`,
      [now.toISOString(), afterMs],
    )).rows;
  }

  async hasFollowup(jobId: string): Promise<boolean> {
    const result = await this.database.query(
      "SELECT 1 FROM outreach WHERE job_id = $1 AND kind = 'followup' LIMIT 1",
      [jobId],
    );
    return result.rowCount > 0;
  }

  async getInitialForJob(jobId: string): Promise<OutreachRow | undefined> {
    return (await this.database.query<OutreachRow>(
      "SELECT * FROM outreach WHERE job_id = $1 AND kind = 'initial' ORDER BY created_at DESC LIMIT 1",
      [jobId],
    )).rows[0];
  }

  async alreadySentSameKind(jobId: string, kind: string, excludeId: string): Promise<boolean> {
    const result = await this.database.query(
      `SELECT 1 FROM outreach WHERE job_id = $1 AND kind = $2 AND id <> $3 AND status = 'sent' LIMIT 1`,
      [jobId, kind, excludeId],
    );
    return result.rowCount > 0;
  }

  async sentOnDay(now: Date, timeZone: string): Promise<number> {
    const result = await this.database.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM outreach
       WHERE status = 'sent'
         AND sent_at >= timezone($2, date_trunc('day', $1::timestamptz AT TIME ZONE $2))
         AND sent_at < timezone($2, date_trunc('day', $1::timestamptz AT TIME ZONE $2) + interval '1 day')`,
      [now.toISOString(), timeZone],
    );
    return Number(result.rows[0]?.total ?? 0);
  }

  async latestScheduledAt(): Promise<Date | undefined> {
    const result = await this.database.query<{ scheduled_for: string }>(
      `SELECT scheduled_for FROM outreach
       WHERE status IN ('approved', 'scheduled', 'sending') AND scheduled_for IS NOT NULL
       ORDER BY scheduled_for DESC LIMIT 1`,
    );
    const value = result.rows[0]?.scheduled_for;
    return value ? new Date(value) : undefined;
  }

  async markSending(id: string): Promise<void> {
    await this.database.query(
      "UPDATE outreach SET status = 'sending', last_error = NULL, updated_at = now() WHERE id = $1",
      [id],
    );
  }

  async markSent(id: string, sentAt: string, threadId: string | null): Promise<OutreachRow | undefined> {
    return (await this.database.query<OutreachRow>(
      `UPDATE outreach SET status = 'sent', sent_at = $2, gmail_thread_id = $3, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [id, sentAt, threadId],
    )).rows[0];
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.database.query(
      "UPDATE outreach SET status = 'failed', last_error = $2, updated_at = now() WHERE id = $1",
      [id, error],
    );
  }

  async markClosed(id: string, reason: string): Promise<OutreachRow | undefined> {
    return (await this.database.query<OutreachRow>(
      `UPDATE outreach SET status = 'closed', last_error = $2, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [id, reason],
    )).rows[0];
  }

  async statusCounts(): Promise<Record<string, number>> {
    const result = await this.database.query<{
      draft: string;
      scheduled: string;
      sent: string;
      replied: string;
      failed: string;
    }>(
      `SELECT
        count(*) FILTER (WHERE status = 'draft')::text AS draft,
        count(*) FILTER (WHERE status IN ('approved', 'scheduled', 'sending'))::text AS scheduled,
        count(*) FILTER (WHERE status = 'sent')::text AS sent,
        count(*) FILTER (WHERE status = 'replied')::text AS replied,
        count(*) FILTER (WHERE status = 'failed')::text AS failed
       FROM outreach`,
    );
    const row = result.rows[0];
    return {
      drafts: Number(row?.draft ?? 0),
      scheduled: Number(row?.scheduled ?? 0),
      sent: Number(row?.sent ?? 0),
      replied: Number(row?.replied ?? 0),
      failed: Number(row?.failed ?? 0),
    };
  }

  async recordReply(id: string, replyClass: string, replyText: string): Promise<OutreachRow | undefined> {
    return (await this.database.query<OutreachRow>(
      `UPDATE outreach SET status = 'replied', reply_class = $2, reply_text = $3, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [id, replyClass, replyText],
    )).rows[0];
  }

  async listReplyCandidates(): Promise<OutreachRow[]> {
    return (await this.database.query<OutreachRow>(
      `SELECT * FROM outreach WHERE status = 'sent' AND gmail_thread_id IS NOT NULL ORDER BY sent_at`,
    )).rows;
  }

  async exportRows(): Promise<OutreachRow[]> {
    return (await this.database.query<OutreachRow>(
      `SELECT id, job_id, contact_id, kind, subject, body, cv_variant, status,
              scheduled_for, sent_at, gmail_thread_id, reply_class, last_error
       FROM outreach ORDER BY created_at`,
    )).rows;
  }
}
