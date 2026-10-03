import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { serveStatic } from "hono/bun";
import type { Hono } from "hono";

export function mountSpa(app: Hono, webRoot: string): void {
  const root = resolve(webRoot);
  app.get("*", serveStatic({
    root,
    rewriteRequestPath: (path) => path === "/" ? "/index.html" : path,
  }));
  app.get("*", async (context) => {
    const html = await readFile(resolve(root, "index.html"), "utf8");
    return context.html(html);
  });
}
