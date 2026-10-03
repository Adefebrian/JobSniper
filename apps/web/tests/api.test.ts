import { afterEach, describe, expect, test } from "bun:test";
import { actOnTarget, exportData, getDashboard, saveSettings, updateOutreach } from "../src/api.ts";
import { sampleData } from "../src/sample-data.ts";

const originalFetch = globalThis.fetch;
const calls: { url: string; method: string; body: string | null }[] = [];

const mockApi = (data: unknown, contentType = "application/json") => {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : null,
    });
    return new Response(contentType === "application/json" ? JSON.stringify({ ok: true, data }) : "id,name\n1,Test", {
      status: 200,
      headers: { "Content-Type": contentType },
    });
  }) as typeof fetch;
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  calls.length = 0;
});

describe("frozen API client", () => {
  test("loads the dashboard through /api", async () => {
    mockApi(sampleData);
    const result = await getDashboard();
    expect(result.targets).toHaveLength(3);
    expect(calls[0]?.url).toBe("/api/dashboard");
    expect(calls[0]?.method).toBe("GET");
  });

  test("posts target actions with the action payload", async () => {
    mockApi(sampleData.targets[0]);
    await actOnTarget("job-northstar", "draft");
    expect(calls[0]?.url).toBe("/api/targets/job-northstar/actions");
    expect(calls[0]?.method).toBe("POST");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ action: "draft" });
  });

  test("updates outreach and settings through real mutation methods", async () => {
    mockApi(sampleData.outreach[0]);
    await updateOutreach("outreach-1", { action: "save", payload: { subject: "Updated subject" } });
    expect(calls[0]?.url).toBe("/api/outreach/outreach-1/actions");
    expect(calls[0]?.method).toBe("POST");
    expect(JSON.parse(calls[0]?.body ?? "{}").payload.subject).toBe("Updated subject");

    mockApi(sampleData.settings);
    await saveSettings(sampleData.settings);
    expect(calls[1]?.url).toBe("/api/settings");
    expect(calls[1]?.method).toBe("PUT");
  });

  test("returns export response bytes as a blob", async () => {
    mockApi("id,name\n1,Test", "text/csv");
    const blob = await exportData("targets", "csv");
    expect(blob.type).toBe("text/csv");
    expect(await blob.text()).toBe("id,name\n1,Test");
    expect(calls[0]?.url).toBe("/api/export?kind=targets&format=csv");
  });
});
