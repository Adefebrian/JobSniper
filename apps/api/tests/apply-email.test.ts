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

describe("apply-by-email detector rejects non-application addresses", () => {
  test("accommodation and security addresses", () => {
    expect(detectApplyEmail("If you need a reasonable accommodation to apply, email accommodations-ext@figma.com.", null)).toBeNull();
    expect(detectApplyEmail("Send your application details to security-esk@contentful.com for review.", null)).toBeNull();
  });
  test("an impossible domain from a bad de-obfuscation", () => {
    expect(detectApplyEmail("Send your CV to directly@vishnu.swaroop for this role.", null)).toBeNull();
  });
  test("hiring mailbox in a job sentence still counts", () => {
    expect(detectApplyEmail("We are hiring a founding engineer: careers@acme.ai", null)?.email).toBe("careers@acme.ai");
  });
});
