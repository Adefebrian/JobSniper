export type Uuid = string;

export type JobStatus =
  | "new"
  | "judged"
  | "targeted"
  | "drafted"
  | "sent"
  | "replied"
  | "closed"
  | "skipped"
  | "blacklisted"
  | "pending_judge"
  | "unverified";

export type Evidence = {
  quote: string;
  source: string;
  reason: string;
};

export type DecisionVerdict = Record<string, unknown> & {
  value: string | boolean | number;
};

export type DecisionInput = Record<string, unknown> & {
  evidence?: Evidence[];
};

export type ScoreBreakdown = {
  roleFit: number;
  seniorityWeight: number;
  modeVisaWeight: number;
  freshnessWeight: number;
  skillOverlap: number;
  countryWeight: number;
  rawProduct: number;
  score: number;
};

export type JobRecord = {
  id: Uuid;
  companyId: Uuid;
  sourceId: Uuid | null;
  externalId: string | null;
  title: string;
  url: string;
  applyUrl: string;
  location: string | null;
  countries: string[];
  workMode: "remote" | "hybrid" | "onsite" | "unknown";
  remoteScope: "remote_global" | "remote_apac" | "remote_restricted" | "onsite" | "unknown";
  sponsorship: "yes" | "no" | "unknown" | "onsite_sponsor_yes" | "sponsor_unknown" | "sponsor_no";
  sponsorRegistryHit: boolean;
  seniority: "mid" | "early" | "senior" | "lead" | "unknown";
  salary: string | null;
  postedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  closedAt: string | null;
  jdText: string;
  jdTextEnglish: string | null;
  jdHash: string;
  aiEvidence: Evidence[];
  languageEvidence: Evidence[];
  score: number | null;
  scoreBreakdown: ScoreBreakdown | Record<string, never>;
  status: JobStatus;
  skipReason: string | null;
};

export type ContactRecord = {
  id: Uuid;
  companyId: Uuid;
  jobId: Uuid | null;
  email: string;
  name: string | null;
  role: string | null;
  kind: "public" | "portal_public" | "recruiter_search";
  sourceUrl: string;
  sourceQuote: string;
  invalidAt: string | null;
};

export type OutreachRecord = {
  id: Uuid;
  jobId: Uuid;
  contactId: Uuid | null;
  kind: "initial" | "followup";
  subject: string;
  body: string;
  cvVariant: string;
  status: "draft" | "approved" | "scheduled" | "sending" | "sent" | "replied" | "closed" | "failed";
  scheduledFor: string | null;
  sentAt: string | null;
  gmailThreadId: string | null;
  replyClass: "positive" | "negative" | "auto_reply" | "bounce" | null;
  replyText: string | null;
  lastError: string | null;
};

export type Settings = {
  profile: Record<string, unknown>;
  cvVariants: Record<string, string>;
  countries: Record<string, number>;
  scoringWeights: {
    seniority: Record<string, number>;
    modeVisa: Record<string, number>;
    freshnessDays: Array<{ maxDays: number; weight: number }>;
    skillOverlap: number;
    country: number;
  };
  sender: {
    provider: "gmail" | "smtp" | "disabled";
    fromEmail: string;
    fromName: string;
    smtpHost?: string;
    smtpPort?: number;
    smtpUser?: string;
  };
  dailySendCap: number;
  monthlyLlmCapUsd: number;
  modelPrices: Record<string, { inputPerMillion: number; outputPerMillion: number }>;
  workWindows: { startHour: number; endHour: number; days: number[] };
  sourceYield: { minRelevantPer100: number; maxDuplicateRatio: number; observationDays: number };
};
