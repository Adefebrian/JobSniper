import { createHash } from "node:crypto";
import { ApiError } from "@core/http";
import { JEV_QUESTIONS, toVerdict } from "@core/adapters/jev";
import type { DecisionInput, Evidence, JobStatus, Settings } from "@core/domain";
import type { Clock, IdGenerator, JevPort, LunaPort } from "./ports";
import { judgeJob, monthlyBudgetAllows, scoreJob, type Judgment } from "./judging";
import { parseLocation, workModeOf } from "./location";
import { prefilterJob } from "./prefilter";
import { localAgenticFocus, preferenceModel, type FeedbackExample } from "./preference";
import { BrainRepository, type JobRow } from "./repo";

const DECISIONS = ["role_relevance", "language_fit", "remote_scope", "sponsorship", "seniority"] as const;
type DecisionKey = (typeof DECISIONS)[number];
const JUDGE_QUESTIONS = Object.fromEntries(DECISIONS.map((d) => [d, JEV_QUESTIONS[d]]));
const RETRY_MINUTES = 15;

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function str(row: JobRow, key: string, fallback = ""): string {
  return typeof row[key] === "string" ? (row[key] as string) : fallback;
}

function evidenceArray(row: JobRow, key: string): Evidence[] {
  return Array.isArray(row[key]) ? (row[key] as Evidence[]) : [];
}

function isoDate(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : null;
}

/** PRD 7.4 skill factor: neutral 0.75 with no profile, else 0.5 + 0.5 * matched/8 (capped). */
export function skillFactor(skills: string[], jdText: string): { factor: number; matched: string[] } {
  const clean = skills.map((s) => s.trim()).filter((s) => s.length > 1).slice(0, 30);
  if (clean.length === 0) return { factor: 0.75, matched: [] };
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matched = clean.filter((s) => new RegExp(`(^|[^\\w])${escape(s)}($|[^\\w])`, "i").test(jdText));
  return { factor: 0.5 + 0.5 * Math.min(1, matched.length / 8), matched };
}

// Brian's focus (beyond plain relevance): AI-assisted / agentic engineering, and his own taste.
const FOCUS_QUESTIONS = {
  agentic_focus: {
    type: "noul" as const,
    instructions:
      "The core of this role is building AI agents, LLM-powered product features, or doing AI-assisted / agentic software development (software engineer, fullstack engineer, or AI engineer), not adjacent work such as pure ML research, data engineering, infrastructure, or support.",
  },
  preference_fit: {
    type: "noul" as const,
    instructions:
      "Judging from the candidate's liked and disliked example jobs in the state, the candidate would like this job: it resembles the liked examples more than the disliked ones.",
  },
};

type Verdicts = {
  roleRelevance: number;
  languageFit: number;
  remoteScope: Judgment["remoteScope"]["value"];
  sponsorship: Judgment["sponsorship"]["value"];
  seniority: Judgment["seniority"]["value"] | "graduate";
  agenticFocus: number;
  preferenceFit: number | null;
  verifiedByJev: boolean;
};

export type JobFilters = {
  status?: string | undefined;
  country?: string | undefined;
  workMode?: string | undefined;
  sponsorship?: string | undefined;
  hasEmail?: string | undefined;
  maxAgeHours?: number | undefined;
  page: number;
  perPage: number;
};

export class BrainService {
  private nextExpiry = 0;
  private examples: FeedbackExample[] = [];
  private preference: (text: string) => number | null = () => null;

  constructor(
    private readonly repository: BrainRepository,
    private readonly luna: LunaPort,
    private readonly jev: JevPort,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly getSettings: () => Promise<Settings>,
  ) {}

  async listJobs(filters: JobFilters): Promise<Record<string, unknown>> {
    return this.repository.listJobs(filters);
  }

  async getJob(id: string): Promise<Record<string, unknown>> {
    const row = await this.repository.getJob(id);
    if (!row) throw new ApiError(404, "job_not_found", "Job was not found.");
    const decisions = await this.repository.listDecisions(id);
    return {
      ...row,
      aiEvidence: row.ai_evidence ?? [],
      languageEvidence: row.language_evidence ?? [],
      scoreBreakdown: row.score_breakdown ?? {},
      decisions,
    };
  }

  /** Brain loop: judges every job that is new, retry-due, or still waiting for Jev. */
  async processQueue(limit = 25): Promise<{ judged: number }> {
    if (Date.now() >= this.nextExpiry) {
      this.nextExpiry = Date.now() + 3_600_000;
      await this.repository.expireStale();
    }
    const ids = await this.repository.judgeQueue(limit);
    if (ids.length > 0) await this.loadFeedback();
    for (const id of ids) {
      try {
        await this.judgeOne(id);
      } catch (error) {
        await this.repository.park(id, "unverified", `Judge failed: ${(error as Error).message}`.slice(0, 500), RETRY_MINUTES);
      }
    }
    return { judged: ids.length };
  }

