// Registers company ATS boards: probes each slug on Greenhouse, Lever and Ashby and keeps
// the ones that answer with a real board. Safe to re-run; add slugs freely.
//   bun scripts/seed-ats.ts            (default list)
//   bun scripts/seed-ats.ts acme beta  (extra slugs)
import { SQL } from "bun";

const DEFAULT_SLUGS = [
  // AI labs and AI-first products
  "anthropic", "openai", "cohere", "mistral", "huggingface", "scaleai", "perplexity", "runwayml", "elevenlabs",
  "deepgram", "assemblyai", "pinecone", "weaviate", "langchain", "llamaindex", "modal", "togetherai", "fireworksai",
  "glean", "harvey", "sierra", "decagon", "writer", "synthesia", "deepl", "cognition", "poolside", "lovable",
  "anysphere", "replit", "characterai", "jasper", "typeface", "hebbia", "rogo", "abridge", "ambiencehealthcare",
  "cresta", "observeai", "moveworks", "adept", "imbue", "magic", "factory", "codeium", "tabnine", "sourcegraph",
  "baseten", "replicate", "anyscale", "weightsandbiases", "wandb", "lambdalabs", "coreweave", "groq", "cerebras",
  "sambanova", "snorkelai", "labelbox", "vectara", "qdrant", "chroma", "zilliz", "unstructured", "lmnt", "suno",
  "pika", "ideogram", "midjourney", "stability", "luma", "heygen", "descript", "otter", "fathom", "granola",
  "mem", "notion", "linear", "vercel", "supabase", "posthog", "retool", "zapier", "n8n", "make",
  // product companies with AI teams, many sponsor visas
  "stripe", "airbnb", "canva", "atlassian", "gitlab", "cloudflare", "datadog", "discord", "dropbox", "duolingo",
  "instacart", "pinterest", "reddit", "robinhood", "twilio", "figma", "ramp", "brex", "plaid", "rippling",
  "deel", "remote", "gusto", "monzo", "revolut", "wise", "airwallex", "cultureamp", "safetyculture", "rokt",
  "xero", "grab", "palantir", "spotify", "personio", "contentful", "n26", "deliveryhero", "zalando", "celonis",
  "helsing", "aleph-alpha", "blackforestlabs", "doctolib", "qonto", "alan", "mollie", "adyen", "miro", "pleo",
];

type Kind = "greenhouse" | "lever" | "ashby";
const URL: Record<Kind, (slug: string) => string> = {
  greenhouse: (s) => `https://boards-api.greenhouse.io/v1/boards/${s}/jobs?content=true`,
  lever: (s) => `https://api.lever.co/v0/postings/${s}?mode=json`,
  ashby: (s) => `https://api.ashbyhq.com/posting-api/job-board/${s}?includeCompensation=true`,
};

function count(kind: Kind, body: unknown): number | null {
  if (kind === "lever") return Array.isArray(body) ? body.length : null;
  const jobs = (body as { jobs?: unknown } | null)?.jobs;
  return Array.isArray(jobs) ? jobs.length : null;
}

function companyName(kind: Kind, slug: string, body: unknown): string {
  if (kind === "greenhouse") {
    const name = (body as { jobs?: Array<{ company_name?: string }> }).jobs?.[0]?.company_name;
    if (name) return name;
  }
  return slug.split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

async function probe(kind: Kind, slug: string): Promise<{ n: number; body: unknown } | null> {
  try {
    const res = await fetch(URL[kind](slug), {
      headers: { "user-agent": "JobSniper/0.1 (personal job search)" },
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status !== 200) return null;
    const body = await res.json();
    const n = count(kind, body);
    return n === null ? null : { n, body };
  } catch {
    return null;
  }
}

const sql = new SQL(process.env.DATABASE_URL ?? "postgres://localhost:5432/jobsniper");
const slugs = [...new Set([...DEFAULT_SLUGS, ...process.argv.slice(2)].map((s) => s.toLowerCase()))];
const known = new Set(
  (await sql`SELECT url FROM career_sources WHERE kind = 'ats'`).map((r: { url: string }) => r.url),
);
let added = 0;
for (const slug of slugs) {
  if ((["greenhouse", "lever", "ashby"] as Kind[]).some((k) => known.has(URL[k](slug)))) continue;
  let hit = false;
  for (const kind of ["greenhouse", "ashby", "lever"] as Kind[]) {
    const r = await probe(kind, slug);
    await Bun.sleep(350);
    if (!r || r.n === 0) continue;
    const name = companyName(kind, slug, r.body);
    const [company] = await sql`
      INSERT INTO companies (id, name, domain, country, tier, discovered_via)
      VALUES (${crypto.randomUUID()}, ${name}, NULL, 'unknown', 1, ${"seed:" + kind})
      ON CONFLICT ((lower(name))) DO UPDATE SET tier = 1, updated_at = now()
      RETURNING id`;
    await sql`
      INSERT INTO career_sources (id, company_id, source_id, kind, url, tier, config)
      VALUES (${crypto.randomUUID()}, ${company.id}, md5(${"jobsniper-source:" + kind})::uuid, 'ats', ${URL[kind](slug)}, 1,
              ${JSON.stringify({ close_missing: true })}::text::jsonb)
      ON CONFLICT (company_id, url) DO NOTHING`;
    console.log(`+ ${name}  ${kind}/${slug}  (${r.n} jobs)`);
    added++;
    hit = true;
    break;
  }
  if (!hit) console.log(`- ${slug}: no public board`);
}
console.log(`done: ${added} boards added`);
await sql.end();
