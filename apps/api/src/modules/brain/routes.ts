import { Hono } from "hono";
import { ApiError, integer, ok, oneOf, optionalString, requireObject } from "../../core/http";
import type { BrainService } from "./service";

export function brainRoutes(service: BrainService): Hono {
  const routes = new Hono();

  routes.get("/jobs", async (context) => ok(await service.listJobs({
    ...(context.req.query("status") ? { status: context.req.query("status") } : {}),
    ...(context.req.query("country") ? { country: context.req.query("country") } : {}),
    ...(context.req.query("workMode") ? { workMode: context.req.query("workMode") } : {}),
    ...(context.req.query("sponsorship") ? { sponsorship: context.req.query("sponsorship") } : {}),
    ...(context.req.query("hasEmail") ? { hasEmail: context.req.query("hasEmail") } : {}),
    ...(context.req.query("maxAgeHours") ? { maxAgeHours: integer(context.req.query("maxAgeHours"), "maxAgeHours", 1, 24 * 365) } : {}),
    page: context.req.query("page") ? integer(context.req.query("page"), "page", 1, 10_000) : 1,
    perPage: context.req.query("perPage") ? integer(context.req.query("perPage"), "perPage", 1, 200) : 50,
  })));

  routes.get("/jobs/:id", async (context) => ok(await service.getJob(context.req.param("id"))));

  routes.patch("/jobs/:id", async (context) => {
    const body = requireObject(await context.req.json().catch(() => null));
    const score = body.score === undefined ? undefined : Number(body.score);
    if (score !== undefined && (!Number.isFinite(score) || score < 0 || score > 100)) {
      throw new ApiError(400, "validation_error", "score must be between 0 and 100.", { field: "score" });
    }
    return ok(await service.patchJob(context.req.param("id"), {
      ...(body.status === undefined ? {} : {
        status: oneOf(body.status, "status", ["new", "judged", "targeted", "drafted", "sent", "replied", "closed", "skipped", "blacklisted", "pending_judge", "unverified"]),
      }),
      ...(score === undefined ? {} : { score }),
      ...(body.skipReason === undefined ? {} : {
        skipReason: optionalString(body.skipReason, "skipReason") ?? "",
      }),
    }));
  });

  routes.post("/jobs/:id/judge", async (context) => ok(await service.judge(context.req.param("id"))));
  return routes;
}
