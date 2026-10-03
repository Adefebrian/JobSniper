export type OutgoingMail = {
  to: string;
  from: string;
  fromName: string;
  subject: string;
  body: string;
  threadId?: string;
  attachments?: Array<{ filename: string; content: Uint8Array; mimeType: string }>;
};

export type SentMail = {
  providerMessageId: string;
  threadId: string | null;
};

export interface MailTransport {
  readonly name: "gmail" | "smtp";
  send(message: OutgoingMail): Promise<SentMail>;
  fetchThreadReplies(threadId: string): Promise<Array<{ from: string; body: string; receivedAt: string }>>;
}
