import { describe, expect, test } from "bun:test";
import {
  groundedEvidenceValid,
  judgeJob,
  monthlyBudgetAllows,
  prefilterJob,
  scoreJob,
} from "../src/modules/brain";
import { validatePublicContact } from "../src/modules/contacts";

const weights = {
  seniority: { mid: 1, early: 0.9, senior: 0.7, lead: 0.4, unknown: 0.5 },
  modeVisa: {
    remote_global: 1,
    remote_apac: 0.95,
    onsite_sponsor_yes: 0.85,
    sponsor_unknown: 0.65,
    remote_restricted: 0.35,
    sponsor_no: 0.15,
  },
  freshnessDays: [
    { maxDays: 1, weight: 1 },
    { maxDays: 3, weight: 0.85 },
    { maxDays: 7, weight: 0.6 },
    { maxDays: 14, weight: 0.35 },
  ],
};

describe("brain pre-filter and language rules", () => {
  test("admits an AI software engineering role with exact evidence", () => {
    const result = prefilterJob({
      title: "AI Fullstack Engineer",
      jdText: "Build LLM features and deploy agentic workflows with a product engineering team. Working language is English.",
    });
    expect(result.pass).toBe(true);
    expect(result.evidence[0]?.quote.length).toBeGreaterThan(0);
    expect(result.languageEvidence[0]?.quote.length).toBeGreaterThan(0);
  });

  test("rejects graduate and non-engineering roles before LLM use", () => {
    expect(prefilterJob({ title: "AI Graduate Intern", jdText: "Join our AI team." }).pass).toBe(false);
    expect(prefilterJob({ title: "AI Marketing Manager", jdText: "Promote AI products." }).pass).toBe(false);
  });

  test("accepts a non-English JD that explicitly names English", () => {
    const result = prefilterJob({
      title: "KI Entwickler",
      jdText: "Entwicklung von LLM-Produkten. Englisch fließend ist die Kommunikationssprache im Team.",
    });
    expect(result.pass).toBe(true);
    expect(result.languageEvidence[0]?.quote).toContain("Englisch");
  });

  test("rejects a job that requires another language", () => {
    const result = prefilterJob({
      title: "AI Engineer",
      jdText: "Build LLM systems. German C1 required. English is used occasionally.",
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toContain("language");
  });

  test("rejects Saudi-national-only roles", () => {
    const result = prefilterJob({
      title: "AI Engineer",
      jdText: "LLM software engineering role. Saudi nationals only. Working language is English.",
    });
    expect(result.pass).toBe(false);
  });
});

describe("brain judgment and scoring", () => {
  test("classifies remote scope, sponsorship, and seniority from exact JD evidence", () => {
    const judgment = judgeJob({
      title: "Mid-level AI Software Engineer",
      jdText: "Remote worldwide. Visa sponsorship is available. 3+ years building LLM products.",
      countries: ["SG"],
      workMode: "remote",
      postedAt: new Date().toISOString(),
    }, [{ quote: "Mid-level AI Software Engineer", source: "title", reason: "AI role" }], [
      { quote: "Remote worldwide.", source: "JD", reason: "English" },
    ]);
    expect(judgment.remoteScope.value).toBe("remote_global");
    expect(judgment.sponsorship.value).toBe("yes");
    expect(judgment.seniority.value).toBe("mid");
    expect(judgment.remoteScope.evidence[0]?.quote).toContain("Remote worldwide");
  });

  test("keeps unknown sponsorship unknown and scores the full ideal case at 100", () => {
    const breakdown = scoreJob({
      roleFit: 1,
      seniority: "mid",
      remoteScope: "remote_global",
      sponsorship: "unknown",
      postedAt: new Date().toISOString(),
      skillOverlap: 1,
      countryWeight: 1,
      now: new Date(),
      weights,
    });
    expect(breakdown.score).toBe(100);
    expect(breakdown.modeVisaWeight).toBe(1);
  });

  test("ranks remote global above restricted remote", () => {
    const common = {
      roleFit: 1,
      seniority: "mid" as const,
      sponsorship: "unknown" as const,
      postedAt: new Date().toISOString(),
      skillOverlap: 1,
      countryWeight: 1,
      now: new Date(),
      weights,
    };
    const global = scoreJob({ ...common, remoteScope: "remote_global" });
    const restricted = scoreJob({ ...common, remoteScope: "remote_restricted" });
    expect(global.score).toBeGreaterThan(restricted.score);
  });

  test("rejects evidence that is not an exact source quote", () => {
    expect(groundedEvidenceValid(
      [{ quote: "We invented a fact", source: "source", reason: "claim" }],
      "We build AI products.",
    )).toBe(false);
  });
});

describe("LLM budget and contact evidence", () => {
  test("stops before exceeding the configured monthly budget", () => {
    expect(monthlyBudgetAllows(29.99, 0.01, 30)).toBe(true);
    expect(monthlyBudgetAllows(29.99, 0.02, 30)).toBe(false);
    expect(monthlyBudgetAllows(30, 0, 30)).toBe(true);
  });

  test("never accepts an email absent from its source quote", () => {
    expect(() => validatePublicContact({
      email: "recruiter@example.com",
      sourceUrl: "https://example.com/careers",
      sourceQuote: "Contact our recruiting team.",
    })).toThrow("source quote");
    expect(() => validatePublicContact({
      email: "not-an-email",
      sourceUrl: "https://example.com/careers",
      sourceQuote: "not-an-email",
    })).toThrow("email");
    expect(() => validatePublicContact({
      email: "recruiter@example.com",
      sourceUrl: "https://example.com/careers",
      sourceQuote: "Email recruiter@example.com for this role.",
    })).not.toThrow();
  });
});
