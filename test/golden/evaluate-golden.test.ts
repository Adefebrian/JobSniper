import { describe, expect, test } from "bun:test";
import {
  evaluateCase,
  evaluateCases,
  formatEvaluationReport,
  inferSeniority,
  parseGoldenCases,
  runGoldenEvaluation,
} from "../../scripts/evaluate-golden";

function caseFor(overrides: Partial<Parameters<typeof evaluateCase>[0]> & { id: string; title: string; description: string }) {
  return {
    country: "US",
    label: true,
    reason: "fixture",
    ...overrides,
  };
}

describe("golden evaluator rules", () => {
  test("accepts explicit AI engineering and keeps exact evidence", () => {
    const result = evaluateCase(caseFor({
      id: "ai",
      title: "AI Fullstack Engineer",
      description: "Build production LLM features. Working language is English.",
    }));
    expect(result.predictedRelevant).toBe(true);
    expect(result.roleEvidence.some((item) => item.quote.includes("LLM"))).toBe(true);
  });

  test("rejects generic software work without AI evidence", () => {
    const result = evaluateCase(caseFor({
      id: "generic",
      title: "Software Engineer",
      description: "Build web applications with React and PostgreSQL.",
      label: false,
    }));
    expect(result.predictedRelevant).toBe(false);
    expect(result.roleRelevant).toBe(false);
  });

  test("rejects graduate and pure research roles", () => {
    expect(evaluateCase(caseFor({
      id: "graduate",
      title: "New Grad AI Engineer",
      description: "Graduate program building LLM applications.",
      label: false,
    })).predictedRelevant).toBe(false);
    expect(evaluateCase(caseFor({
      id: "research",
      title: "Research Scientist, LLM",
      description: "Publish papers on language model pretraining.",
      label: false,
    })).predictedRelevant).toBe(false);
  });

  test("accepts product-facing ML engineering", () => {
    const result = evaluateCase(caseFor({
      id: "ml",
      title: "Machine Learning Engineer",
      description: "Deploy recommendation models into customer-facing products and own inference services.",
      country: "DE",
    }));
    expect(result.predictedRelevant).toBe(true);
  });

  test("applies mandatory non-English language exclusions", () => {
    const result = evaluateCase(caseFor({
      id: "german-required",
      title: "AI Software Engineer",
      description: "Build LLM systems. German C1 required.",
      country: "DE",
      label: false,
    }));
    expect(result.languageFit).toBe(false);
    expect(result.predictedRelevant).toBe(false);
    expect(result.languageReason).toContain("German");
  });

  test("allows preferred non-English language and non-English JD with English evidence", () => {
    expect(evaluateCase(caseFor({
      id: "german-optional",
      title: "AI Software Engineer",
      description: "Build LLM systems. Englisch fließend; German is a plus.",
      country: "DE",
    })).predictedRelevant).toBe(true);
    expect(evaluateCase(caseFor({
      id: "german-jd",
      title: "AI Engineer",
      description: "Wir suchen eine erfahrene Person. Englisch fließend.",
      country: "DE",
    })).predictedRelevant).toBe(true);
  });

  test("rejects Arabic-native and Saudi-only roles", () => {
    expect(evaluateCase(caseFor({
      id: "arabic-native",
      title: "Applied AI Engineer",
      description: "Arabic native required for customer communication. English preferred.",
      country: "SA",
      label: false,
    })).predictedRelevant).toBe(false);
    expect(evaluateCase(caseFor({
      id: "saudization",
      title: "AI Software Engineer",
      description: "Saudization role for Saudi nationals only. Working language English.",
      country: "SA",
      label: false,
    })).predictedRelevant).toBe(false);
  });

  test("keeps restricted remote roles relevant but scores them separately in the product", () => {
    expect(evaluateCase(caseFor({
      id: "restricted",
      title: "LLM Platform Engineer",
      description: "Build production agents. US work authorization required; no sponsorship.",
      country: "US",
    })).predictedRelevant).toBe(true);
  });
});

describe("golden evaluator metrics", () => {
  test("reports overall and grouped precision/recall errors deterministically", () => {
    const report = evaluateCases([
      caseFor({ id: "tp", title: "AI Engineer", description: "Build LLM systems." }),
      caseFor({ id: "tn", title: "Software Engineer", description: "Build web applications.", label: false }),
      caseFor({ id: "fp", title: "AI Engineer", description: "Publish AI research only.", label: false }),
      caseFor({ id: "fn", title: "AI Engineer", description: "German C1 required.", label: true, country: "DE" }),
    ]);
    expect(report.overall.truePositive).toBe(1);
    expect(report.overall.falsePositive).toBe(1);
    expect(report.overall.falseNegative).toBe(1);
    expect(report.overall.precision).toBe(0.5);
    expect(report.overall.recall).toBe(0.5);
    expect(report.byCountry.DE?.falseNegative).toBe(1);
    expect(report.byCountry.US?.falsePositive).toBe(1);
    expect(report.precisionGatePassed).toBe(false);
  });

  test("parses JSONL strictly and infers lead seniority when the field is absent", () => {
    const cases = parseGoldenCases([
      '{"id":"one","title":"Staff AI Platform Engineer","description":"Own agent runtimes.","country":"NZ","label":true,"reason":"lead"}',
      '{"id":"two","title":"AI Engineer","description":"Build LLM systems.","country":"SG","label":true,"reason":"explicit"}',
    ].join("\n"));
    expect(cases).toHaveLength(2);
    expect(inferSeniority(cases[0]!)).toBe("lead");
    expect(() => parseGoldenCases('{"id":"one","title":"x","description":"y","country":"US","label":true,"reason":"r"}\n{"id":"one","title":"x","description":"y","country":"US","label":true,"reason":"r"}')).toThrow("duplicate id");
    expect(() => parseGoldenCases("not-json")).toThrow("invalid JSON");
  });

  test("runs the committed golden set and keeps the precision gate at or above 90%", async () => {
    const report = await runGoldenEvaluation();
    expect(report.overall.precision).not.toBeNull();
    expect(report.overall.precision!).toBeGreaterThanOrEqual(0.9);
    expect(report.precisionGatePassed).toBe(true);
  });

  test("format report includes the required metric and error sections", () => {
    const report = evaluateCases([caseFor({
      id: "fp",
      title: "AI Engineer",
      description: "Publish AI research only.",
      label: false,
    })]);
    const output = formatEvaluationReport(report);
    expect(output).toContain("Precision | Recall");
    expect(output).toContain("False positives (1)");
    expect(output).toContain("False negatives (0)");
    expect(output).toContain("Precision gate: FAIL");
  });
});

describe("golden evaluator CLI", () => {
  test("exits nonzero when precision is below the configured gate", async () => {
    const process = Bun.spawn(
      ["bun", "scripts/evaluate-golden.ts", "test/golden/fixtures/low-precision.jsonl"],
      { stdout: "pipe", stderr: "pipe" },
    );
    const exitCode = await process.exited;
    expect(exitCode).toBe(1);
  });
});
