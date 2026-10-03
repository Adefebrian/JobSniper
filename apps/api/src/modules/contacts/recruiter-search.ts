// PRD 8.1 recruiter_search: finds recruiting emails that are WRITTEN on public pages, via Brave
// Search result snippets. Extra data with its own label; never a guessed address. Results from
// email-guessing sites and placeholder patterns (first@, firstname.lastname@) are discarded.
const GUESSING_SITES = /(rocketreach|zoominfo|signalhire|contactout|apollo\.io|lusha|hunter\.io|leadiq|clearbit|snov\.io|voilanorbert|emailformat|email-format|kendoemailapp|getemail|findthat)/i;
const PLACEHOLDER_LOCAL = /^(first|last|firstname|lastname|first\.last|firstlast|flast|f\.last|first_last|first\.l|name|email|example|john\.?doe|jdoe|jane\.?doe|your\.?name|user)$/i;
const NOT_FOR_APPLYING = /^(privacy|gdpr|dpo|legal|abuse|no-?reply|donotreply|security|press|media|investors?|billing|invoices?|support|help|sales|info|hello|contact|partners?)$/i;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

export type FoundEmail = { email: string; quote: string; sourceUrl: string };

function slug(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
}

/** The email's domain must be the company's own (anthropic.com for "Anthropic"). */
export function domainMatchesCompany(email: string, company: string): boolean {
  const label = slug(email.split("@")[1]?.split(".").slice(-2, -1)[0] ?? "");
  const name = slug(company.replace(/\b(inc|ltd|llc|gmbh|ag|labs?|ai|technologies|technology|group|corp)\b/gi, ""));
  return label.length >= 3 && name.length >= 3 && (label === name || label.startsWith(name) || name.startsWith(label));
}

export function extractFromResults(html: string, company: string): FoundEmail[] {
  const clean = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
  const found = new Map<string, FoundEmail>();
  for (const match of clean.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) {
    const email = match[0].toLowerCase().replace(/\.+$/, "");
    const local = email.split("@")[0] ?? "";
    if (found.has(email) || PLACEHOLDER_LOCAL.test(local) || NOT_FOR_APPLYING.test(local)) continue;
    if (!domainMatchesCompany(email, company)) continue;
    const before = clean.slice(0, match.index);
    const href = [...before.matchAll(/href="(https?:\/\/[^"]+)"/g)]
      .map((m) => m[1]!)
      .filter((u) => !/brave\.com|search\.brave/.test(u))
      .at(-1);
    if (!href || GUESSING_SITES.test(href)) continue;
    const window = clean.slice(Math.max(0, match.index! - 400), match.index! + email.length + 200)
      .replace(/<[^>]+>/g, " ").replace(/<[^>]*$/, " ").replace(/^[^<]*>/, " ")
      .replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
    if (!window.toLowerCase().includes(email)) continue;
    const at = window.toLowerCase().indexOf(email);
    found.set(email, { email, quote: window.slice(Math.max(0, at - 160), at + email.length + 80).trim(), sourceUrl: href });
  }
  return [...found.values()].slice(0, 3);
}

export async function searchRecruiterEmails(company: string, fetchImpl: typeof fetch = fetch): Promise<FoundEmail[]> {
  const query = `"${company}" (recruiting OR careers OR talent OR jobs) email`;
  const response = await fetchImpl(`https://search.brave.com/search?q=${encodeURIComponent(query)}`, {
    headers: { "user-agent": UA, "accept-language": "en" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`search ${response.status}`);
  return extractFromResults(await response.text(), company);
}
