import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";

type CountRow = { count: number };
type KindCountRow = { kind: string; count: number };
type CountryCountRow = { country: string; count: number };

const connection = new pg.Client(
  process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/jobsniper_test",
);
const schemaName = `source_seed_test_${crypto.randomUUID().replaceAll("-", "")}`;
const quotedSchema = `"${schemaName}"`;

let sourceCountAfterFirstApply = 0;
let sourceCountAfterSecondApply = 0;

beforeAll(async () => {
  await connection.connect();
  await connection.query(`CREATE SCHEMA ${quotedSchema}`);
  await connection.query(`SET search_path TO ${quotedSchema}`);

  const initialSql = await readFile(
    resolve(import.meta.dir, "../../../db/migrations/001_initial.sql"),
    "utf8",
  );
  const seedSql = await readFile(
    resolve(import.meta.dir, "../../../db/migrations/002_seed_sources.sql"),
    "utf8",
  );

  await connection.query(initialSql);
  await connection.query(seedSql);
  sourceCountAfterFirstApply = await countSources();
  await connection.query(seedSql);
  sourceCountAfterSecondApply = await countSources();
});

afterAll(async () => {
  await connection.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
  await connection.end();
});

async function countSources(): Promise<number> {
  const result = await connection.query<CountRow>("SELECT count(*)::int AS count FROM sources");
  return result.rows[0]?.count ?? 0;
}

describe("P0-P2 source registry seed", () => {
  test("002_seed_sources is idempotent", () => {
    expect(sourceCountAfterFirstApply).toBeGreaterThan(80);
    expect(sourceCountAfterSecondApply).toBe(sourceCountAfterFirstApply);
  });

  test("seeds every source with valid JSON, arrays, trust, role, method, access, and empty yield data", async () => {
    const result = await connection.query<CountRow>(`
      SELECT count(*)::int AS count
      FROM sources
      WHERE jsonb_typeof(config) <> 'object'
         OR config = '{}'::jsonb
         OR config->'requiresLogin' IS DISTINCT FROM 'false'::jsonb
         OR config->>'robotsPolicy' <> 'respect'
         OR COALESCE((config->>'rateLimitPerDomainSeconds')::numeric, 0) < 1
         OR NOT (
           config ? 'queryUrl'
           OR config ? 'endpoint'
           OR config ? 'urlPattern'
           OR config ? 'downloadUrl'
           OR config ? 'landingUrl'
           OR config ? 'url'
           OR config ? 'queryTemplates'
         )
         OR cardinality(countries) = 0
         OR cardinality(countries) <> cardinality(array_remove(countries, NULL))
         OR cardinality(roles) = 0
         OR cardinality(roles) <> cardinality(array_remove(roles, NULL))
         OR NOT roles <@ ARRAY['discovery', 'job_record', 'contact']::text[]
         OR kind NOT IN (
           'ats', 'career_page', 'portal', 'gov_portal', 'community',
           'aggregator_feed', 'search_dork', 'sponsor_registry', 'curated_list'
         )
         OR method NOT IN (
           'json_api', 'rss', 'sitemap', 'json_ld', 'html_selector',
           'headless', 'csv_download', 'custom_adapter'
         )
         OR trust NOT IN ('official', 'public_listing', 'derived')
         OR status NOT IN ('candidate', 'active')
         OR yield_stats <> '{
           "itemsSeen": 0,
           "relevantJobs": 0,
           "duplicateJobs": 0,
           "failures": 0,
           "lastYieldAt": null
         }'::jsonb
    `);

    expect(result.rows[0]?.count).toBe(0);
  });

  test("covers target countries and every required registry kind", async () => {
    const countryCounts = await connection.query<CountryCountRow>(`
      SELECT country, count(*)::int AS count
      FROM sources
      CROSS JOIN LATERAL unnest(sources.countries) AS country
      GROUP BY country
      ORDER BY country
    `);
    const countries = new Map(countryCounts.rows.map((row) => [row.country, row.count]));
    for (const country of [
      "global",
      "SG",
      "AU",
      "NZ",
      "US",
      "UK",
      "CA",
      "CH",
      "DE",
      "AE",
      "QA",
      "SA",
    ]) {
      expect(countries.get(country)).toBeGreaterThan(0);
    }

    const kindCounts = await connection.query<KindCountRow>(`
      SELECT kind, count(*)::int AS count
      FROM sources
      GROUP BY kind
      ORDER BY kind
    `);
    const kinds = new Map(kindCounts.rows.map((row) => [row.kind, row.count]));
    for (const kind of [
      "ats",
      "portal",
      "gov_portal",
      "community",
      "aggregator_feed",
      "search_dork",
      "sponsor_registry",
      "curated_list",
    ]) {
      expect(kinds.get(kind)).toBeGreaterThan(0);
    }
  });

  test("keeps PRD seed anchors across discovery, ATS, government, sponsor, curated, and dork sources", async () => {
    const result = await connection.query<CountRow>(`
      SELECT count(DISTINCT name)::int AS count
      FROM sources
      WHERE name IN (
        'LinkedIn Public Jobs',
        'Greenhouse Job Boards',
        'Lever Job Postings',
        'Ashby Job Boards',
        'Workday CXS',
        'MyCareersFuture',
        'SEEK Australia and New Zealand',
        'New Zealand Government Jobs',
        'Find a job',
        'Job Bank Canada',
        'Make it in Germany',
        'Dubai Careers',
        'Hacker News Who is Hiring',
        'RemoteOK',
        'UK Register of Licensed Sponsors',
        'US DOL OFLC LCA Disclosures',
        'Canada LMIA Positive Employers',
        'New Zealand Accredited Employers',
        'Y Combinator Company Directory',
        'Forbes AI 50',
        'Global AI-SWE Source Discovery Dork',
        'Germany AI-SWE Source Discovery Dork',
        'Saudi Arabia AI-SWE Source Discovery Dork'
      )
    `);

    expect(result.rows[0]?.count).toBe(23);
  });
});
