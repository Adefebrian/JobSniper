import { describe, expect, test } from "bun:test";
import { detectApplyEmail } from "../src/modules/brain/apply-email";

describe("apply-by-email detector", () => {
  test("finds the address in an application instruction", () => {
    const r = detectApplyEmail("We build LLM agents. Send your CV and GitHub to jobs@acme.ai. Privacy: privacy@acme.ai.", null);
    expect(r?.email).toBe("jobs@acme.ai");
    expect(r?.quote).toContain("Send your CV");
  });
  test("instruction in the previous sentence counts", () => {
    expect(detectApplyEmail("Interested? Get in touch.\nhiring@startup.io", null)?.email).toBe("hiring@startup.io");
  });
  test("mailto apply link counts", () => {
    expect(detectApplyEmail("Great role.", "mailto:careers@x.com?subject=AI")?.email).toBe("careers@x.com");
  });
  test("a privacy or support address alone is not an apply email", () => {
    expect(detectApplyEmail("For data requests contact privacy@acme.ai. Questions: support@acme.ai.", null)).toBeNull();
  });
  test("an email without any application intent is ignored", () => {
    expect(detectApplyEmail("Our office manager is jane@acme.ai and we love coffee.", null)).toBeNull();
  });
});
