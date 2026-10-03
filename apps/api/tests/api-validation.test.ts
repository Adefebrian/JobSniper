import { describe, expect, test } from "bun:test";
import { createApiApp } from "../src/app";
import type { Queryable, QueryParam, QueryResultRow } from "../src/core/ports/database";
import type { Clock, IdGenerator } from "../src/core/ports/runtime";
import type { JevPort, LunaPort } from "../src/core/ports/ai";

class FakeDatabase implements Queryable {
  calls = 0;
  async query<T extends QueryResultRow = QueryResultRow>(_sql: string, _params?: QueryParam[]) {
    this.calls += 1;
    return { rows: [] as T[], rowCount: 0 };
  }
}

const luna: LunaPort = {
  parseProfile: async () => { throw new Error("unused"); },
  extractJob: async () => { throw new Error("unused"); },
  draftEmail: async () => { throw new Error("unused"); },
};

const jev: JevPort = {
  decide: async (input) => ({
    decisionId: input.decisionId,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    input: input.input,
    verdict: { value: true },
    confidence: 0.9,
  }),
};

const clock: Clock = { now: () => new Date("2026-10-03T00:00:00.000Z") };
const ids: IdGenerator = { newId: () => crypto.randomUUID() };

function appWith(database = new FakeDatabase()) {
  return { app: createApiApp({ database, luna, jev, clock, ids }), database };
}

describe("API validation envelope", () => {
  test("health uses the frozen response envelope", async () => {
    const { app } = appWith();
    const response = await app.request("/api/health", { headers: { host: "127.0.0.1:4870" } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: {
        status: "ok",
        database: "ok",
        time: "2026-10-03T00:00:00.000Z",
      },
    });
  });

  test("rejects a non-local Host before touching the database", async () => {
    const { app, database } = appWith();
    const response = await app.request("/api/health", { headers: { host: "jobsniper.example" } });
    expect(response.status).toBe(403);
    expect(database.calls).toBe(0);
    expect((await response.json()).error.code).toBe("forbidden_host");
  });

  test("rejects a mismatched browser Origin", async () => {
    const { app, database } = appWith();
    const response = await app.request("/api/health", {
      headers: {
        host: "127.0.0.1:4870",
        origin: "http://localhost:4870",
      },
    });
    expect(response.status).toBe(403);
    expect(database.calls).toBe(0);
    expect((await response.json()).error.code).toBe("origin_mismatch");
  });

  test("rejects an array PATCH body before service execution", async () => {
    const { app, database } = appWith();
    const response = await app.request("/api/jobs/123", {
      method: "PATCH",
      headers: {
        host: "localhost:4870",
        "content-type": "application/json",
      },
      body: JSON.stringify([{ status: "closed" }]),
    });
    expect(response.status).toBe(400);
    expect(database.calls).toBe(0);
    expect((await response.json()).error.code).toBe("validation_error");
  });

  test("rejects out-of-range scores", async () => {
    const { app, database } = appWith();
    const response = await app.request("/api/jobs/123", {
      method: "PATCH",
      headers: {
        host: "localhost:4870",
        "content-type": "application/json",
      },
      body: JSON.stringify({ score: 101 }),
    });
    expect(response.status).toBe(400);
    expect(database.calls).toBe(0);
    expect((await response.json()).error.details.field).toBe("score");
  });
});
