// Search providers for the web sniper. Official APIs only: anonymous HTML scraping of Bing/DDG was
// measured to ignore quoted phrases and return junk, so it is not used. The first provider with a
// key in the Keychain wins; with none configured the sniper stays idle and says so.
import type { CredentialStore } from "@core/ports/runtime";

export type SearchHit = { url: string; title: string; snippet: string };
export type Provider = { name: string; search(q: string): Promise<SearchHit[]> };

const TIMEOUT = 20_000;

async function json(res: Response, name: string) {
  if (res.status === 429) throw new Error(`${name} rate limited`);
  if (!res.ok) throw new Error(`${name} ${res.status}`);
  return res.json() as Promise<Record<string, any>>;
}

/** Free default: Yahoo results rendered by the local Lightpanda browser (measured to respect quoted
 *  phrases, unlike anonymous HTML fetches of Bing or DuckDuckGo). Paced slowly by the caller. */
export function yahooHeadless(lightpandaPath: string): Provider {
  return {
    name: "yahoo_headless",
    async search(q) {
      const url = `https://search.yahoo.com/search?p=${encodeURIComponent(q)}&n=20`;
      const proc = Bun.spawn([lightpandaPath, "fetch", "--dump", "markdown", url], {
        env: { ...process.env, LIGHTPANDA_DISABLE_TELEMETRY: "true" }, stdout: "pipe", stderr: "ignore",
      });
      const timer = setTimeout(() => proc.kill(), 30_000);
      const md = await new Response(proc.stdout).text().catch(() => "");
      clearTimeout(timer);
      if (/unusual traffic|captcha|are you a robot/i.test(md) || md.length < 500) throw new Error("yahoo blocked or empty");
      const hits: SearchHit[] = [];
      const seen = new Set<string>();
      for (const m of md.matchAll(/\[([^\]]{3,200})\]\((https?:\/\/[^)\s]+)\)/g)) {
        let link = m[2]!;
        const ru = link.match(/\/RU=([^/]+)\//);
        if (ru) link = decodeURIComponent(ru[1]!);
        if (/yahoo\.|yimg\.|bing\.com|doubleclick|\/search\?/.test(link) || seen.has(link)) continue;
        seen.add(link);
        // the text right after the link is Yahoo's snippet for it
        const after = md.slice(m.index! + m[0].length, m.index! + m[0].length + 400).replace(/\[[^\]]*\]\([^)]*\)/g, " ");
        const tidy = (v: string) => v.replace(/\\([+\-!().#*_[\]])/g, "$1").replace(/[*_`#]/g, "").replace(/\s+/g, " ").trim();
        hits.push({ url: link, title: tidy(m[1]!), snippet: tidy(after) });
      }
      return hits.slice(0, 15);
    },
  };
}

export async function resolveProvider(credentials: CredentialStore, lightpandaPath?: string): Promise<Provider | null> {
  const brave = await credentials.get("BRAVE_SEARCH_KEY");
  if (brave) {
    return {
      name: "brave",
      async search(q) {
        const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=20&extra_snippets=true`;
        const data = await json(await fetch(url, { headers: { accept: "application/json", "x-subscription-token": brave }, signal: AbortSignal.timeout(TIMEOUT) }), "brave");
        return (data.web?.results ?? []).map((r: any) => ({
          url: String(r.url), title: String(r.title ?? ""),
          snippet: [r.description, ...(r.extra_snippets ?? [])].filter(Boolean).join(" ").replace(/<[^>]+>/g, ""),
        }));
      },
    };
  }
  const serper = await credentials.get("SERPER_KEY");
  if (serper) {
    return {
      name: "serper",
      async search(q) {
        const data = await json(await fetch("https://google.serper.dev/search", {
          method: "POST", headers: { "x-api-key": serper, "content-type": "application/json" },
          body: JSON.stringify({ q, num: 20 }), signal: AbortSignal.timeout(TIMEOUT),
        }), "serper");
        return (data.organic ?? []).map((r: any) => ({ url: String(r.link), title: String(r.title ?? ""), snippet: String(r.snippet ?? "") }));
      },
    };
  }
  const gkey = await credentials.get("GOOGLE_CSE_KEY");
  const gcx = await credentials.get("GOOGLE_CSE_CX");
  if (gkey && gcx) {
    return {
      name: "google_cse",
      async search(q) {
        const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(gkey)}&cx=${encodeURIComponent(gcx)}&q=${encodeURIComponent(q)}&num=10`;
        const data = await json(await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) }), "google_cse");
        return (data.items ?? []).map((r: any) => ({ url: String(r.link), title: String(r.title ?? ""), snippet: String(r.snippet ?? "") }));
      },
    };
  }
  return lightpandaPath ? yahooHeadless(lightpandaPath) : null;
}

// Query plan: role x place x application phrase, plus public LinkedIn posts and startup-flavoured
// queries (Brian prioritises new companies). Walked round-robin so every place keeps coming back.
const ROLES = ["AI engineer", "AI software engineer", "LLM engineer", "GenAI engineer", "agentic AI engineer", "AI fullstack engineer", "machine learning engineer"];
const PLACES = ["Singapore", "Dubai", "Abu Dhabi", "Riyadh", "Saudi Arabia", "Doha", "Auckland", "Wellington", "Sydney", "Melbourne", "London", "Berlin", "Zurich", "Toronto", "remote"];
const PHRASES = ['"send your CV"', '"send your resume"', '"email your CV"', '"apply via email"', '"careers@"', '"hiring@"'];

export function queryAt(index: number): string {
  const role = ROLES[index % ROLES.length]!;
  const place = PLACES[Math.floor(index / ROLES.length) % PLACES.length]!;
  const phrase = PHRASES[Math.floor(index / (ROLES.length * PLACES.length)) % PHRASES.length]!;
  switch (index % 4) {
    case 1: return `site:linkedin.com/posts "${role}" ${place} hiring ${phrase}`;
    case 2: return `"${role}" ${place} startup hiring ${phrase}`;
    case 3: return `"${role}" ${place} ("seed" OR "series A" OR "founding engineer") ${phrase}`;
    default: return `"${role}" ${place} ${phrase}`;
  }
}

export const QUERY_SPACE = ROLES.length * PLACES.length * PHRASES.length;
