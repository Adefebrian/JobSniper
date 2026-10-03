import { serve } from "bun";
import { resolve } from "node:path";
import { loadConfig } from "./core/config";
import { PostgresDatabase } from "./core/adapters/postgres";
import { migrateDatabase } from "./core/adapters/migrator";
import { LunaClient } from "./core/adapters/luna";
import { JevClient } from "./core/adapters/jev";
import {
  CryptoIdGenerator,
  MacKeychainCredentialStore,
  RuntimeMaintenance,
  SystemClock,
} from "./core/adapters/runtime";
import { SmtpTransport } from "./core/adapters/mail";
import { GmailAuth, GmailTransport } from "./core/adapters/gmail";
import { mountConnections } from "./core/connections";
import { mountSpa } from "./core/adapters/spa";
import { createApiApp } from "./app";

const config = loadConfig();
const database = new PostgresDatabase(config.databaseUrl);
const migrations = await migrateDatabase(database);
const credentials = new MacKeychainCredentialStore();
const gmailAuth = new GmailAuth(credentials, `http://127.0.0.1:${config.port}/api/gmail/callback`);
const mail = config.mailProvider === "smtp"
  ? new SmtpTransport(
      process.env.SMTP_HOST ?? "",
      Number(process.env.SMTP_PORT ?? 587),
      credentials,
      process.env.SMTP_USER ?? "",
      process.env.SMTP_SECURE !== "false",
    )
  : new GmailTransport(gmailAuth);
const app = createApiApp({
  database,
  luna: new LunaClient(config.openAiBaseUrl, config.lunaModel, credentials),
  jev: new JevClient(config.jevModel, credentials, config.jevUrl),
  clock: new SystemClock(),
  ids: new CryptoIdGenerator(),
  mail,
  mount: (routes) => mountConnections(routes, credentials, gmailAuth, database),
});

mountSpa(app, process.env.JOBSNIPER_WEB_DIST ?? resolve(import.meta.dir, "../../web/dist"));

let nextSendAt = 0;
let nextSearchAt = 0;
const maintenance = new RuntimeMaintenance({
  catchUp: async () => {
    await app.scheduler.runDueCatchUp();
    // Judge in batches until the queue is empty or the tick budget is spent.
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      const { judged } = await app.brain.processQueue(25);
      if (judged === 0) break;
    }
    // One public-email search per company every 45 s for targets that have no email (PRD 8.1).
    if (Date.now() >= nextSearchAt) {
      nextSearchAt = Date.now() + 45_000;
      await app.contacts.recruiterSearchOnce().catch((error: Error) => {
        // Rate limited or blocked: rest the search engine for 30 minutes, never hammer it.
        nextSearchAt = Date.now() + 30 * 60_000;
        console.error(`recruiter search paused 30 min: ${error.message}`);
      });
    }
    // Approved emails go out one at a time with a random 4 to 12 minute gap (PRD 8.3);
    // sendDue itself enforces the recipient's work window and the daily cap.
    if (Date.now() >= nextSendAt) {
      const results = await app.outreach.sendDue(1);
      if (results.some((r) => (r as { status?: string }).status === "sent")) {
        nextSendAt = Date.now() + (4 + Math.random() * 8) * 60_000;
      }
    }
  },
  trackReplies: async () => {
    await app.outreach.trackReplies();
    // One follow-up draft per unanswered email after 6 days; it still waits for Brian's approval.
    for (const due of await app.outreach.followupsDue()) {
      await app.outreach.createFollowup(String(due.id)).catch(() => undefined);
    }
  },
  onError: (error) => console.error("JobSniper maintenance failed:", error),
});
maintenance.start();

const server = serve({
  fetch: app.fetch,
  hostname: config.host,
  port: config.port,
});

console.log(`JobSniper API listening on http://${config.host}:${server.port}`);
console.log(`Applied migrations: ${migrations.join(", ") || "none"}`);

async function shutdown() {
  maintenance.stop();
  server.stop();
  await database.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
