import { describe, expect, test } from "bun:test";
import { filterOutreach, filterTargets, formatAge, scoreLabel } from "../src/utils.ts";
import { sampleData } from "../src/sample-data.ts";

describe("target utilities", () => {
  test("sorts targets by score and filters by work mode", () => {
    const result = filterTargets(sampleData.targets, { workMode: "remote" });
    expect(result.map((job) => job.id)).toEqual(["job-northstar", "job-solace"]);
    expect(result[0]?.score).toBeGreaterThanOrEqual(result[1]?.score ?? 0);
  });

  test("filters targets by verified contact", () => {
    const result = filterTargets(sampleData.targets, { hasEmail: true });
    expect(result.map((job) => job.id).sort()).toEqual(["job-northstar", "job-solace"]);
  });

  test("formats compact age labels", () => {
    const now = new Date("2026-10-03T12:00:00Z");
    expect(formatAge("2026-10-03T11:30:00Z", now)).toBe("30m");
    expect(formatAge("2026-10-02T09:00:00Z", now)).toBe("1d");
    expect(formatAge("2026-09-25T12:00:00Z", now)).toBe("8d");
    expect(formatAge("", now)).toBe("never");
    expect(formatAge("2026-10-03 18:45:00.000000+07", now)).toBe("15m");
  });

  test("uses transparent score labels", () => {
    expect(scoreLabel(94)).toBe("Strong fit");
    expect(scoreLabel(82)).toBe("Good fit");
    expect(scoreLabel(76)).toBe("Good fit");
    expect(scoreLabel(52)).toBe("Review fit");
  });
});

describe("outreach utilities", () => {
  test("maps workflow tabs to records", () => {
    expect(filterOutreach(sampleData.outreach, "draft").map((item) => item.id)).toEqual(["outreach-1"]);
    expect(filterOutreach(sampleData.outreach, "scheduled").map((item) => item.id)).toEqual(["outreach-2"]);
    expect(filterOutreach(sampleData.outreach, "followup_due").map((item) => item.id)).toEqual(["outreach-3"]);
  });
});

import { ageGroup, placeLabel } from "../src/utils.ts";

describe("place labels", () => {
  test("shorten messy listing locations without cutting words", () => {
    expect(placeLabel("London, United Kingdom", "UK")).toBe("London, UK");
    expect(placeLabel("Sunnyvale, California USA", "US")).toBe("Sunnyvale, US");
    expect(placeLabel("San Francisco, CA | New York City, NY | Washington, DC", "US")).toBe("San Francisco, US +2");
    expect(placeLabel("AU: Sydney (45 Clarence St)", "AU")).toBe("Sydney, Australia");
    expect(placeLabel("Europe, USA, UK, Canada, Australia, Ireland", "Other")).toBe("5 countries");
    expect(placeLabel("Singapore", "SG")).toBe("Singapore");
    expect(placeLabel("Berlin, DE", "DE")).toBe("Berlin, Germany");
    expect(placeLabel("", "")).toBe("Location not stated");
  });

  test("group rows by age", () => {
    const now = new Date(2026, 9, 3, 15, 0);
    expect(ageGroup(new Date(2026, 9, 3, 9, 0).toISOString(), now)).toBe("Today");
    expect(ageGroup(new Date(2026, 9, 1, 9, 0).toISOString(), now)).toBe("This week");
    expect(ageGroup(new Date(2026, 8, 1, 9, 0).toISOString(), now)).toBe("Older");
  });
});

import { emailFirst, jdBlocks } from "../src/utils.ts";

describe("email-first targets", () => {
  test("keeps jobs with an apply address above higher-scoring ones", () => {
    const form = { ...sampleData.targets[0]!, id: "form", score: 99, applyMethod: "form" as const, applyEmail: null };
    const email = { ...sampleData.targets[0]!, id: "email", score: 10, applyMethod: "email" as const, applyEmail: "jobs@x.io" };
    expect(filterTargets([form, email], {}).map((job) => job.id)).toEqual(["email", "form"]);
    expect(emailFirst(email, form)).toBeLessThan(0);
  });
});

describe("job description blocks", () => {
  test("reads headings, bullet lists, and paragraphs", () => {
    const blocks = jdBlocks("## About us\nWe build agents.\nWhat you will do:\n• Ship evals\n• Own the API\nApply by email.");
    expect(blocks.map((block) => block.kind)).toEqual(["heading", "para", "heading", "list", "para"]);
    expect(blocks[3]).toEqual({ kind: "list", items: ["Ship evals", "Own the API"] });
    expect(blocks[2]).toEqual({ kind: "heading", text: "What you will do" });
  });

  test("cuts one long flat paragraph into readable pieces", () => {
    const flat = Array.from({ length: 12 }, (_, index) => `Sentence number ${index + 1} talks about the role in some detail here.`).join(" ");
    const blocks = jdBlocks(flat);
    expect(blocks).toHaveLength(4);
    expect(blocks.every((block) => block.kind === "para")).toBe(true);
  });
});
