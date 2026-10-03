// Reads one public page: plain fetch first (cheap), Lightpanda when the page is a JS shell.
// robots.txt is honoured (RFC 9309: 4xx means no rules); nothing behind a login is attempted.
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15 JobSniper/0.1";
const robots = new Map<string, string[] | "all">();

async function allowed(url: URL): Promise<boolean> {
  let rules = robots.get(url.origin);
  if (!rules) {
    try {
      const res = await fetch(`${url.origin}/robots.txt`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(8_000) });
      if (res.status >= 400) rules = [];
      else {
        const lines = (await res.text()).split(/\r?\n/);
        const disallow: string[] = [];
        let applies = false;
        for (const raw of lines) {
          const line = raw.replace(/#.*/, "").trim();
          const [k, ...rest] = line.split(":");
          const key = (k ?? "").trim().toLowerCase();
          const value = rest.join(":").trim();
          if (key === "user-agent") applies = value === "*";
          else if (applies && key === "disallow" && value) disallow.push(value);
        }
        rules = disallow;
      }
    } catch {
      rules = [];
    }
    robots.set(url.origin, rules);
  }
  if (rules === "all") return false;
  return !rules.some((prefix) => url.pathname.startsWith(prefix.replace(/\*.*$/, "")));
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/?(p|div|li|br|h[1-6]|section|article|tr|ul|ol)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
}

export type Page = { text: string; title: string; siteName: string | null };

export async function readPage(target: string, lightpandaPath: string): Promise<Page | "blocked" | null> {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol) || /\.(pdf|docx?|zip|png|jpe?g)$/i.test(url.pathname)) return null;
  if (!(await allowed(url))) return "blocked";
  let title = "";
  let siteName: string | null = null;
  let text = "";
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, "accept-language": "en" }, redirect: "follow", signal: AbortSignal.timeout(15_000) });
    if (res.ok && /html/i.test(res.headers.get("content-type") ?? "")) {
      const html = (await res.text()).slice(0, 3_000_000);
      title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim();
      siteName = html.match(/<meta[^>]+property="og:site_name"[^>]+content="([^"]+)"/i)?.[1] ?? null;
      text = htmlToText(html);
    }
  } catch {
    // fall through to the headless reader
  }
  if (text.length < 800) {
    const proc = Bun.spawn([lightpandaPath, "fetch", "--dump", "markdown", url.toString()], {
      env: { ...process.env, LIGHTPANDA_DISABLE_TELEMETRY: "true" }, stdout: "pipe", stderr: "ignore",
    });
    const timer = setTimeout(() => proc.kill(), 25_000);
    const rendered = await new Response(proc.stdout).text().catch(() => "");
    clearTimeout(timer);
    if (rendered.length > text.length) {
      text = rendered.replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
      title ||= rendered.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "";
    }
  }
  return text ? { text: text.slice(0, 40_000), title, siteName } : null;
}
