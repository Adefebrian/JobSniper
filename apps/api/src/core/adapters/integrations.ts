import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { ApiError } from "../http";
import type { LlmUsage } from "../ports/ai";
import type { DatabasePort, Queryable, QueryParam, QueryResultRow } from "../ports/database";
import type { DecisionRecorder } from "../ports/decisions";
import type { OutgoingMail } from "../ports/mail";
import type {
  CvAttachmentProvider,
  OutreachContact,
  OutreachContextProvider,
  OutreachJobContext,
} from "../../modules/outreach/ports";
import type { UsageRecorder } from "../../modules/settings/ports";
import type { IdGenerator } from "../ports/runtime";
import type { Settings } from "../domain";
import { readSettings } from "../settings";

type DatabaseLike = Queryable & Partial<Pick<DatabasePort, "transaction" | "close">>;

export function asDatabasePort(database: DatabaseLike): DatabasePort {
  return {
    query: database.query.bind(database),
    async transaction<T>(fn: (client: Queryable) => Promise<T>): Promise<T> {
      return database.transaction ? database.transaction(fn) : fn(database);
    },
    async close(): Promise<void> {
      await database.close?.();
    },
  };
}

export class SqlUsageRecorder implements UsageRecorder {
  constructor(
    private readonly database: Queryable,
    private readonly ids: IdGenerator,
  ) {}

  async record(usage: LlmUsage): Promise<void> {
    await this.database.query(
      `INSERT INTO llm_usage
       (id, model, purpose, request_id, tokens_in, tokens_out, cost_usd)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        this.ids.newId(),
        usage.model,
        usage.purpose,
        usage.requestId,
        usage.tokensIn,
        usage.tokensOut,
        usage.costUsd,
      ],
    );
  }
}

export class DatabaseOutreachContext implements OutreachContextProvider {
  constructor(
    private readonly database: Queryable,
    private readonly ids: IdGenerator,
    private readonly decisions: DecisionRecorder,
  ) {}

  async job(id: string): Promise<OutreachJobContext | undefined> {
    const row = (await this.database.query<{
      id: string; title: string; url: string; jd_text: string; status: string; countries: string[];
      company: string; location: string | null; remote_scope: string; sponsorship: string; jev_verified: boolean;
    }>(
      `SELECT j.id, j.title, j.url, coalesce(j.jd_text_english, j.jd_text) AS jd_text, j.status, j.countries,
              c.name AS company, j.location, j.remote_scope, j.sponsorship, j.jev_verified
       FROM jobs j JOIN companies c ON c.id = j.company_id WHERE j.id = $1`,
      [id],
    )).rows[0];
    return row ? {
      id: row.id,
      title: row.title,
      url: row.url,
      jdText: row.jd_text,
      status: row.status,
      countries: row.countries,
      company: row.company,
      location: row.location,
      remoteScope: row.remote_scope,
      sponsorship: row.sponsorship,
      jevVerified: row.jev_verified,
    } : undefined;
  }

  async contact(id: string): Promise<OutreachContact | undefined> {
    const row = (await this.database.query<OutreachContact>(
      "SELECT id, email, name, invalid_at FROM contacts WHERE id = $1",
      [id],
    )).rows[0];
    return row;
  }

  async isDoNotContact(email: string): Promise<boolean> {
    const result = await this.database.query(
      `SELECT 1 FROM do_not_contact
       WHERE lower($1) = lower(email_or_domain)
          OR lower(split_part($1, '@', 2)) = lower(email_or_domain)
       LIMIT 1`,
      [email],
    );
    return result.rowCount > 0;
  }

  async blockContact(email: string, reason: string): Promise<void> {
    await this.database.query(
      `INSERT INTO do_not_contact (id, email_or_domain, reason)
       VALUES ($1, $2, $3)
       ON CONFLICT (email_or_domain) DO UPDATE SET reason = excluded.reason`,
      [this.ids.newId(), email.toLowerCase(), reason],
    );
  }

  async invalidateContact(id: string, reason: string): Promise<void> {
    await this.database.query(
      `UPDATE contacts SET invalid_at = now(),
         jev_verdict = jsonb_build_object('value', false, 'reason', $2::text)
       WHERE id = $1 AND invalid_at IS NULL`,
      [id, reason],
    );
  }

  async settings(): Promise<Settings> {
    return readSettings(this.database);
  }

  async recordUsage(usage: LlmUsage): Promise<void> {
    await new SqlUsageRecorder(this.database, this.ids).record(usage);
  }

  async recordGrounding(input: {
    outreachId: string;
    evidence: Array<{ quote: string; source: string; reason: string }>;
  }): Promise<void> {
    await this.decisions.record({
      decisionId: "draft_grounding",
      subjectType: "outreach",
      subjectId: input.outreachId,
      input: { evidence: input.evidence },
      verdict: { value: input.evidence.length > 0 },
      confidence: 1,
    });
  }
}

export class DocumentCvAttachmentProvider implements CvAttachmentProvider {
  constructor(
    private readonly settings: () => Promise<Settings>,
    private readonly directory = resolve(homedir(), "Documents"),
  ) {}

  async load(cvVariant: string): Promise<OutgoingMail["attachments"]> {
    const fileName = (await this.settings()).cvVariants[cvVariant];
    if (!fileName) return undefined;
    const path = isAbsolute(fileName) ? resolve(fileName) : resolve(this.directory, fileName);
    const relativePath = relative(this.directory, path);
    if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
      throw new ApiError(422, "invalid_cv_path", "CV attachments must stay inside the Documents directory.");
    }
    try {
      const content = await readFile(path);
      const mimeType = /\.pdf$/i.test(path) ? "application/pdf"
        : /\.docx$/i.test(path) ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : "application/octet-stream";
      return [{ filename: basename(path), content, mimeType }];
    } catch {
      throw new ApiError(422, "cv_attachment_missing", `CV attachment ${basename(path)} was not found.`);
    }
  }
}

export type QueryRows = <T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params?: QueryParam[],
) => Promise<{ rows: T[]; rowCount: number }>;
