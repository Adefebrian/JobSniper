import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { accessSync, constants, existsSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import puppeteer, { type Browser } from "puppeteer-core";
import { sampleData } from "../src/sample-data.ts";

const webRoot = resolve(import.meta.dir, "..");
const distRoot = resolve(webRoot, "dist");
const chromeCandidates = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
].filter((candidate): candidate is string => Boolean(candidate));

const findChrome = () => {
  for (const candidate of chromeCandidates) {
    try {
      accessSync(candidate, constants.X_OK);
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      continue;
    }
  }
  return null;
};

const chromePath = findChrome();
let browser: Browser | undefined;
let dashboardRequests = 0;
let server: ReturnType<typeof Bun.serve> | undefined;
let baseUrl = "";

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const serveSpa = async (request: Request) => {
  const url = new URL(request.url);
  if (url.pathname === "/api/dashboard") {
    dashboardRequests += 1;
    return Response.json({ ok: true, data: sampleData });
  }

  const pathname = decodeURIComponent(url.pathname);
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = resolve(distRoot, relativePath);
  if (filePath !== distRoot && !filePath.startsWith(`${distRoot}${sep}`)) {
    return new Response("Forbidden", { status: 403 });
  }

  const file = Bun.file(filePath);
  if (!await file.exists()) return new Response("Not found", { status: 404 });
  return new Response(file, {
    headers: {
      "cache-control": "no-store",
      "content-type": contentTypes[extname(filePath)] ?? "application/octet-stream",
    },
  });
};

beforeAll(async () => {
  if (!existsSync(resolve(distRoot, "index.html"))) {
    throw new Error(`Built SPA is missing at ${distRoot}. Run: bun run --cwd apps/web build`);
  }

  server = Bun.serve({
    fetch: serveSpa,
    hostname: "127.0.0.1",
    port: 0,
  });
  baseUrl = `http://127.0.0.1:${server.port}`;

  if (chromePath) {
    browser = await puppeteer.launch({
      args: [
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-sandbox",
      ],
      executablePath: chromePath,
      headless: true,
    });
  } else {
    console.warn("[JobSniper smoke] skipped: Chrome/Chromium is unavailable. Set CHROME_PATH or PUPPETEER_EXECUTABLE_PATH.");
  }
});

afterAll(async () => {
  await browser?.close();
  server?.stop(true);
});

describe("JobSniper final browser smoke", () => {
  test.skipIf(!chromePath)("shell, Targets navigation, detail drawer, and responsive width", async () => {
    if (!browser) throw new Error("Browser was not initialized");

    for (const width of [375, 1280]) {
      dashboardRequests = 0;
      const page = await browser.newPage();
      try {
        await page.setViewport({ deviceScaleFactor: 1, height: 900, width });
        const response = await page.goto(`${baseUrl}/#/outreach`, {
          timeout: 15_000,
          waitUntil: "networkidle0",
        });

        expect(response?.status()).toBe(200);
        await page.waitForSelector(".app-shell");
        await page.waitForFunction(() => document.querySelector(".brand strong")?.textContent?.trim() === "JobSniper");
        await page.waitForFunction(() => Boolean(document.querySelector("main.main-content h1")));
        expect(dashboardRequests).toBeGreaterThan(0);

        const targetsNavigation = await page.evaluate(() => {
          return [...document.querySelectorAll<HTMLAnchorElement>('a[href="#/targets"]')].some((link) => {
            const style = window.getComputedStyle(link);
            return style.display !== "none" && style.visibility !== "hidden" && link.getClientRects().length > 0;
          });
        });
        expect(targetsNavigation).toBe(true);

        const navSelector = width < 960
          ? '.mobile-nav a[href="#/targets"]'
          : '.side-nav a[href="#/targets"]';
        await page.click(navSelector);
        await page.waitForFunction(() => {
          return [...document.querySelectorAll("h1")].some((heading) => heading.textContent?.trim() === "Targets");
        });
        expect(await page.evaluate(() => window.location.hash)).toBe("#/targets");

        const pageOverflow = await page.evaluate(() => ({
          body: document.body.scrollWidth,
          document: document.documentElement.scrollWidth,
          viewport: window.innerWidth,
        }));
        expect(pageOverflow.body).toBeLessThanOrEqual(pageOverflow.viewport);
        expect(pageOverflow.document).toBeLessThanOrEqual(pageOverflow.viewport);

        await page.click("tr.ledger-row .table-action");
        await page.waitForSelector('.drawer-layer[role="dialog"]');
        await page.waitForFunction(() => Boolean(document.querySelector(".detail-drawer h2")?.textContent?.trim()));
        expect(await page.$eval(".detail-drawer h2", (heading) => heading.textContent?.trim())).toBeTruthy();

        const drawerOverflow = await page.evaluate(() => ({
          body: document.body.scrollWidth,
          document: document.documentElement.scrollWidth,
          viewport: window.innerWidth,
        }));
        expect(drawerOverflow.body).toBeLessThanOrEqual(drawerOverflow.viewport);
        expect(drawerOverflow.document).toBeLessThanOrEqual(drawerOverflow.viewport);
      } finally {
        await page.close();
      }
    }
  }, 45_000);
});
