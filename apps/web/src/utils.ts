import type { JobTarget, TargetsQuery, Outreach } from "./types.ts";

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

export const formatAge = (iso: string, now = new Date()) => {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
};

export const formatDateTime = (iso: string | null) => {
  if (!iso) return "Not scheduled";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
};

export const filterTargets = (targets: JobTarget[], query: TargetsQuery, now = new Date()) => {
  return targets.filter((job) => {
    const ageHours = (now.getTime() - new Date(job.firstSeenAt).getTime()) / 3_600_000;
    if (query.age === "24h" && ageHours > 24) return false;
    if (query.age === "72h" && ageHours > 72) return false;
    if (query.age === "7d" && ageHours > 168) return false;
    if (query.country && job.country !== query.country) return false;
    if (query.workMode && job.workMode !== query.workMode) return false;
    if (query.sponsorship && job.sponsorship !== query.sponsorship) return false;
    if (query.hasEmail && !job.contacts.some((contact) => contact.email && contact.jevVerdict === "verified")) return false;
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
