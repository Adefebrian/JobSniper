import { createHash } from "node:crypto";
import { ApiError } from "@core/http";
import { JEV_QUESTIONS, toVerdict } from "@core/adapters/jev";
import type { DecisionInput, Evidence, JobStatus, Settings } from "@core/domain";
import type { Clock, IdGenerator, JevPort, LunaPort } from "./ports";
import { judgeJob, monthlyBudgetAllows, scoreJob, type Judgment } from "./judging";
import { parseLocation, workModeOf } from "./location";
import { prefilterJob } from "./prefilter";
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

type Verdicts = {
  roleRelevance: number;
  languageFit: number;
  remoteScope: Judgment["remoteScope"]["value"];
  sponsorship: Judgment["sponsorship"]["value"];
  seniority: Judgment["seniority"]["value"] | "graduate";
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
    const ids = await this.repository.judgeQueue(limit);
    for (const id of ids) {
      try {
        await this.judgeOne(id);
      } catch (error) {
        await this.repository.park(id, "unverified", `Judge failed: ${(error as Error).message}`.slice(0, 500), RETRY_MINUTES);
      }
    }
    return { judged: ids.length };
  }

  async judge(id: string): Promise<Record<string, unknown>> {
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
      score: reject ? 0 : breakdown.score,
      scoreBreakdown: { ...breakdown, skillsMatched: skill.matched, jevVerified: verdicts.verifiedByJev } as never,
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
      candidate: { location: "Indonesia (GMT+7)", citizenship: "Indonesian", works_in: "English only" },
    };
    try {
      if (!this.jev.ask) throw new Error("Jev ask unavailable");
      const answers = await this.jev.ask(state, JUDGE_QUESTIONS);
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
        verifiedByJev: true,
      };
    } catch {
      return {
        roleRelevance: local.roleRelevance.value === "relevant" ? 0.8 : 0,
        languageFit: local.languageFit.value === "pass" ? 0.8 : 0,
        remoteScope: local.remoteScope.value,
        sponsorship: local.sponsorship.value,
        seniority: local.seniority.value,
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
