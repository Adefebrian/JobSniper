import { describe, expect, test } from "bun:test";
import {
  adjustedTier,
  catchUpOrder,
  nextDue,
  queuePriority,
  retryBackoffSeconds,
} from "../src/modules/scheduler";

describe("scheduler policy", () => {
  test("uses tiered crawl cadence and a twelve-hour closed check", () => {
    const now = new Date("2026-10-03T00:00:00.000Z");
    expect(nextDue(now, 1).toISOString()).toBe("2026-10-03T01:00:00.000Z");
    expect(nextDue(now, 2).toISOString()).toBe("2026-10-03T03:00:00.000Z");
    expect(nextDue(now, 3).toISOString()).toBe("2026-10-04T00:00:00.000Z");
    expect(nextDue(now, 3, "closed_check").toISOString()).toBe("2026-10-03T12:00:00.000Z");
  });

  test("catch-up and queue priority put T1 first", () => {
    expect(catchUpOrder([3, 1, 2])).toEqual([1, 2, 3]);
    expect(queuePriority(1, "crawl")).toBeGreaterThan(queuePriority(2, "crawl"));
    expect(queuePriority(2, "crawl")).toBeGreaterThan(queuePriority(3, "crawl"));
    expect(queuePriority(1, "closed_check")).toBe(90);
  });

  test("crawl priority promotes productive sources and demotes failures", () => {
    expect(adjustedTier({ current: 3, relevantJobs: 2, failures: 0, successRate: 0.95 })).toBe(2);
    expect(adjustedTier({ current: 1, relevantJobs: 0, failures: 3, successRate: 0.2 })).toBe(2);
    expect(adjustedTier({ current: 2, relevantJobs: 1, failures: 1, successRate: 0.8 })).toBe(2);
  });

  test("retry backoff is exponential and capped at twenty-four hours", () => {
    expect(retryBackoffSeconds(1)).toBe(120);
    expect(retryBackoffSeconds(4)).toBe(960);
    expect(retryBackoffSeconds(20)).toBe(86_400);
  });
});
