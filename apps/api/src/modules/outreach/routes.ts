import { Hono } from "hono";
import { ApiError, integer, ok, optionalString, requiredString } from "../../core/http";
import type { OutreachService } from "./service";

function bodyObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function outreachRoutes(service: OutreachService): Hono {
  const routes = new Hono();

  routes.get("/outreach", async (context) => {
    const query = context.req.query();
    return ok(await service.list({
      ...(query.tab ? { tab: query.tab } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.replyClass ? { replyClass: query.replyClass } : {}),
      ...(query.page ? { page: integer(query.page, "page", 1, 100_000) } : {}),
      ...(query.perPage ? { perPage: integer(query.perPage, "perPage", 1, 500) } : {}),
    }));
  });

  routes.get("/outreach/status", async (context) => ok(await service.operationalCounts()));
  routes.get("/outreach/followups/due", async (context) => ok(await service.followupsDue()));

  routes.post("/outreach", async (context) => {
    const body = bodyObject(await context.req.json().catch(() => null));
    return ok(await service.draft({
      jobId: requiredString(body.jobId, "jobId", 100),
      ...(body.contactId === undefined ? {} : { contactId: requiredString(body.contactId, "contactId", 100) }),
      ...(body.kind === undefined ? {} : { kind: body.kind === "followup" ? "followup" : "initial" }),
    }));
  });

  routes.patch("/outreach/:id", async (context) => {
    const body = bodyObject(await context.req.json().catch(() => null));
    return ok(await service.save(context.req.param("id"), {
      ...(body.subject === undefined ? {} : { subject: requiredString(body.subject, "subject", 180) }),
      ...(body.body === undefined ? {} : { body: requiredString(body.body, "body", 30_000) }),
      ...(body.cvVariant === undefined ? {} : { cvVariant: requiredString(body.cvVariant, "cvVariant", 50) }),
      ...(body.contactId === undefined ? {} : {
        contactId: body.contactId === null ? null : requiredString(body.contactId, "contactId", 100),
      }),
    }));
  });

  routes.post("/outreach/:id/actions", async (context) => {
    const body = bodyObject(await context.req.json().catch(() => null));
    const action = requiredString(body.action, "action", 30);
    const payload = bodyObject(body.payload);
    switch (action) {
      case "approve":
        return ok(await service.approve(context.req.param("id")));
      case "reject":
        return ok(await service.reject(context.req.param("id"), optionalString(payload.reason, "reason", 1_000) ?? "Rejected by Brian."));
      case "schedule":
        return ok(await service.schedule(
          context.req.param("id"),
          optionalString(payload.scheduledFor, "scheduledFor", 50),
        ));
      case "save": {
        const id = context.req.param("id");
        return ok(await service.save(id, {
          ...(payload.subject === undefined ? {} : { subject: requiredString(payload.subject, "subject", 180) }),
          ...(payload.body === undefined ? {} : { body: requiredString(payload.body, "body", 30_000) }),
          ...(payload.cvVariant === undefined ? {} : { cvVariant: requiredString(payload.cvVariant, "cvVariant", 50) }),
          ...(payload.contactId === undefined ? {} : {
            contactId: payload.contactId === null ? null : requiredString(payload.contactId, "contactId", 100),
          }),
        }));
      }
      case "send":
        return ok((await service.send(context.req.param("id"))).outreach);
      default:
        throw new ApiError(400, "validation_error", "action must be approve, reject, schedule, save, or send.");
    }
  });

  routes.post("/outreach/run", async (context) => {
    const body = bodyObject(await context.req.json().catch(() => null));
    return ok(await service.sendDue(body.limit === undefined ? 10 : integer(body.limit, "limit", 1, 100)));
  });

  routes.post("/outreach/replies/check", async (context) => {
    const body = bodyObject(await context.req.json().catch(() => null));
    return ok(await service.trackReplies(body.limit === undefined ? 50 : integer(body.limit, "limit", 1, 500)));
  });

  routes.post("/outreach/:id/followup", async (context) => ok(await service.createFollowup(context.req.param("id"))));

  return routes;
}
