import { describe, expect, test } from "bun:test";
import { sourceYieldAction, updateYieldStats, CompaniesService } from "../src/modules/companies";
import type { YieldStats } from "../src/modules/companies";

const thresholds = { minRelevantPer100: 1, maxDuplicateRatio: 0.95, observationDays: 14 };

describe("source registry policy", () => {
  test("keeps a low-yield source active during its observation window", () => {
    const start = new Date("2026-10-01T00:00:00Z");
    const stats: YieldStats = {
      itemsSeen: 100, relevantJobs: 0, duplicateJobs: 0, failures: 0,
      firstYieldAt: start.toISOString(), lastYieldAt: start.toISOString(),
    };
    expect(sourceYieldAction(stats, thresholds, new Date("2026-10-10T00:00:00Z"), start)).toBe("active");
    expect(sourceYieldAction(stats, thresholds, new Date("2026-10-16T00:00:00Z"), start)).toBe("paused");
  });

  test("pauses duplicate-heavy sources after the observation window", () => {
    const start = new Date("2026-09-01T00:00:00Z");
    const stats = updateYieldStats({
      itemsSeen: 99, relevantJobs: 2, duplicateJobs: 95, failures: 0, firstYieldAt: start.toISOString(), lastYieldAt: start.toISOString(),
    }, { duplicate: true, at: new Date("2026-10-03T00:00:00Z") });
    expect(sourceYieldAction(stats, thresholds, new Date("2026-10-03T00:00:00Z"), start)).toBe("paused");
  });
});

describe("source admission", () => {
  test("high-confidence generic public sources enter a seven-day active trial", async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const repository = {
      insertSource: async (input: Record<string, unknown>) => {
        inserted.push(input);
        return { id: input.id, ...input, yield_stats: {} };
      },
    };
    const service = new CompaniesService(
      repository as never,
      { enqueueDiscovery: async () => true },
      {
        decide: async () => ({
          decisionId: "source_admit", subjectType: "source", subjectId: "source-1",
          input: {}, verdict: { value: true }, confidence: 0.9,
        }),
      },
      { now: () => new Date("2026-10-03T00:00:00Z") },
      { newId: () => "source-1" },
      {
        schedulerStatus: async () => ({}), brainStatus: async () => ({}),
        outreachStatus: async () => ({}), monthlyLlmSpend: async () => 0,
      },
      async () => ({
        profile: {}, cvVariants: {}, countries: { other: 0.5 },
        scoringWeights: {
          seniority: {}, modeVisa: {}, freshnessDays: [{ maxDays: 1, weight: 1 }], skillOverlap: 1, country: 1,
        },
        sender: { provider: "gmail", fromEmail: "", fromName: "" }, dailySendCap: 20, monthlyLlmCapUsd: 30,
        modelPrices: {}, workWindows: { startHour: 8, endHour: 11, days: [2] },
        sourceYield: thresholds,
      }),
    );
    const source = await service.addSource({ name: "Example careers", url: "https://example.com/careers", method: "json_api" });
    expect(source.status).toBe("active");
    expect(source.trialUntil).toBe("2026-10-10T00:00:00.000Z");
    expect(inserted[0]?.admittedBy).toBe("jev");
  });
});
