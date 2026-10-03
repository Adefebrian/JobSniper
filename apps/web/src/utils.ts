import type { Contact, JobTarget, Outreach, TargetsQuery } from "./types.ts";

export const scoreColor = (score: number) => {
  if (score >= 85) return "score-high";
  if (score >= 70) return "score-mid";
  return "score-low";
};

export const scoreLabel = (score: number) => {
  if (score >= 85) return "Strong fit";
  if (score >= 70) return "Good fit";
  return "Review fit";
};

/** Parses ISO strings and Postgres text timestamps ("2026-10-03 13:45:01.376539+07"). */
export const parseDate = (value: string | null | undefined): Date | null => {
  if (!value) return null;
  let text = value.trim();
  if (/^\d{4}-\d{2}-\d{2} \d/.test(text)) text = text.replace(" ", "T");
  text = text.replace(/(\.\d{3})\d+/, "$1");
  if (/[+-]\d{2}$/.test(text)) text = `${text}:00`;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const formatAge = (iso: string | null | undefined, now = new Date()) => {
  const date = parseDate(iso);
  if (!date) return "never";
  const minutes = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
};

/** "7m ago", or "never" when the timestamp is empty or invalid. */
export const formatAgo = (iso: string | null | undefined, now = new Date()) => {
  const age = formatAge(iso, now);
  return age === "never" ? age : `${age} ago`;
};

export const formatDateTime = (iso: string | null | undefined, empty = "Not scheduled") => {
  const date = parseDate(iso);
  if (!date) return empty;
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date);
};

export const modeLabel = (job: Pick<JobTarget, "workMode" | "remoteScope">) => {
  if (job.workMode === "hybrid") return "Hybrid";
  if (job.workMode === "onsite" || job.remoteScope === "onsite") return "On-site";
  if (job.remoteScope === "global") return "Remote global";
  if (job.remoteScope === "apac") return "Remote APAC";
  if (job.remoteScope === "restricted") return "Remote restricted";
  return "Remote, scope unknown";
};

/** Long multi-country locations collapse to the first two plus a count. */
export const shortLocation = (location: string) => {
  const parts = location.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 3) return location;
  return `${parts.slice(0, 2).join(", ")} +${parts.length - 2} more`;
};

export const sponsorshipLabel = (value: JobTarget["sponsorship"]) => {
  if (value === "yes") return "Sponsors visa";
  if (value === "registry_hit") return "Sponsor registry";
  if (value === "no") return "No sponsorship";
  return "Sponsorship unknown";
};

export const contactKindLabel = (kind: Contact["kind"]) => {
  if (kind === "public") return "Public";
  if (kind === "portal_public") return "Portal public";
  return "Recruiter search";
};

export const usableContacts = (job: Pick<JobTarget, "contacts">) =>
  (job.contacts ?? []).filter((contact) => contact.email && contact.jevVerdict !== "invalid");

