import type { DecisionInput, DecisionVerdict, Evidence } from "../domain";

export type LlmUsage = {
  model: string;
  purpose: string;
  requestId: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
};

export type ParsedProfile = {
  profile: Record<string, unknown>;
  sourceText: string;
};

export type JobExtraction = {
  title: string;
  location: string | null;
  countries: string[];
  workMode: "remote" | "hybrid" | "onsite" | "unknown";
  remoteScope: "remote_global" | "remote_apac" | "remote_restricted" | "onsite" | "unknown";
  sponsorship: "yes" | "no" | "unknown";
  seniority: "mid" | "early" | "senior" | "lead" | "unknown";
  salary: string | null;
  requirements: string[];
  jdTextEnglish: string;
  translated: boolean;
  evidence: Evidence[];
};

export type GroundedDraft = {
  subject: string;
  body: string;
  whyCompany: string;
  evidence: Evidence[];
};

export interface LunaPort {
  parseProfile(input: { sourceText: string }): Promise<{ result: ParsedProfile; usage: LlmUsage }>;
  extractJob(input: {
    title: string;
    jdText: string;
    language: string;
  }): Promise<{ result: JobExtraction; usage: LlmUsage }>;
  draftEmail(input: {
    profile: Record<string, unknown>;
    job: Record<string, unknown>;
    sourceText: string;
  }): Promise<{ result: GroundedDraft; usage: LlmUsage }>;
}

export type JevDecision = {
  decisionId: string;
  subjectType: string;
  subjectId: string;
  input: DecisionInput;
  verdict: DecisionVerdict;
  confidence: number;
};

export type JevQuestion =
  | { type: "noul"; instructions: string }
  | { type: "choice"; instructions: string; criteria: Record<string, string> };

export type JevAnswer = {
  type?: string;
  noul?: number;
  choice?: string;
  confidence?: number;
  probabilities?: Record<string, number>;
};

export interface JevPort {
  /** Several questions about one state in one call (used by the brain). */
  ask?(state: unknown, questions: Record<string, JevQuestion>): Promise<Record<string, JevAnswer>>;
  decide(input: {
    decisionId:
      | "source_resolve"
      | "role_relevance"
      | "remote_scope"
      | "sponsorship"
      | "seniority"
      | "contact_valid"
      | "crawl_priority"
      | "language_fit"
      | "source_admit"
      | "reply_class"
      | "send_gate";
    subjectType: string;
    subjectId: string;
    input: DecisionInput;
  }): Promise<JevDecision>;
}
