import { Hono } from "hono";
import { ApiError, ok, requireObject, requiredString } from "../../core/http";
import type { SettingsService } from "./service";

export function settingsRoutes(service: SettingsService): Hono {
  const routes = new Hono();
  routes.get("/settings", async (context) => ok(await service.getView()));
  routes.patch("/settings", async (context) => ok(await service.patch(requireObject(await context.req.json().catch(() => null)))));
  routes.put("/settings", async (context) => ok(await service.putView(requireObject(await context.req.json().catch(() => null)))));
  routes.post("/profile/parse", async (context) => {
    const body = await context.req.json().catch(() => null) as Record<string, unknown> | null;
    return ok(await service.parseProfile(requiredString(body?.sourceText, "sourceText", 2_000_000)));
  });
  // CV file -> text via macOS textutil (docx, doc, rtf, html, pdf-less) or a plain read for .txt.
  routes.post("/profile/import-file", async (context) => {
    const body = await context.req.json().catch(() => null) as Record<string, unknown> | null;
    const path = requiredString(body?.path, "path", 1_000).replace(/^~(?=\/)/, process.env.HOME ?? "~");
    let text: string;
    if (/\.txt$/i.test(path)) {
      text = await Bun.file(path).text();
    } else if (/\.pdf$/i.test(path)) {
      const proc = Bun.spawnSync(["mdls", "-raw", "-name", "kMDItemTextContent", path]);
      text = proc.exitCode === 0 ? proc.stdout.toString() : "";
      if (text.trim().length < 100 || text.trim() === "(null)") {
        throw new ApiError(422, "cv_unreadable", "This PDF has no extractable text. Import the .docx version instead.");
      }
    } else {
      const proc = Bun.spawnSync(["textutil", "-convert", "txt", "-stdout", path]);
      if (proc.exitCode !== 0) throw new ApiError(422, "cv_unreadable", `Could not read ${path}.`);
      text = proc.stdout.toString();
    }
    return ok(await service.parseProfile(text));
  });
  routes.get("/exports/:kind.csv", async (context) => {
    const kind = requiredString(context.req.param("kind"), "kind", 30);
    return new Response(await service.exportCsv(kind), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="jobsniper-${kind}.csv"`, "x-content-type-options": "nosniff" } });
  });
  routes.get("/exports/:kind.xlsx", async (context) => {
    const kind = requiredString(context.req.param("kind"), "kind", 30);
    const workbook = await service.exportXlsx(kind);
    return new Response(new Uint8Array(workbook).buffer, { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="jobsniper-${kind}.xlsx"`, "x-content-type-options": "nosniff" } });
  });
  routes.get("/export", async (context) => {
    const kind = context.req.query("kind");
    const format = context.req.query("format") ?? "csv";
    if (kind !== "targets" && kind !== "outreach") throw new ApiError(404, "export_not_found", "Export kind must be targets or outreach.");
    if (format === "csv") return new Response(await service.exportCsv(kind), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="jobsniper-${kind}.csv"` } });
    if (format === "xlsx") {
      const workbook = await service.exportXlsx(kind);
      return new Response(new Uint8Array(workbook).buffer, { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="jobsniper-${kind}.xlsx"` } });
    }
    throw new ApiError(400, "validation_error", "format must be csv or xlsx.");
  });
  return routes;
}
