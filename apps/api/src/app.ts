import { Hono } from "hono";
import type { Queryable } from "./core/ports/database";
import type { Clock, IdGenerator } from "./core/ports/runtime";
import type { JevPort, LunaPort } from "./core/ports/ai";
import type { MailTransport } from "./core/ports/mail";
import { PostgresDecisionRecorder, RecordingJev } from "./core/adapters/decisions";
import {
  asDatabasePort,
  DatabaseOutreachContext,
  DocumentCvAttachmentProvider,
  SqlUsageRecorder,
} from "./core/adapters/integrations";
import { ApiError, errorHandler, fail, localOnly, ok } from "./core/http";
import { readSettings } from "./core/settings";
import {
  BrainRepository,
  BrainService,
  brainRoutes,
} from "./modules/brain";
import {
  ContactsRepository,
  ContactsService,
  contactsRoutes,
} from "./modules/contacts";
import {
  SchedulerRepository,
  SchedulerService,
  schedulerRoutes,
} from "./modules/scheduler";
import {
  OutreachRepository,
  OutreachService,
  outreachRoutes,
} from "./modules/outreach";
import {
  CompaniesRepository,
  CompaniesService,
  companiesRoutes,
} from "./modules/companies";
import {
  SettingsRepository,
  SettingsService,
  settingsRoutes,
} from "./modules/settings";

export type ApiDependencies = {
  database: Queryable;
  luna: LunaPort;
  jev: JevPort;
  clock: Clock;
  ids: IdGenerator;
  mail?: Pick<MailTransport, "send" | "fetchThreadReplies">;
  cvDirectory?: string;
};

export type ApiRuntime = {
  scheduler: SchedulerService;
  outreach: OutreachService;
};

const disabledMail: Pick<MailTransport, "send" | "fetchThreadReplies"> = {
  send: async () => {
    throw new ApiError(503, "mail_disabled", "Mail transport is disabled.");
  },
  fetchThreadReplies: async () => [],
};

export function createApiApp(dependencies: ApiDependencies): Hono & ApiRuntime {
  const database = asDatabasePort(dependencies.database);
  const decisions = new PostgresDecisionRecorder(database, dependencies.ids);
  const recordingJev = new RecordingJev(dependencies.jev, decisions);
  const brainRepository = new BrainRepository(database);
  const brainService = new BrainService(
    brainRepository,
    dependencies.luna,
    dependencies.jev,
    dependencies.clock,
    dependencies.ids,
    () => readSettings(database),
  );
  const contactsRepository = new ContactsRepository(database);
  const contactsService = new ContactsService(
    contactsRepository,
    recordingJev,
    dependencies.clock,
    dependencies.ids,
  );
  const schedulerRepository = new SchedulerRepository(database);
  const schedulerService = new SchedulerService(
    schedulerRepository,
    recordingJev,
    dependencies.clock,
  );
  const outreachRepository = new OutreachRepository(database);
  const outreachContext = new DatabaseOutreachContext(
    database,
    dependencies.ids,
    decisions,
  );
  const attachments = new DocumentCvAttachmentProvider(
    () => readSettings(database),
    dependencies.cvDirectory,
  );
  const outreachService = new OutreachService(
    outreachRepository,
    outreachContext,
    dependencies.luna,
    recordingJev,
    dependencies.mail ?? disabledMail,
    attachments,
    dependencies.clock,
    dependencies.ids,
  );
  const companiesRepository = new CompaniesRepository(database);
  const companiesService = new CompaniesService(
    companiesRepository,
    schedulerService,
    recordingJev,
    dependencies.clock,
    dependencies.ids,
    {
      schedulerStatus: () => schedulerService.status(),
      brainStatus: async () => {
        const result = await database.query<{ status: string; total: string }>(
          "SELECT status, count(*)::text AS total FROM jobs GROUP BY status",
        );
        return Object.fromEntries(result.rows.map((row) => [row.status, Number(row.total)]));
      },
      outreachStatus: () => outreachService.operationalCounts(),
      monthlyLlmSpend: async () => {
        const result = await database.query<{ total: string }>(
          `SELECT coalesce(sum(cost_usd), 0)::text AS total
           FROM llm_usage
           WHERE date_trunc('month', created_at) = date_trunc('month', now())`,
        );
        return Number(result.rows[0]?.total ?? 0);
      },
    },
    () => readSettings(database),
  );
  const settingsRepository = new SettingsRepository(database);
  const usageRecorder = new SqlUsageRecorder(database, dependencies.ids);
  const settingsService = new SettingsService(
    settingsRepository,
    dependencies.luna,
    usageRecorder,
    {
      rows: async (kind) => kind === "outreach"
        ? outreachService.exportRows()
        : (await brainService.listJobs({ page: 1, perPage: 100_000 })).items as Array<Record<string, unknown>>,
    },
  );

  const app = new Hono() as Hono & ApiRuntime;
  app.scheduler = schedulerService;
  app.outreach = outreachService;

  app.use("/api/*", localOnly);
  app.get("/api/health", async (context) => {
    await database.query("SELECT 1");
    return ok({
      status: "ok",
      database: "ok",
      time: dependencies.clock.now().toISOString(),
    });
  });
  app.route("/api", brainRoutes(brainService));
  app.route("/api", contactsRoutes(contactsService));
  app.route("/api", schedulerRoutes(schedulerService));
  app.route("/api", outreachRoutes(outreachService));
  app.route("/api", companiesRoutes(companiesService));
  app.route("/api", settingsRoutes(settingsService));
  app.all("/api", () => fail(new ApiError(404, "not_found", "API endpoint was not found.")));
  app.all("/api/*", () => fail(new ApiError(404, "not_found", "API endpoint was not found.")));
  app.notFound(() => fail(new ApiError(404, "not_found", "Endpoint was not found.")));
  app.onError(errorHandler);
  return app;
}
