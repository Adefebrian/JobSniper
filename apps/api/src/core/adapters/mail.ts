import net from "node:net";
import tls from "node:tls";
import { ApiError } from "../http";
import type { MailTransport, OutgoingMail, SentMail } from "../ports/mail";
import { buildMime } from "./gmail";
import type { CredentialStore } from "../ports/runtime";

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
      // Dot-stuffing (RFC 5321 4.5.2): only lines that start with "." get an extra dot.
      const data = buildMime(message).replace(/\r\n\./g, "\r\n..").replace(/^\./, "..");
      await smtpExchange(socket, `${data}\r\n.`, [250]);
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
