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
import { GmailTransport, SmtpTransport } from "./core/adapters/mail";
import { mountSpa } from "./core/adapters/spa";
import { createApiApp } from "./app";

const config = loadConfig();
const database = new PostgresDatabase(config.databaseUrl);
const migrations = await migrateDatabase(database);
const credentials = new MacKeychainCredentialStore();
const mail = config.mailProvider === "smtp"
  ? new SmtpTransport(
      process.env.SMTP_HOST ?? "",
      Number(process.env.SMTP_PORT ?? 587),
      credentials,
      process.env.SMTP_USER ?? "",
      process.env.SMTP_SECURE !== "false",
    )
  : new GmailTransport(credentials);
const app = createApiApp({
  database,
  luna: new LunaClient(config.openAiBaseUrl, config.lunaModel, credentials),
  jev: new JevClient(config.jevUrl, config.jevModel),
  clock: new SystemClock(),
  ids: new CryptoIdGenerator(),
  mail,
});

mountSpa(app, resolve(import.meta.dir, "../../web/dist"));

const maintenance = new RuntimeMaintenance({
  catchUp: () => app.scheduler.runDueCatchUp(),
  trackReplies: () => app.outreach.trackReplies(),
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
