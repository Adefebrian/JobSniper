// TypeSafe Jev (System One): typed judgments about a text state.
// POST https://api.typesafe.ai/v1/systemone  {model, state, questions} -> {answers}
// noul = calibrated probability the statement is true, choice = one key of `criteria`.
import { ApiError } from "../http";
import type { JevAnswer, JevDecision, JevPort, JevQuestion } from "../ports/ai";
import type { CredentialStore } from "../ports/runtime";

type DecisionId = Parameters<JevPort["decide"]>[0]["decisionId"];

// One question per catalog decision, so every caller of decide() gets a real judgment.
const QUESTIONS: Record<DecisionId, JevQuestion> = {
  role_relevance: {
    type: "noul",
    instructions:
      "The job is a software engineering role (fullstack, backend, AI engineer, LLM/GenAI engineer, applied AI, or product-facing ML engineer) whose title or description clearly involves AI, LLMs, machine learning, agents, or AI-assisted/agentic coding. It is not sales, pure research without engineering, data labeling, an internship, or a graduate program.",
  },
  language_fit: {
    type: "noul",
    instructions:
      "The job can be done in English only: English is the working language and no other language (German, Arabic, Korean, Japanese, French, Mandarin, or any other) is required. A language listed only as a plus or preferred does not count as required. If the job is in Saudi Arabia, it is not restricted to Saudi nationals.",
  },
  remote_scope: {
    type: "choice",
    instructions: "Where can the hired person work from?",
    criteria: {
      remote_global: "Fully remote and open to candidates worldwide",
      remote_apac: "Remote and open to candidates in Asia, APAC, or Indonesia",
      remote_restricted: "Remote but limited to specific countries or regions, or requires existing local work authorization",
      onsite: "On-site or hybrid at an office",
      unknown: "The description does not say",
    },
  },
  sponsorship: {
    type: "choice",
    instructions: "What does the description say about visa sponsorship or relocation?",
    criteria: {
      yes: "It offers visa sponsorship or relocation support",
      no: "It says no sponsorship, or candidates must already have the right to work",
      unknown: "It does not say",
    },
  },
  seniority: {
    type: "choice",
    instructions: "Which experience level does the job target?",
    criteria: {
      graduate: "Internship, graduate, new grad, or entry program",
      early: "About 1 to 3 years of experience",
      mid: "About 3 to 5 years of experience",
      senior: "Senior, 5 or more years",
      lead: "Lead, Staff, Principal, or engineering manager",
      unknown: "The description does not say",
    },
  },
  source_resolve: {
    type: "noul",
    instructions: "The URL in the state is the official career page or ATS board of the company named in the state.",
  },
  contact_valid: {
    type: "noul",
    instructions:
      "The email address in the state belongs to the hiring company (or its recruiter) and is meant for job applications or hiring questions, as shown by the quoted source.",
  },
  crawl_priority: {
    type: "choice",
    instructions: "How often should this source be crawled, given its relevant job yield and failures?",
    criteria: { "1": "Every hour: it yields relevant AI engineering jobs", "2": "Every 3 hours: occasional yield", "3": "Daily: little or no yield" },
  },
  source_admit: {
    type: "noul",
    instructions:
      "This source is a public job listing source (no login needed) that is likely to list English-language AI software engineering jobs not already covered by company career pages.",
  },
  reply_class: {
    type: "choice",
    instructions: "Classify this reply to a job application email.",
    criteria: {
      positive: "Interested: asks for a call, CV, or next step",
      negative: "Not interested, position filled, or asks not to be contacted",
      auto_reply: "Automatic reply (out of office, acknowledgement)",
      bounce: "Delivery failure or bounce notice",
    },
  },
  send_gate: {
    type: "noul",
    instructions:
      "This application email is safe to send now: the gate checks in the state all pass, the job is still open, the body is a genuine personal application, and nothing in it is invented.",
  },
};

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const MAX_STATE_CHARS = 24_000; // Jev context window is 32K tokens

export class JevClient implements JevPort {
  constructor(
    private readonly model: string,
    private readonly credentials: CredentialStore,
    private readonly endpoint = ENDPOINT,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** Asks several questions about one state in a single call. Throws on any failure. */
  async ask(state: unknown, questions: Record<string, JevQuestion>): Promise<Record<string, JevAnswer>> {
    const apiKey = (await this.credentials.get("JEV_API_KEY")) ?? process.env.JEV_API_KEY;
    if (!apiKey) throw new ApiError(503, "jev_credentials_missing", "JEV_API_KEY is not configured.");
    let body = typeof state === "string" ? state : JSON.stringify(state);
    if (body.length > MAX_STATE_CHARS) body = body.slice(0, MAX_STATE_CHARS);
    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: this.model, state: body, questions }),
      signal: AbortSignal.timeout(20_000),
    });
    const payload = (await response.json().catch(() => ({}))) as { answers?: Record<string, JevAnswer>; error?: unknown };
    if (!response.ok) {
      throw new ApiError(503, "jev_unavailable", `Jev request failed with ${response.status}.`);
    }
    if (!payload.answers || typeof payload.answers !== "object") {
      throw new ApiError(502, "jev_invalid_response", "Jev returned no answers.");
    }
    return payload.answers;
  }

  async decide(input: Parameters<JevPort["decide"]>[0]): Promise<JevDecision> {
    const question = QUESTIONS[input.decisionId];
    const answers = await this.ask(input.input, { q: question });
    const verdict = toVerdict(question, answers.q);
    return {
      decisionId: input.decisionId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      input: input.input,
      verdict: verdict.verdict,
      confidence: verdict.confidence,
    };
  }
}

export function toVerdict(question: JevQuestion, answer: JevAnswer | undefined) {
  if (question.type === "noul") {
    const p = answer?.noul;
    if (typeof p !== "number" || !(p >= 0 && p <= 1)) {
      throw new ApiError(502, "jev_invalid_response", "Jev returned an invalid probability.");
    }
    return { verdict: { value: p >= 0.5, probability: p }, confidence: Math.max(p, 1 - p) };
  }
  const choice = answer?.choice;
  if (!choice || !(choice in question.criteria)) {
    throw new ApiError(502, "jev_invalid_response", "Jev returned an invalid choice.");
  }
  const confidence = typeof answer?.confidence === "number" ? Math.min(1, Math.max(0, answer.confidence)) : 0.5;
  return { verdict: { value: choice, probabilities: answer?.probabilities ?? {} }, confidence };
}

export const JEV_QUESTIONS = QUESTIONS;
