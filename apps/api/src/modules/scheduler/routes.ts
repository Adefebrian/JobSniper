import { Hono } from "hono";
import { integer, ok, requiredString } from "../../core/http";
import type { SchedulerService } from "./service";

export function schedulerRoutes(service: SchedulerService): Hono {
  const routes = new Hono();

  routes.post("/crawl/run", async (context) => {
    const body = await context.req.json().catch(() => ({})) as Record<string, unknown>;
    if (body.discovery === true) {
      await service.enqueueDiscovery({
        sourceId: typeof body.sourceId === "string" ? body.sourceId : null,
        payload: typeof body.payload === "object" && body.payload ? body.payload as Record<string, unknown> : {},
        dedupeKey: typeof body.dedupeKey === "string" ? body.dedupeKey : `manual:${crypto.randomUUID()}`,
      });
    }
    return ok(await service.runDueCatchUp());
  });

  routes.get("/crawl/status", async (context) => ok(await service.status()));

  routes.post("/crawl/claim", async (context) => {
    const body = await context.req.json().catch(() => ({})) as Record<string, unknown>;
    return ok(await service.claim(
      requiredString(body.workerId, "workerId", 200),
      body.leaseSeconds === undefined ? 300 : integer(body.leaseSeconds, "leaseSeconds", 30, 3_600),
      body.limit === undefined ? 10 : integer(body.limit, "limit", 1, 100),
    ));
  });

  routes.post("/crawl/tasks/:id/complete", async (context) => {
    await service.complete(context.req.param("id"));
    return ok({ id: context.req.param("id"), status: "done" });
  });

  routes.post("/crawl/tasks/:id/retry", async (context) => {
    const body = await context.req.json().catch(() => ({})) as Record<string, unknown>;
    return ok({
      id: context.req.param("id"),
      status: await service.retry(
        context.req.param("id"),
        typeof body.error === "string" ? body.error : "Crawler reported an unknown error.",
      ),
    });
  });

  return routes;
}