export const humanize = (value: string) => {
  const text = value.replace(/_/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/** Scores arrive as 0..1 fractions from the engine or 0..100 from older records. */
export const toPercent = (value: number) => Math.round(value <= 1 ? value * 100 : value);

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", "#39": "'" };

/** Turns scraped HTML into readable plain text. Never injects markup. */
export const htmlToText = (value: string | null | undefined) => {
  if (!value) return "";
  return value
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|li|h[1-6]|ul|ol|tr|section)\s*>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "\n- ")
    .replace(/<[^>]*>/g, "")
    .replace(/<[^>]*$/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (match, code: string) => {
      const key = code.toLowerCase();
      if (key.startsWith("#x")) return String.fromCodePoint(Number.parseInt(key.slice(2), 16));
      if (key.startsWith("#") && key !== "#39") return String.fromCodePoint(Number.parseInt(key.slice(1), 10));
      return ENTITIES[key] ?? match;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
};

const HIDDEN_STATUSES = new Set(["skipped", "blacklisted", "closed"]);

export const filterTargets = (targets: JobTarget[], query: TargetsQuery, now = new Date()) => {
  return targets.filter((job) => {
    if (HIDDEN_STATUSES.has(job.status)) return false;
    const posted = parseDate(job.postedAt) ?? parseDate(job.firstSeenAt);
    const ageHours = posted ? (now.getTime() - posted.getTime()) / 3_600_000 : Number.POSITIVE_INFINITY;
    if (query.age === "24h" && ageHours > 24) return false;
    if (query.age === "72h" && ageHours > 72) return false;
    if (query.age === "7d" && ageHours > 168) return false;
    if (query.country && job.country !== query.country) return false;
    if (query.workMode && job.workMode !== query.workMode) return false;
    if (query.sponsorship && job.sponsorship !== query.sponsorship) return false;
    if (query.hasEmail && usableContacts(job).length === 0) return false;
    if (query.status && job.status !== query.status) return false;
    if (query.search) {
      const haystack = `${job.companyName} ${job.title} ${job.location}`.toLowerCase();
      if (!haystack.includes(query.search.toLowerCase())) return false;
    }
    return true;
  }).sort((a, b) => b.score - a.score);
};

export const filterOutreach = (items: Outreach[], tab: string) => {
  if (tab === "draft") return items.filter((item) => item.status === "draft");
  if (tab === "scheduled") return items.filter((item) => item.status === "scheduled");
  if (tab === "sent") return items.filter((item) => item.status === "sent");
  if (tab === "replied") return items.filter((item) => item.status === "replied");
  return items.filter((item) => item.status === "followup_due");
};

export const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
};

export const seniorityLabel = (value: JobTarget["seniority"] | string | null | undefined) => {
  if (value === "early") return "Junior";
  if (value === "mid") return "Mid-level";
  if (value === "senior") return "Senior";
  if (value === "lead") return "Lead";
  return "Level unknown";
};

/** agenticFocus is 0..1: how much of the role is AI-assisted or agentic work. */
export const agenticLabel = (value: number | null | undefined) => {
  if (value === null || value === undefined) return null;
  const pct = toPercent(value);
  if (pct >= 70) return `Agentic focus high`;
  if (pct >= 40) return `Agentic focus some`;
  return `Agentic focus low`;
};

export const FIT_LABELS: Record<string, string> = {
  roleFit: "Role fit",
  seniority: "Seniority",
  modeVisa: "Work mode and visa",
  freshness: "Freshness",
  skillOverlapCv: "Skill overlap with your CV",
  agenticFocus: "Agentic focus",
  preferenceFit: "Fit with your likes",
};

export const fitWord = (pct: number) => pct >= 75 ? "Strong" : pct >= 50 ? "Partial" : "Weak";

/** One plain sentence naming the strongest and weakest score parts. */
export const fitSummary = (breakdown: Record<string, number | null | undefined>) => {
  const parts = Object.entries(breakdown)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number")
    .map(([key, value]) => ({ label: lowerFirst(FIT_LABELS[key] ?? humanize(key)), pct: toPercent(value) }));
  if (parts.length === 0) return "No score breakdown yet.";
  const strong = parts.filter((part) => part.pct >= 75).map((part) => part.label);
  const weak = parts.filter((part) => part.pct < 50).map((part) => part.label);
  const sentences: string[] = [];
  if (strong.length) sentences.push(`Strong on ${joinWords(strong)}.`);
  if (weak.length) sentences.push(`Weak on ${joinWords(weak)}.`);
  if (!sentences.length) sentences.push("A middling fit on every part.");
  return sentences.join(" ");
};

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
const joinWords = (words: string[]) => words.length <= 1 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;

/* ---------- Overview helpers ---------- */

/** Evaluates the one JAL curve, cubic-bezier(0.24, 1, 0.4, 1), for JS-driven motion. */
export const easeStandard = (t: number) => {
  const x1 = 0.24, y1 = 1, x2 = 0.4, y2 = 1;
  const bez = (u: number, a: number, b: number) => 3 * a * u * (1 - u) ** 2 + 3 * b * u ** 2 * (1 - u) + u ** 3;
  let lo = 0, hi = 1, u = t;
  for (let i = 0; i < 20; i += 1) {
    u = (lo + hi) / 2;
    if (bez(u, x1, x2) < t) lo = u; else hi = u;
  }
  return bez(u, y1, y2);
};

export const prefersReducedMotion = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const greeting = (date = new Date()) => {
  const hour = date.getHours();
  if (hour < 5) return "Working late";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
};

export const motivation = (totals: { targets_fresh: number; applied_week: number; targets_open: number; replied: number }) => {
  if (totals.replied > 0 && totals.applied_week > 0) return `${totals.replied} ${totals.replied === 1 ? "reply" : "replies"} in, and ${totals.applied_week} sent this week. Keep going.`;
  if (totals.targets_fresh > 0) return `${totals.targets_fresh} fresh ${totals.targets_fresh === 1 ? "role" : "roles"} landed in the last 72 hours.`;
  if (totals.applied_week > 0) return `${totals.applied_week} ${totals.applied_week === 1 ? "application" : "applications"} out this week. Keep the streak.`;
  if (totals.targets_open > 0) return `${totals.targets_open} targets are waiting. Pick the best one and draft an email.`;
  return "The scout is out looking. New roles will show up here.";
};

const COUNTRY_FIX: Record<string, string> = { UK: "GB" };
export const countryName = (code: string) => {
  if (code === "Remote" || code === "Other" || code.length !== 2) return code;
  try {
    const names = new Intl.DisplayNames(["en"], { type: "region" });
    return names.of(COUNTRY_FIX[code] ?? code) ?? code;
  } catch {
    return code;
  }
};

export const levelName = (value: string) => value === "unknown" ? "Not stated" : seniorityLabel(value);

export const modeName = (value: string) => ({
  remote_global: "Remote global", global: "Remote global",
  remote_apac: "Remote APAC", apac: "Remote APAC",
  remote_restricted: "Remote restricted", restricted: "Remote restricted",
  onsite: "On-site", unknown: "Not stated",
} as Record<string, string>)[value] ?? humanize(value);

/** Deterministic monogram tint from a short palette dark enough for white initials. */
const MONOGRAM_TINTS = ["#1f6fd1", "#0e7c86", "#2e7d32", "#b25400", "#c0392b", "#5b6770", "#8a6d3b", "#00739e"];
export const monogramTint = (name: string) => {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return MONOGRAM_TINTS[hash % MONOGRAM_TINTS.length] ?? "#5b6770";
};
export const initials = (name: string) => {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return (words[0] ?? "?").slice(0, 2).toUpperCase();
  return `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`.toUpperCase();
};

export const isNew = (iso: string | null | undefined, now = new Date()) => {
  const date = parseDate(iso);
  return Boolean(date && now.getTime() - date.getTime() < 86_400_000);
};

export const scoreBand = (score: number) => score >= 70 ? "good" : score >= 40 ? "mid" : "low";
