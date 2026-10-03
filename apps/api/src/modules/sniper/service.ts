// The web sniper: search -> open each result -> keep only posts that state a real application email.
// Paced to stay inside each provider's free quota; every stored job carries the URL and the exact
// sentence (page or search snippet) that contains the address. Nothing is ever guessed.
import { createHash } from "node:crypto";
import type { CredentialStore } from "@core/ports/runtime";
import type { Queryable } from "@core/ports/database";
import { detectApplyEmail, parseLocation } from "../brain";
import { readPage } from "./page";
import { QUERY_SPACE, queryAt, resolveProvider } from "./search";

// Free tiers: Brave ~2,000 queries/month, Google CSE 100/day, Serper 2,500 one-off credits.
const INTERVAL_MIN: Record<string, number> = { brave: 25, google_cse: 15, serper: 20 };
const FREEMAIL = /@(gmail|googlemail|yahoo|outlook|hotmail|live|icloud|me|proton|protonmail|aol|gmx|zoho|yandex)\./i;
const ROLE_LINE =
  /(?:hiring|looking for|seeking|join us as|we need|open (?:role|position)s?:?|position:?|role:?)\s+(?:an?\s+|our\s+|(?:a\s+)?(?:new\s+)?)((?:senior |junior |lead |staff |principal |founding |mid[- ]level )?[A-Z][A-Za-z/+&.\- ]{1,50}?(?:Engineer|Developer|Architect))/;

function title(text: string, fallback: string): string {
  const role = ROLE_LINE.exec(text)?.[1]?.trim();
  if (role) return role;
  return fallback.replace(/\s*[|\-–:]\s*(LinkedIn|Indeed|Glassdoor|Facebook|X|Twitter).*$/i, "").replace(/^.*? on LinkedIn:\s*/i, "").slice(0, 140).trim();
}

function company(siteName: string | null, email: string, url: string): { name: string; domain: string | null } {
  const host = new URL(url).hostname.replace(/^www\./, "");
  const emailDomain = email.split("@")[1]!.toLowerCase();
  const domain = FREEMAIL.test(email) ? (/(linkedin|facebook|twitter|x|indeed|reddit)\./.test(host) ? null : host) : emailDomain;
  const label = (domain ?? host).split(".").slice(-2, -1)[0] ?? domain ?? host;
  const fromDomain = label.charAt(0).toUpperCase() + label.slice(1);
  const site = siteName && !/linkedin|facebook|indeed|glassdoor/i.test(siteName) ? siteName : null;
  return { name: (site ?? fromDomain).slice(0, 80), domain };
}

export class SniperService {
  private nextRunAt = 0;
  private lastStatus: Record<string, unknown> = { state: "starting" };

  constructor(
    private readonly db: Queryable,
    private readonly credentials: CredentialStore,
    private readonly lightpandaPath: string,
  ) {}

  status() {
    return this.lastStatus;
  }

  /** Called every tick; runs one query when its provider's pacing allows. */
  async tick(): Promise<void> {
    if (Date.now() < this.nextRunAt) return;
    const provider = await resolveProvider(this.credentials);
    if (!provider) {
      this.lastStatus = { state: "idle", reason: "Add a Brave Search, Serper or Google search key in Settings > Connections." };
      this.nextRunAt = Date.now() + 5 * 60_000;
      return;
    }
    this.nextRunAt = Date.now() + (INTERVAL_MIN[provider.name] ?? 20) * 60_000;
    const cursorRow = (await this.db.query<{ value: number }>("SELECT (value #>> '{}')::int AS value FROM settings WHERE key = 'sniper_cursor'")).rows[0];
    const cursor = (cursorRow?.value ?? 0) % (QUERY_SPACE * 4);
    await this.db.query(
      `INSERT INTO settings (key, value) VALUES ('sniper_cursor', to_jsonb($1::int))
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [cursor + 1],
    );
    const query = queryAt(cursor);
    let hits;
    try {
      hits = await provider.search(query);
    } catch (error) {
      this.nextRunAt = Date.now() + 60 * 60_000; // rate limited or failing: rest an hour
      this.lastStatus = { state: "paused", provider: provider.name, reason: (error as Error).message };
      return;
    }
    let found = 0;
    for (const hit of hits.slice(0, 10)) {
      const seen = await this.db.query("SELECT 1 FROM discovered_urls WHERE url = $1", [hit.url]);
      if (seen.rowCount > 0) continue;
      const outcome = await this.consider(hit, query).catch(() => "error");
      if (outcome === "job") found++;
      await Bun.sleep(1_500);
    }
    this.lastStatus = { state: "running", provider: provider.name, lastQuery: query, lastFound: found, at: new Date().toISOString() };
  }

  private async consider(hit: { url: string; title: string; snippet: string }, query: string): Promise<string> {
    const page = await readPage(hit.url, this.lightpandaPath);
    if (page === "blocked") return this.record(hit.url, query, "blocked");
    const pageText = page?.text ?? "";
    // The address must be written on the page, or in the search engine's copy of that page.
    const fromPage = detectApplyEmail(pageText, null);
    const fromSnippet = fromPage ? null : detectApplyEmail(hit.snippet, null);
    const apply = fromPage ?? fromSnippet;
    if (!apply) return this.record(hit.url, query, "no_email");
    const jd = fromPage ? pageText : `${pageText}\n\n${hit.snippet}`.trim();
    const who = company(page?.siteName ?? null, apply.email, hit.url);
    const place = parseLocation(jd).countries;
    const companyRow = (await this.db.query<{ id: string }>(
      `WITH ins AS (
         INSERT INTO companies (id, name, domain, country, tier, discovered_via)
         VALUES (gen_random_uuid(), $1, $2, $3, 2, 'web_sniper')
         ON CONFLICT DO NOTHING RETURNING id)
       SELECT id FROM ins
       UNION ALL SELECT id FROM companies WHERE ($2::text IS NOT NULL AND domain = $2) OR lower(name) = lower($1)
       LIMIT 1`,
      [who.name, who.domain, place[0] ?? "unknown"],
    )).rows[0];
    if (!companyRow) return this.record(hit.url, query, "error");
    const externalId = `web-${createHash("sha1").update(hit.url).digest("hex").slice(0, 20)}`;
    const job = (await this.db.query<{ id: string }>(
      `INSERT INTO jobs (id, company_id, source_id, external_id, title, url, apply_url, location, jd_text, jd_hash, status)
       VALUES (gen_random_uuid(), $1, md5('jobsniper-source:web-sniper')::uuid, $2, $3, $4, $5, $6, $7, md5($7), 'new')
       ON CONFLICT DO NOTHING RETURNING id`,
      [companyRow.id, externalId, title(jd, page?.title || hit.title), hit.url, `mailto:${apply.email}`,
       place.length ? place.join(", ") : null, jd.slice(0, 15_000)],
    )).rows[0];
    return this.record(hit.url, query, "job", job?.id ?? null);
  }

  private async record(url: string, query: string, outcome: string, jobId: string | null = null): Promise<string> {
    await this.db.query(
      "INSERT INTO discovered_urls (url, query, outcome, job_id) VALUES ($1, $2, $3, $4) ON CONFLICT (url) DO NOTHING",
      [url, query, outcome, jobId],
    );
    return outcome;
  }
}
