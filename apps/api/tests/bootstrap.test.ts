import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { createApiApp } from "../src/app";
import { PostgresDecisionRecorder, RecordingJev } from "../src/core/adapters/decisions";
import { RuntimeMaintenance } from "../src/core/adapters/runtime";
import { mountSpa } from "../src/core/adapters/spa";
import type { JevPort, LunaPort } from "../src/core/ports/ai";
import type { DatabasePort, QueryParam, QueryResultRow } from "../src/core/ports/database";
import type { MailTransport } from "../src/core/ports/mail";

class FakeDatabase implements DatabasePort {
  inserts: Array<{ sql: string; params: QueryParam[] }> = [];

  async query<T extends QueryResultRow = QueryResultRow>(sql: string, params: QueryParam[] = []) {
    if (sql.startsWith("INSERT INTO decisions")) this.inserts.push({ sql, params });
    return { rows: [] as T[], rowCount: 0 };
  }

  async transaction<T>(fn: (client: DatabasePort) => Promise<T>): Promise<T> {
    return fn(this);
  }

  async close(): Promise<void> {}
}

const luna: LunaPort = {
  parseProfile: async () => { throw new Error("unused"); },
  extractJob: async () => { throw new Error("unused"); },
  draftEmail: async () => { throw new Error("unused"); },
};

const jev: JevPort = {
  decide: async (input) => ({
    ...input,
    verdict: { value: true },
    confidence: 0.95,
  }),
};

const mail: Pick<MailTransport, "send" | "fetchThreadReplies"> = {
  send: async () => ({ providerMessageId: "test", threadId: null }),
  fetchThreadReplies: async () => [],
};

function makeApp() {
  const database = new FakeDatabase();
  const app = createApiApp({
    database,
    luna,
    jev,
    clock: { now: () => new Date("2026-10-03T00:00:00.000Z") },
    ids: { newId: () => crypto.randomUUID() },
    mail,
  });
  return { app, database };
}

describe("production bootstrap", () => {
  test("mounts every owned API route while preserving the API 404 envelope", () => {
    const { app } = makeApp();
    const routes = app.routes.map((route) => `${route.method} ${route.path}`);
    for (const route of [
      "GET /api/health",
      "GET /api/jobs",
      "GET /api/crawl/status",
      "POST /api/crawl/run",
      "GET /api/outreach",
      "POST /api/outreach",
      "GET /api/companies",
      "GET /api/sources",
      "GET /api/dashboard/status",
      "GET /api/settings",
      "PATCH /api/settings",
      "GET /api/exports/:kind.csv",
    ]) {
      expect(routes).toContain(route);
    }
  });

  test("keeps unknown /api paths as JSON and serves the SPA after API routes", async () => {
    const { app } = makeApp();
    mountSpa(app, resolve(import.meta.dir, "../../web/dist"));

    const apiMiss = await app.request("/api/not-real", { headers: { host: "127.0.0.1:4870" } });
    expect(apiMiss.status).toBe(404);
    expect((await apiMiss.json()).error.code).toBe("not_found");

    const apiRoot = await app.request("/api", { headers: { host: "127.0.0.1:4870" } });
    expect(apiRoot.status).toBe(404);
    expect((await apiRoot.json()).error.code).toBe("not_found");

    const spaRoute = await app.request("/targets", { headers: { host: "127.0.0.1:4870" } });
    expect(spaRoute.status).toBe(200);
    expect(await spaRoute.text()).toContain("<div id=\"root\"></div>");

    const asset = await app.request("/main.js", { headers: { host: "127.0.0.1:4870" } });
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toContain("javascript");
  });

  test("records the operational Jev decisions required by the modules", async () => {
    const database = new FakeDatabase();
    const recorder = new PostgresDecisionRecorder(database, { newId: () => crypto.randomUUID() });
    const recordingJev = new RecordingJev(jev, recorder);
    for (const decisionId of ["source_admit", "crawl_priority", "send_gate", "reply_class"] as const) {
      await recordingJev.decide({
        decisionId,
        subjectType: "test",
        subjectId: `subject-${decisionId}`,
        input: { evidence: [{ quote: "evidence", source: "https://example.com", reason: "test" }] },
      });
    }
    expect(database.inserts).toHaveLength(4);
    expect(database.inserts.map((item) => item.params[1])).toEqual([
      "source_admit",
      "crawl_priority",
      "send_gate",
      "reply_class",
    ]);
  });

  test("runs launch maintenance and catches up after a wake-sized timer gap", async () => {
    const calls = { catchUp: 0, trackReplies: 0 };
    const maintenance = new RuntimeMaintenance({
      catchUp: async () => { calls.catchUp += 1; },
      trackReplies: async () => { calls.trackReplies += 1; },
      onError: (error) => { throw error; },
    }, { replyIntervalMs: 60_000 });
    maintenance.start();
    await Bun.sleep(5);
    expect(calls).toEqual({ catchUp: 1, trackReplies: 1 });
    await maintenance.tick(Date.now() + 120_000);
    expect(calls.catchUp).toBe(2);
  });
});
