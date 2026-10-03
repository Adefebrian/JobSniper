// Location text -> country codes (settings keys: SG AU NZ US UK CA CH DE AE QA SA ...) + work mode.
// Bare two-letter codes are ambiguous ("CA" is California far more often than Canada), so a code
// only counts in parentheses or as a US state / Canadian province after a comma.
const NAMES: Record<string, string[]> = {
  SG: ["singapore"],
  AU: ["australia", "sydney", "melbourne", "brisbane", "perth", "adelaide", "canberra"],
  NZ: ["new zealand", "auckland", "wellington", "christchurch"],
  US: ["united states", "usa", "u.s.", "new york", "san francisco", "seattle", "austin", "boston", "los angeles",
       "chicago", "denver", "atlanta", "miami", "washington, dc", "palo alto", "mountain view", "menlo park",
       "sunnyvale", "san jose", "san diego", "redmond", "bay area", "us only", "us-only"],
  UK: ["united kingdom", "england", "scotland", "london", "manchester", "edinburgh", "oxford", "bristol", "uk"],
  CA: ["canada", "toronto", "vancouver", "montreal", "montréal", "ottawa", "calgary", "waterloo", "edmonton"],
  CH: ["switzerland", "schweiz", "suisse", "zurich", "zürich", "geneva", "genève", "basel", "lausanne", "bern"],
  DE: ["germany", "deutschland", "berlin", "munich", "münchen", "hamburg", "frankfurt", "cologne", "köln", "stuttgart", "düsseldorf"],
  AE: ["united arab emirates", "uae", "dubai", "abu dhabi", "sharjah"],
  QA: ["qatar", "doha"],
  SA: ["saudi arabia", "ksa", "riyadh", "jeddah", "dammam", "khobar", "neom"],
  NL: ["netherlands", "amsterdam", "rotterdam", "eindhoven"],
  IE: ["ireland", "dublin"],
  FR: ["france", "paris"],
  ES: ["spain", "madrid", "barcelona"],
  JP: ["japan", "tokyo"],
  IN: ["india", "bangalore", "bengaluru", "hyderabad", "pune", "mumbai"],
  ID: ["indonesia", "jakarta"],
};
const ISO_TO_KEY: Record<string, string> = { GB: "UK" };
const US_STATES = new Set(
  "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(" "),
);
const CA_PROVINCES = new Set("ON BC QC AB MB SK NS NB NL PE".split(" "));

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PATTERNS: Array<[string, RegExp]> = Object.entries(NAMES).flatMap(([code, names]) =>
  names.map((n) => [code, new RegExp(`(^|[^\\p{L}])${escape(n)}($|[^\\p{L}])`, "iu")] as [string, RegExp]),
);

export function parseLocation(text: string): { countries: string[]; remote: boolean } {
  const found = new Set<string>();
  for (const [code, re] of PATTERNS) if (re.test(text)) found.add(code);
  for (const m of text.matchAll(/\(([A-Z]{2})\)/g)) {
    const code = ISO_TO_KEY[m[1]!] ?? m[1]!;
    if (code in NAMES) found.add(code);
  }
  for (const m of text.matchAll(/,\s*([A-Z]{2})\b/g)) {
    if (CA_PROVINCES.has(m[1]!)) found.add("CA");
    else if (US_STATES.has(m[1]!) && !found.has("CA")) found.add("US");
  }
  return { countries: [...found], remote: /\b(remote|anywhere|worldwide|distributed)\b/i.test(text) };
}

export function workModeOf(location: string, jdText: string): "remote" | "hybrid" | "onsite" | "unknown" {
  const loc = location.toLowerCase();
  if (/\bhybrid\b/.test(loc)) return "hybrid";
  if (/\b(remote|anywhere|worldwide)\b/.test(loc)) return "remote";
  const head = jdText.slice(0, 1_500).toLowerCase();
  if (/\bfully remote\b|\b100% remote\b|\bremote[- ]first\b/.test(head)) return "remote";
  if (/\bhybrid\b/.test(head)) return "hybrid";
  if (loc.trim()) return "onsite";
  return "unknown";
}
