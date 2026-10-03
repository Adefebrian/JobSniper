import net from "node:net";
import tls from "node:tls";
import { ApiError } from "../http";
import type { MailTransport, OutgoingMail, SentMail } from "../ports/mail";
import type { CredentialStore } from "../ports/runtime";

function encodeBase64Url(value: Uint8Array | string): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function quotedPrintable(value: string): string {
  return value
    .replace(/[^\x20-\x7E\n]/g, (character) =>
      Array.from(new TextEncoder().encode(character))
        .map((byte) => `=${byte.toString(16).toUpperCase().padStart(2, "0")}`)
        .join(""),
    )
    .replace(/\n/g, "\r\n")
    .replace(/[ \t]+$/gm, (spaces) =>
      Array.from(spaces).map(() => "=20").join(""),
    );
}

function mailBody(message: OutgoingMail): string {
  const boundary = `jobsniper-${crypto.randomUUID()}`;
  const headers = [
    `From: ${message.fromName} <${message.from}>`,
    `To: ${message.to}`,
    `Subject: ${message.subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ...(message.threadId ? [`X-GM-THRID: ${message.threadId}`] : []),
  ].join("\r\n");
  const text = `--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n${quotedPrintable(message.body)}`;
  const attachments = (message.attachments ?? []).map((attachment) =>
    `--${boundary}\r\nContent-Type: ${attachment.mimeType}; name="${attachment.filename}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${encodeBase64Url(attachment.content).replace(/-/g, "+").replace(/_/g, "/")}`,
  );
  return `${headers}\r\n\r\n${text}\r\n${attachments.join("\r\n")}\r\n--${boundary}--\r\n`;
}

export class GmailTransport implements MailTransport {
  readonly name = "gmail" as const;

  constructor(
    private readonly credentials: CredentialStore,
    private readonly baseUrl = "https://gmail.googleapis.com/gmail/v1/users/me",
  ) {}

  async send(message: OutgoingMail): Promise<SentMail> {
    const token = (await this.credentials.get("GMAIL_ACCESS_TOKEN")) ?? process.env.GMAIL_ACCESS_TOKEN;
    if (!token) throw new ApiError(503, "gmail_credentials_missing", "Gmail access token is not configured.");
    const response = await fetch(`${this.baseUrl}/messages/send`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ raw: encodeBase64Url(mailBody(message)) }),
    });
    if (!response.ok) throw new ApiError(502, "gmail_send_failed", `Gmail send failed with ${response.status}.`);
    const payload = await response.json() as { id?: string; threadId?: string };
    return {
      providerMessageId: payload.id ?? crypto.randomUUID(),
      threadId: payload.threadId ?? message.threadId ?? null,
    };
  }

  async fetchThreadReplies(threadId: string) {
    const token = (await this.credentials.get("GMAIL_ACCESS_TOKEN")) ?? process.env.GMAIL_ACCESS_TOKEN;
    if (!token) throw new ApiError(503, "gmail_credentials_missing", "Gmail access token is not configured.");
    const response = await fetch(`${this.baseUrl}/threads/${encodeURIComponent(threadId)}?format=metadata`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new ApiError(502, "gmail_thread_failed", `Gmail thread fetch failed with ${response.status}.`);
    const payload = await response.json() as {
      messages?: Array<{ payload?: { headers?: Array<{ name?: string; value?: string }> } }>;
    };
    return (payload.messages ?? []).slice(1).map((message) => {
      const headers = message.payload?.headers ?? [];
      const header = (name: string) => headers.find((item) => item.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
      return {
        from: header("from"),
        body: "",
        receivedAt: header("date"),
      };
    });
  }
}

type SmtpResponse = { code: number; text: string };

async function smtpExchange(
  socket: net.Socket | tls.TLSSocket,
  command: string | null,
  expected: number[],
): Promise<SmtpResponse> {
  if (command !== null) socket.write(`${command}\r\n`);
  return await new Promise((resolve, reject) => {
    let buffer = "";
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\r\n").filter(Boolean);
      const last = lines.at(-1);
      if (!last || /^\d{3}-/.test(last)) return;
      cleanup();
      const code = Number(last.slice(0, 3));
      const response = { code, text: buffer.trim() };
      if (expected.includes(code)) resolve(response);
      else reject(new ApiError(502, "smtp_protocol_error", `SMTP returned ${code}: ${response.text}`));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(new ApiError(502, "smtp_connection_error", error.message));
    };
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
    };
    socket.on("data", onData);
    socket.on("error", onError);
  });
}

export class SmtpTransport implements MailTransport {
  readonly name = "smtp" as const;

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly credentials: CredentialStore,
    private readonly username: string,
    private readonly secure = true,
  ) {}

  async send(message: OutgoingMail): Promise<SentMail> {
    const password = (await this.credentials.get("SMTP_PASSWORD")) ?? process.env.SMTP_PASSWORD;
    if (!password) throw new ApiError(503, "smtp_credentials_missing", "SMTP password is not configured.");
    const socket = this.secure
      ? tls.connect({ host: this.host, port: this.port, servername: this.host })
      : net.connect({ host: this.host, port: this.port });
    await new Promise<void>((resolve, reject) => {
      socket.once(this.secure ? "secureConnect" : "connect", resolve);
      socket.once("error", reject);
    });
    try {
      await smtpExchange(socket, null, [220]);
      await smtpExchange(socket, `EHLO ${this.host}`, [250]);
      await smtpExchange(socket, "AUTH LOGIN", [334]);
      await smtpExchange(socket, btoa(this.username), [334]);
      await smtpExchange(socket, btoa(password), [235]);
      await smtpExchange(socket, `MAIL FROM:<${message.from}>`, [250]);
      await smtpExchange(socket, `RCPT TO:<${message.to}>`, [250, 251]);
      await smtpExchange(socket, "DATA", [354]);
      await smtpExchange(socket, `${mailBody(message).replace(/\r\n/g, "\r\n.").replace(/\.$/, "\r\n..")}\r\n.`, [250]);
      await smtpExchange(socket, "QUIT", [221]);
      return { providerMessageId: crypto.randomUUID(), threadId: message.threadId ?? null };
    } finally {
      socket.end();
    }
  }

  async fetchThreadReplies(): Promise<Array<{ from: string; body: string; receivedAt: string }>> {
    throw new ApiError(501, "smtp_reply_tracking_unsupported", "SMTP reply tracking requires Gmail metadata or a provider adapter.");
  }
}
