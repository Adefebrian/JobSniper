// Gmail over OAuth 2.0 (installed-app loopback flow). Brian creates a "Desktop app" OAuth client
// in Google Cloud once; JobSniper keeps the refresh token in the macOS Keychain and refreshes
// short-lived access tokens itself. Scopes: send + metadata (reply tracking without reading mail).
import { ApiError } from "../http";
import type { MailTransport, OutgoingMail, SentMail } from "../ports/mail";
import type { CredentialStore } from "../ports/runtime";

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.metadata",
];
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export class GmailAuth {
  private cached: { token: string; expiresAt: number } | undefined;
  private pendingState: string | undefined;

  constructor(private readonly credentials: CredentialStore, private readonly redirectUri: string) {}

  async client(): Promise<{ id: string; secret: string }> {
    const id = (await this.credentials.get("GMAIL_CLIENT_ID")) ?? "";
    const secret = (await this.credentials.get("GMAIL_CLIENT_SECRET")) ?? "";
    if (!id || !secret) {
      throw new ApiError(503, "gmail_client_missing", "Add the Google OAuth client ID and secret in Settings first.");
    }
    return { id, secret };
  }

  async connectUrl(): Promise<string> {
    const { id } = await this.client();
    this.pendingState = crypto.randomUUID();
    const params = new URLSearchParams({
      client_id: id,
      redirect_uri: this.redirectUri,
      response_type: "code",
      scope: GMAIL_SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      state: this.pendingState,
    });
    return `${AUTH_URL}?${params}`;
  }

  /** Exchanges the callback code; returns the connected Gmail address. */
  async finish(code: string, state: string): Promise<string> {
    if (!this.pendingState || state !== this.pendingState) {
      throw new ApiError(400, "gmail_state_mismatch", "Gmail connection expired. Start again from Settings.");
    }
    this.pendingState = undefined;
    const { id, secret } = await this.client();
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, client_id: id, client_secret: secret, redirect_uri: this.redirectUri, grant_type: "authorization_code",
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string;
    };
    if (!response.ok || !payload.refresh_token || !payload.access_token) {
      throw new ApiError(502, "gmail_token_failed", payload.error_description ?? "Google did not return a refresh token.");
    }
    await this.credentials.set("GMAIL_REFRESH_TOKEN", payload.refresh_token);
    this.cached = { token: payload.access_token, expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000 - 60_000 };
    const profile = await this.api<{ emailAddress?: string }>("/profile");
    return profile.emailAddress ?? "";
  }

  async connected(): Promise<boolean> {
    return Boolean(await this.credentials.get("GMAIL_REFRESH_TOKEN"));
  }

  async disconnect(): Promise<void> {
    await this.credentials.delete("GMAIL_REFRESH_TOKEN");
    this.cached = undefined;
  }

  async accessToken(): Promise<string> {
    if (this.cached && this.cached.expiresAt > Date.now()) return this.cached.token;
    const refresh = await this.credentials.get("GMAIL_REFRESH_TOKEN");
    if (!refresh) throw new ApiError(503, "gmail_not_connected", "Connect Gmail in Settings first.");
    const { id, secret } = await this.client();
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refresh, grant_type: "refresh_token" }),
    });
    const payload = (await response.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
    if (!response.ok || !payload.access_token) {
      throw new ApiError(502, "gmail_refresh_failed", "Gmail authorization expired. Reconnect Gmail in Settings.");
    }
    this.cached = { token: payload.access_token, expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000 - 60_000 };
    return payload.access_token;
  }

  async api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await this.accessToken();
    const response = await fetch(`${API}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new ApiError(502, "gmail_api_failed", `Gmail ${path} failed with ${response.status}. ${text.slice(0, 200)}`);
    }
    return (await response.json()) as T;
  }
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function base64Url(text: string): string {
  return base64(new TextEncoder().encode(text)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** RFC 2047 encoded-word for headers that may carry non-ASCII (names, subjects). */
export function encodeHeader(value: string): string {
  return /^[\x20-\x7E]*$/.test(value) ? value : `=?UTF-8?B?${base64(new TextEncoder().encode(value))}?=`;
}

function wrap76(value: string): string {
  return value.replace(/.{1,76}/g, (line) => `${line}\r\n`).trimEnd();
}

/** RFC 5322 message with a UTF-8 text part and base64 attachments. */
export function buildMime(message: OutgoingMail & { inReplyTo?: string }): string {
  const boundary = `jobsniper-${crypto.randomUUID()}`;
  const headers = [
    `From: ${encodeHeader(message.fromName)} <${message.from}>`,
    `To: ${message.to}`,
    `Subject: ${encodeHeader(message.subject)}`,
    "MIME-Version: 1.0",
    ...(message.inReplyTo ? [`In-Reply-To: ${message.inReplyTo}`, `References: ${message.inReplyTo}`] : []),
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];
  const parts = [
    `--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(base64(new TextEncoder().encode(message.body)))}`,
    ...(message.attachments ?? []).map((a) =>
      `--${boundary}\r\nContent-Type: ${a.mimeType}; name="${a.filename}"\r\nContent-Disposition: attachment; filename="${a.filename}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(base64(a.content))}`),
  ];
  return `${headers.join("\r\n")}\r\n\r\n${parts.join("\r\n")}\r\n--${boundary}--\r\n`;
}

export class GmailTransport implements MailTransport {
  readonly name = "gmail" as const;

  constructor(private readonly auth: GmailAuth) {}

  async send(message: OutgoingMail): Promise<SentMail> {
    // A follow-up joins the original thread: threadId in the body plus In-Reply-To headers.
    let inReplyTo: string | undefined;
    if (message.threadId) {
      const thread = await this.auth.api<{ messages?: Array<{ payload?: { headers?: Array<{ name?: string; value?: string }> } }> }>(
        `/threads/${encodeURIComponent(message.threadId)}?format=metadata&metadataHeaders=Message-ID`,
      );
      inReplyTo = thread.messages?.[0]?.payload?.headers?.find((h) => h.name?.toLowerCase() === "message-id")?.value;
    }
    const sent = await this.auth.api<{ id?: string; threadId?: string }>("/messages/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        raw: base64Url(buildMime({ ...message, ...(inReplyTo ? { inReplyTo } : {}) })),
        ...(message.threadId ? { threadId: message.threadId } : {}),
      }),
    });
    return { providerMessageId: sent.id ?? crypto.randomUUID(), threadId: sent.threadId ?? message.threadId ?? null };
  }

  async fetchThreadReplies(threadId: string) {
    const thread = await this.auth.api<{
      messages?: Array<{ snippet?: string; labelIds?: string[]; payload?: { headers?: Array<{ name?: string; value?: string }> } }>;
    }>(`/threads/${encodeURIComponent(threadId)}?format=metadata&metadataHeaders=From&metadataHeaders=Date`);
    // Anything after our first message that we did not send ourselves is a reply (or a bounce).
    return (thread.messages ?? [])
      .slice(1)
      .filter((m) => !(m.labelIds ?? []).includes("SENT"))
      .map((m) => {
        const header = (name: string) => m.payload?.headers?.find((h) => h.name?.toLowerCase() === name)?.value ?? "";
        return { from: header("from"), body: m.snippet ?? "", receivedAt: header("date") };
      });
  }
}
