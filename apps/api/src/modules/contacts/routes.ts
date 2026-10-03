import { Hono } from "hono";
import { ok, oneOf, requireObject, requiredString } from "../../core/http";
import type { ContactsService } from "./service";

export function contactsRoutes(service: ContactsService): Hono {
  const routes = new Hono();

  routes.get("/jobs/:jobId/contacts", async (context) =>
    ok(await service.listForJob(context.req.param("jobId"))),
  );

  routes.post("/jobs/:jobId/contacts", async (context) => {
    const body = requireObject(await context.req.json().catch(() => null));
    return ok(await service.addPublicContact({
      jobId: context.req.param("jobId"),
      email: requiredString(body.email, "email", 320),
      sourceUrl: requiredString(body.sourceUrl, "sourceUrl", 2_048),
      sourceQuote: requiredString(body.sourceQuote, "sourceQuote", 20_000),
      kind: oneOf(body.kind, "kind", ["public", "portal_public", "recruiter_search"] as const),
      ...(body.name === undefined ? {} : { name: requiredString(body.name, "name", 200) }),
      ...(body.role === undefined ? {} : { role: requiredString(body.role, "role", 200) }),
    }));
  });

  routes.post("/contacts/:id/invalidate", async (context) => {
    const body = await context.req.json().catch(() => ({})) as Record<string, unknown>;
    return ok(await service.invalidate(
      context.req.param("id"),
      typeof body.reason === "string" ? body.reason : "Marked invalid",
    ));
  });

  return routes;
}
