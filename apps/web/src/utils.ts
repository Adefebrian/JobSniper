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
