import { createHash } from "node:crypto";
import { ApiError } from "../../core/http";
import type { DecisionInput, Evidence, JobStatus, Settings } from "../../core/domain";
import type { Clock, IdGenerator, JevPort, LunaPort } from "./ports";
import { groundedEvidenceValid, judgeJob, monthlyBudgetAllows, scoreJob } from "./judging";
import { prefilterJob } from "./prefilter";
import { BrainRepository, type JobRow } from "./repo";

const DECISIONS = ["role_relevance", "language_fit", "remote_scope", "sponsorship", "seniority"] as const;

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function jobString(row: JobRow, key: string, fallback = ""): string {
  return typeof row[key] === "string" ? row[key] : fallback;
}

function jobArray(row: JobRow, key: string): string[] {
  return Array.isArray(row[key]) ? row[key] as string[] : [];
}

function evidenceArray(row: JobRow, key: string): Evidence[] {
  return Array.isArray(row[key]) ? row[key] as Evidence[] : [];
}

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

  async judge(id: string): Promise<Record<string, unknown>> {
    const row = await this.repository.getJob(id);
    if (!row) throw new ApiError(404, "job_not_found", "Job was not found.");
    const title = jobString(row, "title");
    const jdText = jobString(row, "jd_text");
    const prefilter = prefilterJob({ title, jdText });
    if (!prefilter.pass) {
      await this.recordDecision("role_relevance", id, {
        title,
        excerpt: jdText.slice(0, 2_000),
        evidence: prefilter.evidence,
      }, {
        value: "irrelevant",
        reason: prefilter.reason ?? "Prefilter rejected",
      }, 0.99);
      await this.repository.updateJudgment({
        id,
        status: "skipped",
        aiEvidence: prefilter.evidence,
        languageEvidence: prefilter.languageEvidence,
        score: 0,
        scoreBreakdown: {
          roleFit: 0,
          seniorityWeight: 0,
          modeVisaWeight: 0,
          freshnessWeight: 0,
          skillOverlap: 0,
          countryWeight: 0,
          rawProduct: 0,
          score: 0,
        },
        skipReason: prefilter.reason ?? "Prefilter rejected",
      });
      return this.getJob(id);
    }

    const settings = await this.getSettings();
    const spent = await this.repository.monthlySpend(this.clock.now());
    const estimated = 0.05;
    if (!monthlyBudgetAllows(spent, estimated, settings.monthlyLlmCapUsd)) {
      await this.repository.updatePending(id, "pending_judge", "Monthly LLM budget cap reached.");
      throw new ApiError(429, "llm_budget_cap", "Monthly LLM budget cap reached; crawling continues.");
    }

    let translatedText = jdText;
    if (prefilter.language === "non_english") {
      const extraction = await this.luna.extractJob({
        title,
        jdText,
        language: prefilter.language,
      });
      await this.repository.insertUsage(this.ids.newId(), extraction.usage);
      if (!groundedEvidenceValid(extraction.result.evidence, `${title}\n${jdText}`)) {
        await this.repository.updatePending(id, "unverified", "Translation/extraction evidence is not grounded.");
        throw new ApiError(502, "ungrounded_extraction", "Extracted job evidence does not quote the source.");
      }
      translatedText = extraction.result.jdTextEnglish;
    }

    const local = judgeJob({
      title,
      jdText: translatedText,
      countries: jobArray(row, "countries"),
      workMode: jobString(row, "work_mode", "unknown") as "remote" | "hybrid" | "onsite" | "unknown",
      postedAt: typeof row.posted_at === "string" ? row.posted_at : null,
    }, prefilter.evidence, prefilter.languageEvidence);

    for (const decisionId of DECISIONS) {
      const localDecision =
        decisionId === "role_relevance" ? local.roleRelevance :
        decisionId === "language_fit" ? local.languageFit :
        decisionId === "remote_scope" ? local.remoteScope :
        decisionId === "sponsorship" ? local.sponsorship :
        local.seniority;
      const input: DecisionInput = {
        title,
        jdText: translatedText.slice(0, 12_000),
        evidence: localDecision.evidence,
      };
      try {
        const decision = await this.jev.decide({
          decisionId,
          subjectType: "job",
          subjectId: id,
          input,
        });
        await this.recordDecision(decisionId, id, input, {
          value: localDecision.value,
          jevValue: decision.verdict.value,
        }, Math.min(decision.confidence, localDecision.confidence));
      } catch (error) {
        await this.repository.updatePending(id, "unverified", `Jev ${decisionId} failed.`);
        throw error;
      }
    }

    const countryKey = jobArray(row, "countries")[0] ?? "other";
    const countryWeight = settings.countries[countryKey] ?? settings.countries.other ?? 0.5;
    const breakdown = scoreJob({
      roleFit: local.roleRelevance.value === "relevant" ? 1 : 0,
      seniority: local.seniority.value,
      remoteScope: local.remoteScope.value,
      sponsorship: local.sponsorship.value,
      postedAt: typeof row.posted_at === "string" ? row.posted_at : null,
      skillOverlap: this.skillOverlap(settings.profile, translatedText),
      countryWeight,
      now: this.clock.now(),
      weights: settings.scoringWeights,
    });
    const languagePass = local.languageFit.value === "pass";
    const rolePass = local.roleRelevance.value === "relevant";
    const status: JobStatus = languagePass && rolePass ? "targeted" : "skipped";
    await this.repository.updateJudgment({
      id,
      status,
      aiEvidence: prefilter.evidence,
      languageEvidence: prefilter.languageEvidence,
      score: breakdown.score,
      scoreBreakdown: breakdown,
      skipReason: status === "targeted"
        ? null
        : !languagePass
          ? "Working language requirements failed."
          : "Role relevance failed.",
    });
    return this.getJob(id);
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
      status: patch.status ?? (jobString(row, "status", "new") as JobStatus),
      aiEvidence: patch.aiEvidence ?? evidenceArray(row, "ai_evidence"),
      languageEvidence: evidenceArray(row, "language_evidence"),
      score: patch.score ?? Number(row.score ?? 0),
      scoreBreakdown: (row.score_breakdown ?? {}) as never,
      skipReason: patch.skipReason ?? (typeof row.skip_reason === "string" ? row.skip_reason : null),
    });
    return this.getJob(id);
  }

  async operationalCounts(): Promise<Record<string, number>> {
    return this.repository.databaseCounts();
  }

  private skillOverlap(profile: Record<string, unknown>, jdText: string): number {
    const skills = Array.isArray(profile.skills) ? profile.skills.map((skill) => String(skill).toLowerCase()) : [];
    if (skills.length === 0) return 0.5;
    const jd = jdText.toLowerCase();
    return skills.filter((skill) => skill.length > 1 && jd.includes(skill)).length / skills.length;
  }

  private async recordDecision(
    decisionId: (typeof DECISIONS)[number],
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
