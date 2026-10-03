export type ApiEnvelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string; details?: unknown } };

export type JobStatus = "new" | "judged" | "targeted" | "drafted" | "sent" | "replied" | "closed" | "skipped" | "blacklisted" | "pending_judge" | "unverified";
export type JobAction = "draft" | "skip" | "blacklist" | "open";
export type WorkMode = "remote" | "hybrid" | "onsite";
export type RemoteScope = "global" | "apac" | "restricted" | "onsite" | "unknown";
export type Sponsorship = "yes" | "unknown" | "no" | "registry_hit";

export interface Evidence {
  quote: string;
  context?: string;
}

export interface Contact {
  id: string;
  name: string;
  role: string;
  email: string;
  kind: "public" | "portal_public" | "recruiter_search";
  sourceUrl: string;
  sourceQuote: string;
  jevVerdict: "verified" | "unverified" | "invalid";
  invalidAt?: string | null;
}

export interface Decision {
  id: string;
  decisionId: "source_resolve" | "role_relevance" | "remote_scope" | "sponsorship" | "seniority" | "contact_valid" | "crawl_priority" | "language_fit" | "source_admit" | "reply_class" | "send_gate";
  subjectType: string;
  subjectId: string;
  verdict: string;
  confidence: number;
  input: string;
  createdAt: string;
}

export interface JobTarget {
  id: string;
  companyId: string;
  companyName: string;
  title: string;
  externalId: string;
  location: string;
  country: string;
  countries: string[];
  workMode: WorkMode;
  remoteScope: RemoteScope;
  sponsorship: Sponsorship;
  seniority: "early" | "mid" | "senior" | "lead";
  salary: string;
  postedAt: string;
  firstSeenAt: string;
  lastSeenAt: string;
  sourceUrl: string;
  applyUrl: string;
  status: JobStatus;
  score: number;
  scoreBreakdown: { roleFit: number; seniority: number; modeVisa: number; freshness: number; skillOverlapCv: number };
  aiEvidence: Evidence[];
  languageEvidence: Evidence[];
  translated: boolean;
  jevVerified: boolean;
  skipReason: string | null;
  jdText: string;
  contacts: Contact[];
  decisions: Decision[];
}

export interface Outreach {
  id: string;
  jobId: string;
  jobTitle: string;
  companyName: string;
  kind: "initial" | "followup";
  subject: string;
  body: string;
  cvVariant: string;
  status: "draft" | "scheduled" | "sent" | "replied" | "followup_due";
  scheduledFor: string | null;
  sentAt: string | null;
  gmailThreadId: string | null;
  replyClass: "positive" | "negative" | "auto_reply" | "bounce" | null;
  contactEmail: string;
}

export interface Company {
  id: string;
  name: string;
  domain: string | null;
  country: string;
  tier: "T1" | "T2" | "T3";
  sourceCount: number;
  health: "ok" | "failing" | "blocked";
  lastRunAt: string | null;
  nextDueAt: string | null;
}

export interface Source {
  id: string;
  name: string;
  kind: "ats" | "career_page" | "portal" | "gov_portal" | "community" | "aggregator_feed" | "search_dork" | "sponsor_registry" | "curated_list";
  countries: string[];
  roles: ("discovery" | "job_record" | "contact")[];
  method: "json_api" | "rss" | "sitemap" | "json_ld" | "html_selector" | "headless" | "csv_download" | "custom_adapter";
  trust: "official" | "public_listing" | "derived";
  status: "candidate" | "active" | "paused" | "blocked" | "retired";
  yieldStats: { relevantPer100: number; duplicateRatio: number; failureRate: number; lastFoundAt: string | null };
  configUrl: string;
}

export interface Profile {
  name: string;
  email: string;
  location: string;
  summary: string;
  skills: string[];
  availability: string;
  cvVariants: { id: string; name: string; roleType: string; fileName: string }[];
  countries: { code: string; name: string; weight: number }[];
  scoreWeights: { roleFit: number; seniority: number; modeVisa: number; freshness: number; skillOverlapCv: number };
  sender: string;
  dailyCap: number;
  llmBudgetUsd: number;
}

export type ConnectionName = "OPENAI_API_KEY" | "JEV_API_KEY" | "GMAIL_CLIENT_ID" | "GMAIL_CLIENT_SECRET" | "SMTP_PASSWORD";

export type Connections = Record<ConnectionName, boolean> & { GMAIL_CONNECTED: boolean };

export interface StatusStrip {
  lastRunT1: string;
  lastRunT2: string;
  lastRunT3: string;
  queueDepth: number;
  llmSpendUsd: number;
  blockedSources: number;
}

export interface DashboardData {
  targets: JobTarget[];
  outreach: Outreach[];
  companies: Company[];
  sources: Source[];
  settings: Profile;
  status: StatusStrip;
}

export interface TargetsQuery {
  age?: string;
  country?: string;
  workMode?: string;
  sponsorship?: string;
  hasEmail?: boolean;
  status?: string;
  search?: string;
}

export interface OutboxAction {
  action: "approve" | "reject" | "schedule" | "save" | "send";
  payload?: Record<string, unknown>;
}
