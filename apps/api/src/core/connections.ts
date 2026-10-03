// Settings > Connections: secrets go straight to the macOS Keychain; the API only ever reports
// whether each one is set. Gmail connects with the OAuth loopback flow.
import type { Hono } from "hono";
import { ApiError, ok, requireObject } from "./http";
import type { CredentialStore } from "./ports/runtime";
import type { GmailAuth } from "./adapters/gmail";
import type { Queryable } from "./ports/database";

const SECRETS = ["OPENAI_API_KEY", "JEV_API_KEY", "GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "SMTP_PASSWORD"] as const;

export function mountConnections(app: Hono, credentials: CredentialStore, gmail: GmailAuth, database: Queryable): void {
  app.get("/api/connections", async () => {
    const status: Record<string, boolean> = {};
    for (const name of SECRETS) status[name] = Boolean(await credentials.get(name));
    status.GMAIL_CONNECTED = await gmail.connected();
    return ok(status);
  });

  app.put("/api/connections/:name", async (context) => {
    const name = context.req.param("name") as (typeof SECRETS)[number];
    if (!SECRETS.includes(name)) throw new ApiError(400, "unknown_secret", "Unknown connection field.");
    const body = requireObject(await context.req.json().catch(() => null));
    const value = typeof body.value === "string" ? body.value.trim() : "";
    if (!value) await credentials.delete(name);
    else await credentials.set(name, value);
    return ok({ name, set: Boolean(value) });
  });

  app.get("/api/gmail/connect", async (context) => context.redirect(await gmail.connectUrl()));

  app.get("/api/gmail/callback", async (context) => {
    const error = context.req.query("error");
    const page = (message: string) =>
      context.html(`<!doctype html><meta charset="utf-8"><title>JobSniper</title>
        <body style="font-family:-apple-system,sans-serif;background:#fff;color:#111418;padding:48px">
        <p style="font-size:16px">${message}</p><p><a href="/#settings" style="color:#0b57d0">Back to JobSniper</a></p></body>`);
    if (error) return page(`Gmail was not connected (${error}).`);
    const email = await gmail.finish(context.req.query("code") ?? "", context.req.query("state") ?? "");
    await database.query(
      `INSERT INTO settings (key, value)
       VALUES ('app', jsonb_build_object('sender', jsonb_build_object('provider', 'gmail', 'fromEmail', $1::text)))
       ON CONFLICT (key) DO UPDATE SET
         value = settings.value || jsonb_build_object('sender',
           coalesce(settings.value->'sender', '{}'::jsonb) || jsonb_build_object('provider', 'gmail', 'fromEmail', $1::text)),
         updated_at = now()`,
      [email],
    );
    return page(`Gmail connected as ${email}. You can close this tab.`);
  });

  app.post("/api/gmail/disconnect", async () => {
    await gmail.disconnect();
    return ok({ connected: false });
  });
}
