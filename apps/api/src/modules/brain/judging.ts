import type { Evidence, ScoreBreakdown } from "../../core/domain";

export type JudgeableJob = {
  title: string;
  jdText: string;
  countries: string[];
  workMode: "remote" | "hybrid" | "onsite" | "unknown";
  postedAt: string | null;
};

export type Judgment = {
  roleRelevance: { value: "relevant" | "irrelevant"; confidence: number; evidence: Evidence[] };
  languageFit: { value: "pass" | "fail"; confidence: number; evidence: Evidence[] };
  remoteScope: {
    value: "remote_global" | "remote_apac" | "remote_restricted" | "onsite" | "unknown";
    confidence: number;
    evidence: Evidence[];
  };
  sponsorship: {
    value: "yes" | "no" | "unknown";
    confidence: number;
    evidence: Evidence[];
  };
  seniority: { value: "mid" | "early" | "senior" | "lead" | "unknown"; confidence: number; evidence: Evidence[] };
};

function quoteContaining(text: string, pattern: RegExp, reason: string): Evidence[] {
  const match = pattern.exec(text);
  if (!match) return [];
  const start = Math.max(0, text.lastIndexOf(".", match.index) + 1);
  const endCandidate = text.indexOf(".", match.index + match[0].length);
  const end = endCandidate < 0 ? text.length : endCandidate + 1;
  return [{ quote: text.slice(start, end).trim(), source: "JD", reason }];
}

export function judgeJob(job: JudgeableJob, aiEvidence: Evidence[], languageEvidence: Evidence[]): Judgment {
  const text = `${job.title}\n${job.jdText}`;
  const lower = text.toLowerCase();

  // Fallback only. Company boilerplate ("About us: we build AI") is not role evidence, so a
  // job without AI in the title needs at least two AI sentences in its description.
  const titleEvidence = aiEvidence.some((item) => item.source === "title");
  const roleRelevant = titleEvidence || aiEvidence.filter((item) => item.source === "JD").length >= 2;
  // Fallback rule only (Jev decides normally): fail when another language is required, not merely a plus.
  const required = /\b(german|deutsch|french|arabic|korean|japanese|mandarin|chinese|dutch|spanish|italian)\b[^.\n]{0,50}\b(required|native|fluent|mandatory|c1|c2|business[- ]level|verhandlungssicher)\b/i.exec(text);
  const languagePass = !required || /\b(plus|preferred|nice to have|bonus|advantage)\b/i.test(required[0]);
  void languageEvidence;

  let remoteScope: Judgment["remoteScope"]["value"] = "unknown";
  let remoteEvidence: Evidence[] = [];
  if (/remote (worldwide|globally|from anywhere)|work from anywhere|global remote/i.test(text)) {
    remoteScope = "remote_global";
    remoteEvidence = quoteContaining(text, /remote (worldwide|globally|from anywhere)|work from anywhere|global remote/i, "Global remote");
  } else if (/remote (within )?(apac|asia pacific)|apac remote|remote.*indonesia/i.test(text)) {
    remoteScope = "remote_apac";
    remoteEvidence = quoteContaining(text, /remote (within )?(apac|asia pacific)|apac remote|remote.*indonesia/i, "APAC remote");
  } else if (/remote.*(us only|u\.s\. only|eu only|european union only|right to work|reside in)/i.test(text)) {
    remoteScope = "remote_restricted";
    remoteEvidence = quoteContaining(text, /remote.*(us only|u\.s\. only|eu only|european union only|right to work|reside in)/i, "Restricted remote");
  } else if (job.workMode === "onsite" || job.workMode === "hybrid") {
    remoteScope = "onsite";
    remoteEvidence = quoteContaining(text, /on[- ]site|hybrid|office/i, "On-site or hybrid");
  }

  let sponsorship: Judgment["sponsorship"]["value"] = "unknown";
  let sponsorshipEvidence: Evidence[] = [];
  if (/visa sponsorship (is )?(available|provided|supported)|we sponsor|sponsorship available|relocation support/i.test(text)) {
    sponsorship = "yes";
    sponsorshipEvidence = quoteContaining(text, /visa sponsorship (is )?(available|provided|supported)|we sponsor|sponsorship available|relocation support/i, "Sponsorship available");
  } else if (/no (visa )?sponsorship|unable to sponsor|not able to sponsor|sponsorship is not/i.test(text)) {
    sponsorship = "no";
    sponsorshipEvidence = quoteContaining(text, /no (visa )?sponsorship|unable to sponsor|not able to sponsor|sponsorship is not/i, "No sponsorship");
  } else {
    sponsorshipEvidence = [{ quote: job.title, source: "title", reason: "JD contains no sponsorship statement" }];
  }

  let seniority: Judgment["seniority"]["value"] = "unknown";
  let seniorityEvidence: Evidence[] = [];
  const titleLevel = /\b(staff|principal|distinguished|lead|head|director|manager|vp)\b/i.test(job.title) ? "lead"
    : /\b(senior|sr\.?)\b/i.test(job.title) ? "senior"
    : /\b(junior|jr\.?|associate|entry)\b/i.test(job.title) ? "early"
    : null;
  if (titleLevel) {
    seniority = titleLevel;
    seniorityEvidence = [{ quote: job.title, source: "title", reason: "Level in the job title" }];
  } else if (/\b(mid|mid-level|intermediate)\b|\b3\+ years\b|\b4\+ years\b|\b5\+ years\b/i.test(text)) {
    seniority = "mid";
    seniorityEvidence = quoteContaining(text, /\b(mid|mid-level|intermediate)\b|\b[3-5]\+ years\b/i, "Mid-level");
  } else if (/\b(junior|early career|1\+ years|2\+ years)\b/i.test(text)) {
    seniority = "early";
    seniorityEvidence = quoteContaining(text, /\b(junior|early career|1\+ years|2\+ years)\b/i, "Early career");
  } else if (/\b(staff|principal|distinguished)\b/i.test(text)) {
    seniority = "lead";
    seniorityEvidence = quoteContaining(text, /\b(staff|principal|distinguished)\b/i, "Lead/Staff/Principal");
  } else if (/\b(lead|head of|manager)\b/i.test(text)) {
    seniority = "lead";
    seniorityEvidence = quoteContaining(text, /\b(lead|head of|manager)\b/i, "Lead");
  } else if (/\bsenior\b|\b6\+ years\b|\b7\+ years\b|\b8\+ years\b/i.test(text)) {
    seniority = "senior";
    seniorityEvidence = quoteContaining(text, /\bsenior\b|\b[6-8]\+ years\b/i, "Senior");
  }

  return {
    roleRelevance: {
      value: roleRelevant ? "relevant" : "irrelevant",
      confidence: roleRelevant ? 0.95 : 0.9,
      evidence: aiEvidence,
    },
    languageFit: {
      value: languagePass ? "pass" : "fail",
      confidence: languagePass ? 0.95 : 0.95,
      evidence: languageEvidence,
    },
    remoteScope: {
      value: remoteScope,
      confidence: remoteScope === "unknown" ? 0.55 : 0.9,
      evidence: remoteEvidence.length > 0 ? remoteEvidence : [{ quote: job.title, source: "title", reason: "No explicit remote scope" }],
    },
    sponsorship: {
      value: sponsorship,
      confidence: sponsorship === "unknown" ? 0.65 : 0.95,
      evidence: sponsorshipEvidence,
    },
    seniority: {
      value: seniority,
      confidence: seniority === "unknown" ? 0.55 : 0.9,
      evidence: seniorityEvidence.length > 0 ? seniorityEvidence : [{ quote: job.title, source: "title", reason: "No explicit seniority" }],
    },
  };
}

