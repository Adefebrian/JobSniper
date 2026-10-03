import { describe, expect, test } from "bun:test";
import {
  classifyReply,
  cvVariantForTitle,
  emailBodyValid,
  groundedDraftValid,
  nextWorkWindow,
  sendGate,
  timezoneForCountries,
} from "../src/modules/outreach";
import type { SendGateState } from "../src/modules/outreach";
import { DEFAULT_SETTINGS } from "../src/modules/settings";

const state = (overrides: Partial<SendGateState> = {}): SendGateState => ({
  outreach: { id: "outreach-1", kind: "initial", status: "approved", contactId: "contact-1" },
  job: {
    id: "job-1",
    title: "AI Engineer",
    url: "https://example.com/jobs/1",
    jdText: "Build production LLM systems.",
    status: "targeted",
    countries: ["SG"],
  },
  contact: { id: "contact-1", email: "hiring@example.com", name: "Alex", invalidAt: null },
  doNotContact: false,
  sentToday: 0,
  alreadySentSameKind: false,
  dailySendCap: 20,
  ...overrides,
});

describe("outreach policy", () => {
  test("send gate blocks every unapproved or unsafe send", () => {
    expect(sendGate(state()).pass).toBe(true);
    expect(sendGate(state({ outreach: { id: "x", kind: "initial", status: "draft", contactId: "contact-1" } })).code).toBe("not_approved");
    expect(sendGate(state({ job: { ...state().job, status: "closed" } })).code).toBe("job_closed");
    expect(sendGate(state({ job: { ...state().job, status: "unverified" } })).code).toBe("job_unverified");
    expect(sendGate(state({ doNotContact: true })).code).toBe("do_not_contact");
    expect(sendGate(state({ sentToday: 20 })).code).toBe("daily_cap");
  });

  test("reply classifier separates operational and negative replies", () => {
    expect(classifyReply("The mailbox is unavailable. Delivery failed.")).toBe("bounce");
    expect(classifyReply("Automatic reply: I am out of office.")).toBe("auto_reply");
    expect(classifyReply("Unfortunately, we are not moving forward.")).toBe("negative");
    expect(classifyReply("Can you meet the team on Tuesday?")).toBe("positive");
  });

  test("draft constraints require grounded evidence and complete application content", () => {
    const source = "Build production LLM systems. Remote worldwide. Working language is English.";
    const body = "Build production LLM systems. I shipped three LLM services. Remote from Indonesia (GMT+7). Available after a 30-day notice period. Let us schedule a 15-minute call. https://example.com/jobs/1";
    const draft = {
      subject: "AI Engineer JS-101: production LLM delivery",
      body,
      whyCompany: "Build production LLM systems.",
      evidence: [{ quote: "Build production LLM systems.", source: "JD", reason: "AI work." }],
    };
    expect(groundedDraftValid(draft, source, "https://example.com/jobs/1")).toBe(true);
    expect(emailBodyValid(draft.subject, draft.body, "https://example.com/jobs/1")).toBe(true);
    expect(groundedDraftValid({ ...draft, evidence: [] }, source, "https://example.com/jobs/1")).toBe(false);
  });

  test("scheduling uses company timezone and configured work days", () => {
    expect(timezoneForCountries(["SG"])).toBe("Asia/Singapore");
    const now = new Date("2026-10-03T10:00:00.000Z");
    const scheduled = nextWorkWindow(now, "Asia/Singapore", DEFAULT_SETTINGS);
    expect(scheduled.getTime()).toBeGreaterThanOrEqual(now.getTime());
    expect(cvVariantForTitle("AI Fullstack Engineer")).toBe("ai_fullstack");
    expect(cvVariantForTitle("LLM Engineer")).toBe("ai_engineer");
  });
});