  private async loadFeedback(): Promise<void> {
    this.examples = await this.repository.feedbackExamples(8);
    this.preference = preferenceModel(this.examples);
  }

  async judge(id: string): Promise<Record<string, unknown>> {
    await this.loadFeedback();
    await this.judgeOne(id);
    return this.getJob(id);
  }

  private async judgeOne(id: string): Promise<void> {
    const row = await this.repository.getJob(id);
    if (!row) throw new ApiError(404, "job_not_found", "Job was not found.");
    const title = str(row, "title");
    const jdText = str(row, "jd_text");
    const location = str(row, "location");
    const settings = await this.getSettings();

    if (row.company_blacklisted === true) {
      await this.repository.updateJudgment({
        id, status: "blacklisted", aiEvidence: [], languageEvidence: [], score: 0,
        scoreBreakdown: emptyBreakdown(), skipReason: "Company is blacklisted.", jevVerified: true,
      });
      return;
    }
    if ((await this.repository.feedbackFor(id)) === "dislike") {
      await this.repository.updateJudgment({
        id, status: "skipped", aiEvidence: evidenceArray(row, "ai_evidence"), languageEvidence: [], score: 0,
        scoreBreakdown: emptyBreakdown(), skipReason: "Disliked by Brian.", jevVerified: true,
      });
      return;
    }
    const loc = parseLocation(location);
    const workMode = workModeOf(location, jdText);
    await this.repository.updateMeta(id, { countries: loc.countries, workMode });

    const prefilter = prefilterJob({ title, jdText });
    if (!prefilter.pass) {
      await this.repository.updateJudgment({
        id,
        status: "skipped",
        aiEvidence: [],
        languageEvidence: [],
        score: 0,
        scoreBreakdown: emptyBreakdown(),
        skipReason: prefilter.reason ?? "Prefilter rejected",
        jevVerified: true,
      });
      return;
    }

    const spent = await this.repository.monthlySpend(this.clock.now());
    if (!monthlyBudgetAllows(spent, 0.02, settings.monthlyLlmCapUsd)) {
      await this.repository.park(id, "pending_judge", "Monthly LLM budget cap reached; crawling continues.", 60);
      return;
    }

    // Non-English JDs that mention English are translated once, then judged in English.
    let englishText = str(row, "jd_text_english") || jdText;
    if (prefilter.language === "non_english" && !str(row, "jd_text_english")) {
      const extraction = await this.luna.extractJob({ title, jdText, language: prefilter.language });
      await this.repository.insertUsage(this.ids.newId(), extraction.usage);
      englishText = extraction.result.jdTextEnglish || jdText;
      await this.repository.setEnglishText(id, englishText);
    }

    const local = judgeJob(
      { title, jdText: englishText, countries: loc.countries, workMode, postedAt: isoDate(row.posted_at) },
      prefilter.evidence,
      prefilter.languageEvidence,
    );
    const verdicts = await this.verdicts(id, title, str(row, "company_name") || "", location, englishText, prefilter, local);

    const judge = verdicts.verifiedByJev ? "Jev" : "Local rules (Jev unreachable)";
    const reject =
      verdicts.seniority === "graduate" ? "Graduate or internship level."
      : verdicts.roleRelevance < 0.5 ? `${judge}: not an AI software engineering role.`
      : verdicts.languageFit < 0.5 ? `${judge}: needs a language other than English (or is nationality restricted).`
      : null;

    const skills = Array.isArray(settings.profile.skills) ? settings.profile.skills.map(String) : [];
    const skill = skillFactor(skills, englishText);
    const countryKey = loc.countries.find((c) => c in settings.countries) ?? "other";
    const breakdown = scoreJob({
      roleFit: verdicts.roleRelevance,
      seniority: verdicts.seniority === "graduate" ? "unknown" : verdicts.seniority,
      remoteScope: verdicts.remoteScope,
      sponsorship: verdicts.sponsorship,
      postedAt: isoDate(row.posted_at) ?? isoDate(row.first_seen_at),
      skillOverlap: skill.factor,
      countryWeight:
        verdicts.remoteScope === "remote_global" || verdicts.remoteScope === "remote_apac"
          ? 1
          : settings.countries[countryKey] ?? settings.countries.other ?? 0.5,
      now: this.clock.now(),
      weights: settings.scoringWeights,
    });
    // Brian's focus multipliers: agentic / AI-assisted work 0.7..1.0, liked-vs-disliked fit 0.6..1.0.
    const focusFactor = 0.7 + 0.3 * verdicts.agenticFocus;
    const preferenceFactor = verdicts.preferenceFit === null ? 1 : 0.6 + 0.4 * verdicts.preferenceFit;
    const finalScore = Math.round(breakdown.score * focusFactor * preferenceFactor * 10) / 10;
    await this.repository.setFocus(id, verdicts.agenticFocus, verdicts.preferenceFit);
    await this.repository.updateClassification(id, {
      remoteScope: verdicts.remoteScope,
      sponsorship: verdicts.sponsorship,
      seniority: verdicts.seniority === "graduate" ? "unknown" : verdicts.seniority,
      language: prefilter.language,
    });
    await this.repository.updateJudgment({
      id,
      status: reject ? "skipped" : "targeted",
      aiEvidence: prefilter.evidence,
      languageEvidence: prefilter.languageEvidence,
      score: reject ? 0 : finalScore,
      scoreBreakdown: {
        ...breakdown, score: finalScore, agenticFocus: verdicts.agenticFocus, focusFactor,
        preferenceFit: verdicts.preferenceFit, preferenceFactor, skillsMatched: skill.matched, jevVerified: verdicts.verifiedByJev,
      } as never,
      skipReason: reject,
      jevVerified: verdicts.verifiedByJev,
    });
    if (!reject) await this.saveContacts(id, title, jdText);
    if (!verdicts.verifiedByJev) {
      // Shown with an "unverified" label, retried, and never sendable until Jev confirms (PRD 11).
      await this.repository.scheduleRejudge(id, RETRY_MINUTES);
    }
  }