export function scoreJob(input: {
  roleFit: number;
  seniority: "mid" | "early" | "senior" | "lead" | "unknown";
  remoteScope: "remote_global" | "remote_apac" | "remote_restricted" | "onsite" | "unknown";
  sponsorship: "yes" | "no" | "unknown";
  postedAt: string | null;
  skillOverlap: number;
  countryWeight: number;
  now: Date;
  weights: {
    seniority: Record<string, number>;
    modeVisa: Record<string, number>;
    freshnessDays: Array<{ maxDays: number; weight: number }>;
  };
}): ScoreBreakdown {
  const seniorityWeight = input.weights.seniority[input.seniority] ?? 0.5;
  const modeKey =
    input.remoteScope === "remote_global"
      ? "remote_global"
      : input.remoteScope === "remote_apac"
        ? "remote_apac"
        : input.remoteScope === "remote_restricted"
          ? "remote_restricted"
          : input.sponsorship === "yes"
            ? "onsite_sponsor_yes"
            : input.sponsorship === "no"
              ? "sponsor_no"
              : "sponsor_unknown";
  const modeVisaWeight = input.weights.modeVisa[modeKey] ?? 0.5;
  const ageDays = input.postedAt
    ? Math.max(0, (input.now.getTime() - new Date(input.postedAt).getTime()) / 86_400_000)
    : 3;
  const freshnessWeight =
    input.weights.freshnessDays.find((item) => ageDays <= item.maxDays)?.weight ?? 0.3; // PRD 7.4: stale but open
  const roleFit = Math.max(0, Math.min(1, input.roleFit));
  const skillOverlap = Math.max(0, Math.min(1, input.skillOverlap));
  const countryWeight = Math.max(0, Math.min(1.2, input.countryWeight));
  const rawProduct = roleFit * seniorityWeight * modeVisaWeight * freshnessWeight * skillOverlap * countryWeight;
  return {
    roleFit,
    seniorityWeight,
    modeVisaWeight,
    freshnessWeight,
    skillOverlap,
    countryWeight,
    rawProduct,
    score: Math.round(Math.max(0, Math.min(1, rawProduct)) * 1000) / 10,
  };
}

export function groundedEvidenceValid(
  evidence: Evidence[],
  sourceText: string,
): boolean {
  return evidence.length > 0 && evidence.every((item) =>
    item.quote.trim().length > 0 && sourceText.includes(item.quote.trim()),
  );
}

export function monthlyBudgetAllows(
  spentUsd: number,
  estimatedUsd: number,
  capUsd: number,
): boolean {
  return spentUsd + estimatedUsd <= capUsd;
}
