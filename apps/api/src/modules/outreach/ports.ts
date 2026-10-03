export type { Clock, IdGenerator } from "../../core/ports/runtime";
export type { JevPort, LunaPort, LlmUsage } from "../../core/ports/ai";
export type { MailTransport, OutgoingMail } from "../../core/ports/mail";
export type { DatabasePort, Queryable } from "../../core/ports/database";
export type { OutreachRecord, Settings } from "../../core/domain";
import type { LlmUsage } from "../../core/ports/ai";
import type { OutgoingMail } from "../../core/ports/mail";
import type { Settings as OutreachSettings } from "../../core/domain";

export type OutreachJobContext = {
  id: string;
  title: string;
  url: string;
  jdText: string;
  status: string;
  countries: string[];
};

export type OutreachContact = {
  id: string;
  email: string;
  name: string | null;
  invalidAt: string | null;
};

export type OutreachContextProvider = {
  job(id: string): Promise<OutreachJobContext | undefined>;
  contact(id: string): Promise<OutreachContact | undefined>;
  isDoNotContact(email: string): Promise<boolean>;
  blockContact(email: string, reason: string): Promise<void>;
  invalidateContact(id: string, reason: string): Promise<void>;
  settings(): Promise<OutreachSettings>;
  recordUsage(usage: LlmUsage): Promise<void>;
  recordGrounding(input: {
    outreachId: string;
    evidence: Array<{ quote: string; source: string; reason: string }>;
  }): Promise<void>;
};

export type CvAttachmentProvider = {
  load(cvVariant: string): Promise<OutgoingMail["attachments"]>;
};

export type RandomSource = () => number;