  /** Jev decides; the local rules only stand in (marked unverified) when Jev is unreachable. */
  private async verdicts(
    id: string,
    title: string,
    company: string,
    location: string,
    jdText: string,
    prefilter: ReturnType<typeof prefilterJob>,
    local: Judgment,
  ): Promise<Verdicts> {
    const state = {
      job: { title, company, location, ai_evidence: prefilter.evidence.map((e) => e.quote),
             language_mentions: prefilter.languageEvidence.map((e) => e.quote), description: jdText.slice(0, 14_000) },
      candidate: {
        location: "Indonesia (GMT+7)", citizenship: "Indonesian", works_in: "English only",
        target_level: "mid-level first (about 3-5 years), then 1-3 years, then senior, lead last",
        target_work: "AI-assisted or agentic software engineering: software engineer, fullstack engineer, or AI engineer",
      },
      ...(this.examples.length > 0 ? {
        liked_examples: this.examples.filter((e) => e.verdict === "like").map(({ title, company, evidence, note }) => ({ title, company, evidence, note })),
        disliked_examples: this.examples.filter((e) => e.verdict === "dislike").map(({ title, company, evidence, note }) => ({ title, company, evidence, note })),
      } : {}),
    };
    const localPreference = this.preference(`${title} ${prefilter.evidence.map((e) => e.quote).join(" ")}`);
    try {
      if (!this.jev.ask) throw new Error("Jev ask unavailable");
      const questions = {
        ...JUDGE_QUESTIONS,
        agentic_focus: FOCUS_QUESTIONS.agentic_focus,
        ...(this.examples.length > 0 ? { preference_fit: FOCUS_QUESTIONS.preference_fit } : {}),
      };
      const answers = await this.jev.ask(state, questions);
      const agentic = toVerdict(FOCUS_QUESTIONS.agentic_focus, answers.agentic_focus);
      const preference = this.examples.length > 0 ? toVerdict(FOCUS_QUESTIONS.preference_fit, answers.preference_fit) : null;
      const jevPreference = preference ? Number(preference.verdict.probability) : null;
      const out = {} as Record<DecisionKey, { verdict: { value: unknown; probability?: number }; confidence: number }>;
      for (const key of DECISIONS) out[key] = toVerdict(JEV_QUESTIONS[key], answers[key]) as never;
      for (const key of DECISIONS) {
        await this.recordDecision(key, id, { title, evidence: prefilter.evidence }, out[key].verdict as never, out[key].confidence);
      }
      const p = (k: DecisionKey) => Number(out[k].verdict.probability ?? (out[k].verdict.value ? 1 : 0));
      return {
        roleRelevance: p("role_relevance"),
        languageFit: p("language_fit"),
        remoteScope: String(out.remote_scope.verdict.value) as Verdicts["remoteScope"],
        sponsorship: String(out.sponsorship.verdict.value) as Verdicts["sponsorship"],
        seniority: String(out.seniority.verdict.value) as Verdicts["seniority"],
        agenticFocus: Number(agentic.verdict.probability),
        // Jev's reading of the examples, blended with the word-level model learned from them.
        preferenceFit: jevPreference === null ? null : localPreference === null ? jevPreference : 0.7 * jevPreference + 0.3 * localPreference,
        verifiedByJev: true,
      };
    } catch {
      return {
        roleRelevance: local.roleRelevance.value === "relevant" ? 0.8 : 0,
        languageFit: local.languageFit.value === "pass" ? 0.8 : 0,
        remoteScope: local.remoteScope.value,
        sponsorship: local.sponsorship.value,
        seniority: local.seniority.value,
        agenticFocus: localAgenticFocus(title, jdText),
        preferenceFit: localPreference,
        verifiedByJev: false,
      };
    }
  }

