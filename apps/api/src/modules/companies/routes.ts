import { Hono } from "hono";
import { ApiError, integer, ok, optionalString, requiredString } from "../../core/http";
import type { CompaniesService } from "./service";

function objectBody(value: unknown, field = "body"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, "validation_error", `${field} must be an object.`);
  return value as Record<string, unknown>;
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) throw new ApiError(400, "validation_error", `${field} must be an array of non-empty strings.`);
  return value.map((item) => String(item).trim());
}

export function companiesRoutes(service: CompaniesService): Hono {
  const routes = new Hono();
  routes.get("/companies", async (context) => ok(await service.listCompanies()));

  routes.post("/companies", async (context) => {
    const body = objectBody(await context.req.json().catch(() => null));
    const industry = body.industry === undefined ? undefined : optionalString(body.industry, "industry", 200);
    return ok(await service.addCompany({
      domain: requiredString(body.domain, "domain", 253),
      ...(body.name === undefined ? {} : { name: requiredString(body.name, "name", 200) }),
      ...(body.country === undefined ? {} : { country: requiredString(body.country, "country", 20) }),
      ...(industry === undefined ? {} : { industry }),
      ...(body.tier === undefined ? {} : { tier: integer(body.tier, "tier", 1, 3) }),
    }));
  });

  routes.get("/companies/:id", async (context) => ok(await service.getCompany(context.req.param("id"))));
  routes.post("/companies/:id/crawl", async (context) => ok(await service.crawlCompany(context.req.param("id"))));
  routes.post("/companies/:id/actions", async (context) => {
    const body = objectBody(await context.req.json().catch(() => null));
    const action = requiredString(body.action, "action", 30);
    if (!["force_crawl", "pause", "resume"].includes(action)) throw new ApiError(400, "validation_error", "action must be force_crawl, pause, or resume.");
    return ok(await service.companyAction(context.req.param("id"), action as "force_crawl" | "pause" | "resume"));
  });

  routes.get("/sources", async (context) => {
    const status = context.req.query("status");
    const country = context.req.query("country");
    return ok(await service.listSources({
      ...(status ? { status: requiredString(status, "status", 30) } : {}),
      ...(country ? { country: requiredString(country, "country", 20) } : {}),
    }));
  });

  routes.post("/sources", async (context) => {
    const body = objectBody(await context.req.json().catch(() => null));
    const url = body.url === undefined ? undefined : requiredString(body.url, "url", 2_000);
    return ok(await service.addSource({
      name: requiredString(body.name, "name", 200),
      ...(url === undefined ? {} : { url }),
      ...(body.kind === undefined ? {} : { kind: requiredString(body.kind, "kind", 50) }),
      ...(body.countries === undefined ? {} : { countries: stringArray(body.countries, "countries") }),
      ...(body.roles === undefined ? {} : { roles: stringArray(body.roles, "roles") }),
      ...(body.method === undefined ? {} : { method: requiredString(body.method, "method", 50) }),
      ...(body.config === undefined ? {} : { config: objectBody(body.config, "config") }),
      ...(body.trust === undefined ? {} : { trust: requiredString(body.trust, "trust", 50) }),
      ...(body.autoAdmit === undefined ? {} : { autoAdmit: Boolean(body.autoAdmit) }),
    }));
  });

  routes.get("/sources/:id", async (context) => ok(await service.getSource(context.req.param("id"))));
  routes.patch("/sources/:id", async (context) => {
    const body = objectBody(await context.req.json().catch(() => null));
    return ok(await service.patchSource(context.req.param("id"), {
      ...(body.status === undefined ? {} : { status: requiredString(body.status, "status", 30) }),
      ...(body.config === undefined ? {} : { config: objectBody(body.config, "config") }),
      ...(body.countries === undefined ? {} : { countries: stringArray(body.countries, "countries") }),
      ...(body.roles === undefined ? {} : { roles: stringArray(body.roles, "roles") }),
      ...(body.trialUntil === undefined ? {} : { trialUntil: body.trialUntil === null ? null : requiredString(body.trialUntil, "trialUntil", 50) }),
      ...(body.lastError === undefined ? {} : { lastError: body.lastError === null ? null : requiredString(body.lastError, "lastError", 4_000) }),
      ...(body.admittedBy === undefined ? {} : { admittedBy: body.admittedBy === null ? null : requiredString(body.admittedBy, "admittedBy", 100) }),
    }));
  });

  routes.post("/sources/:id/actions", async (context) => {
    const body = objectBody(await context.req.json().catch(() => null));
    const action = requiredString(body.action, "action", 30);
    if (!["approve", "reject", "pause", "resume"].includes(action)) throw new ApiError(400, "validation_error", "action must be approve, reject, pause, or resume.");
    return ok(await service.sourceAction(context.req.param("id"), action as "approve" | "reject" | "pause" | "resume"));
  });

  routes.post("/sources/:id/yield", async (context) => {
    const body = objectBody(await context.req.json().catch(() => null));
    return ok(await service.recordYield({
      sourceId: context.req.param("id"),
      ...(body.items === undefined ? {} : { items: integer(body.items, "items", 0, 1_000_000) }),
      ...(body.relevant === undefined ? {} : { relevant: integer(body.relevant, "relevant", 0, 1_000_000) }),
      ...(body.duplicate === undefined ? {} : { duplicate: Boolean(body.duplicate) }),
      ...(body.failed === undefined ? {} : { failed: Boolean(body.failed) }),
    }));
  });

  routes.get("/dashboard/status", async (context) => ok(await service.dashboardStatus()));
  return routes;
}