  private async saveContacts(jobId: string, title: string, jdText: string): Promise<void> {
    const found = publicEmails(jdText);
    if (found.length === 0) return;
    const contacts: Array<{ email: string; quote: string; verdict: unknown }> = [];
    for (const item of found) {
      let verdict: unknown;
      try {
        if (this.jev.ask) {
          const answers = await this.jev.ask(
            { job_title: title, email: item.email, source_quote: item.quote },
            { contact_valid: JEV_QUESTIONS.contact_valid },
          );
          verdict = toVerdict(JEV_QUESTIONS.contact_valid, answers.contact_valid).verdict;
          if ((verdict as { value?: unknown }).value === false) continue;
        }
      } catch {
        verdict = undefined; // kept, shown as not yet verified by Jev
      }
      contacts.push({ ...item, verdict });
    }
    await this.repository.insertPublicContacts(jobId, contacts);
  }

  async patchJob(id: string, patch: {
    status?: JobStatus;
    score?: number;
    aiEvidence?: Evidence[];
    skipReason?: string;
  }): Promise<Record<string, unknown>> {
    const row = await this.repository.getJob(id);
    if (!row) throw new ApiError(404, "job_not_found", "Job was not found.");
    if (patch.aiEvidence && patch.aiEvidence.length === 0) {
      throw new ApiError(400, "evidence_required", "A target must retain at least one exact AI evidence quote.");
    }
    await this.repository.updateJudgment({
      id,
      status: patch.status ?? (str(row, "status", "new") as JobStatus),
      aiEvidence: patch.aiEvidence ?? evidenceArray(row, "ai_evidence"),
      languageEvidence: evidenceArray(row, "language_evidence"),
      score: patch.score ?? Number(row.score ?? 0),
      scoreBreakdown: (row.score_breakdown ?? {}) as never,
      skipReason: patch.skipReason ?? (typeof row.skip_reason === "string" ? row.skip_reason : null),
      jevVerified: row.jev_verified === true,
    });
    if (patch.status === "blacklisted") await this.repository.blacklistCompanyOf(id);
    return this.getJob(id);
  }

  async operationalCounts(): Promise<Record<string, number>> {
    return this.repository.databaseCounts();
  }

  private async recordDecision(
    decisionId: DecisionKey,
    subjectId: string,
    input: DecisionInput,
    verdict: Record<string, unknown> & { value: unknown },
    confidence: number,
  ): Promise<void> {
    await this.repository.insertDecision({
      id: this.ids.newId(),
      decisionId,
      subjectType: "job",
      subjectId,
      inputDigest: digest(input),
      input,
      verdict: verdict as never,
      confidence,
    });
  }
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const NOT_FOR_APPLYING = /(privacy|gdpr|dpo|data\.?protection|legal|abuse|no-?reply|donotreply|example\.|accommodat|accessibility|security@|press@|media@|investor|billing|invoice|support@|help@)/i;

/** Emails written in the JD, each with the sentence it appears in as proof. */
export function publicEmails(jdText: string): Array<{ email: string; quote: string }> {
  const out = new Map<string, string>();
  for (const sentence of jdText.split(/(?<=[.!?])\s+|\n+/)) {
    for (const match of sentence.matchAll(EMAIL)) {
      const email = match[0].replace(/[.]+$/, "");
      if (NOT_FOR_APPLYING.test(email) || out.has(email.toLowerCase())) continue;
      out.set(email.toLowerCase(), sentence.trim().slice(0, 400));
    }
  }
  return [...out].map(([email, quote]) => ({ email, quote }));
}

function emptyBreakdown() {
  return {
    roleFit: 0, seniorityWeight: 0, modeVisaWeight: 0, freshnessWeight: 0,
    skillOverlap: 0, countryWeight: 0, rawProduct: 0, score: 0,
  };
}
