import { ApiError } from "../../core/http";
import type { GroundedDraft } from "../../core/ports/ai";
import type {
  Clock,
  CvAttachmentProvider,
  IdGenerator,
  JevPort,
  LunaPort,
  OutreachContact,
  OutreachContextProvider,
  OutreachJobContext,
  OutreachRecord,
  RandomSource,
  Settings,
} from "./ports";
import {
  classifyReply,
  cvVariantForTitle,
  isWithinWorkWindow,
  nextWorkWindow,
  sendGate,
  timezoneForCountries,
  type ReplyClass,
} from "./policy";
import { OutreachRepository, type OutreachRow } from "./repo";

function normalized(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

export function groundedDraftValid(
  draft: GroundedDraft,
  sourceText: string,
  jobUrl: string,
): boolean {
  const source = normalized(sourceText);
  return draft.evidence.length > 0 &&
    draft.evidence.every((evidence) => evidence.quote.trim().length > 0 && source.includes(normalized(evidence.quote))) &&
    normalized(draft.body).includes(normalized(draft.whyCompany)) &&
    draft.body.includes(jobUrl);
}

export function emailBodyValid(subject: string, body: string, jobUrl: string): boolean {
  return subject.trim().length >= 8 &&
    subject.trim().length <= 180 &&
    body.includes(jobUrl) &&
    /\d/.test(body) &&
    /(call|chat|meet|conversation|discussion)/i.test(body) &&
    /(remote(ly)? from indonesia|relocat|visa sponsorship|work authorization)/i.test(body) &&
    /(available|availability|notice period|start date)/i.test(body);
}

function requireDraft(draft: GroundedDraft, job: OutreachJobContext): void {
  if (!groundedDraftValid(draft, job.jdText, job.url)) {
    throw new ApiError(422, "ungrounded_draft", "Draft claims must be grounded in the job source and include its posting URL.");
  }
  if (!emailBodyValid(draft.subject, draft.body, job.url)) {
    throw new ApiError(422, "draft_constraints", "Draft is missing a specific subject, evidence-backed value, work status, availability, posting link, or call to action.");
  }
}

function present(row: OutreachRow): Record<string, unknown> {
  const uiStatus = row.status === "approved" || row.status === "sending" ? "scheduled" : row.status;
  return {
    id: row.id,
    jobId: row.job_id,
    jobTitle: row.job_title,
    companyName: row.company_name,
    contactEmail: row.contact_email,
    kind: row.kind,
    subject: row.subject,
    body: row.body,
    cvVariant: row.cv_variant,
    status: uiStatus,
    workflowStatus: row.status,
    uiStatus,
    scheduledFor: row.scheduled_for,
    sentAt: row.sent_at,
    gmailThreadId: row.gmail_thread_id,
    replyClass: row.reply_class,
    replyText: row.reply_text,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class OutreachService {
  constructor(
    private readonly repository: OutreachRepository,
    private readonly context: OutreachContextProvider,
    private readonly luna: LunaPort,
    private readonly jev: JevPort,
    private readonly mail: {
      send: import("../../core/ports/mail").MailTransport["send"];
      fetchThreadReplies: import("../../core/ports/mail").MailTransport["fetchThreadReplies"];
    },
    private readonly attachments: CvAttachmentProvider,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly random: RandomSource = Math.random,
  ) {}

  async list(filters: {
    tab?: string;
    status?: string;
    kind?: string;
    replyClass?: string;
    page?: number;
    perPage?: number;
  }): Promise<Record<string, unknown> | Array<Record<string, unknown>>> {
    const mapped = this.filtersForTab(filters);
    const result = await this.repository.list({
      ...mapped,
      page: filters.page ?? 1,
      perPage: filters.perPage ?? 100,
    });
    const items = result.items.map((row) => {
      const item = present(row);
      return mapped.status === "followup_due" ? { ...item, status: "followup_due" } : item;
    });
    return filters.page === undefined && filters.perPage === undefined ? items : { ...result, items };
  }

  async get(id: string): Promise<Record<string, unknown>> {
    const row = await this.repository.get(id);
    if (!row) throw new ApiError(404, "outreach_not_found", "Outreach was not found.");
    return present(row);
  }

  async draft(input: {
    jobId: string;
    contactId?: string;
    kind?: "initial" | "followup";
  }): Promise<Record<string, unknown>> {
    if (input.kind === "followup") {
      const initial = await this.repository.getInitialForJob(input.jobId);
      if (!initial || initial.status !== "sent") throw new ApiError(409, "followup_not_due", "Follow-up requires a sent initial email.");
      if (await this.repository.hasFollowup(input.jobId)) throw new ApiError(409, "followup_exists", "Only one follow-up is allowed.");
    }
    const job = await this.context.job(input.jobId);
    if (!job) throw new ApiError(404, "job_not_found", "Job was not found.");
    const contact = input.contactId ? await this.context.contact(input.contactId) : undefined;
    if (input.contactId && !contact) throw new ApiError(404, "contact_not_found", "Contact was not found.");
    const settings = await this.context.settings();
    const remote = job.remoteScope === "remote_global" || job.remoteScope === "remote_apac";
    const draftInput = {
      profile: settings.profile,
      job: {
        title: job.title,
        company: job.company ?? "",
        url: job.url,
        location: job.location ?? "",
        kind: input.kind ?? "initial",
        workStatus: remote
          ? "I would work remotely from Indonesia (GMT+7) and can overlap with your core hours."
          : "I am based in Indonesia, open to relocating, and would need visa sponsorship.",
      },
      sourceText: job.jdText.slice(0, 12_000),
    };
    let generated = await this.luna.draftEmail(draftInput);
    await this.context.recordUsage(generated.usage);
    try {
      requireDraft(generated.result, job);
    } catch (first) {
      // One retry with the exact rule that failed; a second failure is surfaced to Brian.
      generated = await this.luna.draftEmail({
        ...draftInput,
        sourceText: `${draftInput.sourceText}\n\nPREVIOUS ATTEMPT WAS REJECTED: ${(first as Error).message} Fix it and follow every rule.`,
      });
      await this.context.recordUsage(generated.usage);
      requireDraft(generated.result, { ...job, jdText: job.jdText });
    }
    const row = await this.repository.create({
      id: this.ids.newId(),
      jobId: job.id,
      contactId: contact?.id ?? null,
      kind: input.kind ?? "initial",
      subject: generated.result.subject,
      body: generated.result.body,
      cvVariant: cvVariantForTitle(job.title),
      status: "draft",
      scheduledFor: null,
      sentAt: null,
      gmailThreadId: null,
      replyClass: null,
      replyText: null,
      lastError: null,
    });
    await this.context.recordGrounding({ outreachId: String(row.id), evidence: generated.result.evidence });
    return present(row);
  }

  async save(id: string, patch: {
    subject?: string;
    body?: string;
    cvVariant?: string;
    contactId?: string | null;
  }): Promise<Record<string, unknown>> {
    const current = await this.repository.get(id);
    if (!current) throw new ApiError(404, "outreach_not_found", "Outreach was not found.");
    if (current.status !== "draft") throw new ApiError(409, "outreach_locked", "Only drafts can be edited.");
    const job = await this.context.job(String(current.job_id));
    if (!job) throw new ApiError(404, "job_not_found", "Job was not found.");
    const subject = patch.subject ?? String(current.subject);
    const body = patch.body ?? String(current.body);
    if (!emailBodyValid(subject, body, job.url)) {
      throw new ApiError(422, "draft_constraints", "Edited draft does not satisfy the grounded email constraints.");
    }
    const row = await this.repository.patch(id, {
      ...(patch.subject === undefined ? {} : { subject: patch.subject }),
      ...(patch.body === undefined ? {} : { body: patch.body }),
      ...(patch.cvVariant === undefined ? {} : { cvVariant: normalizeCvVariant(patch.cvVariant) }),
      ...(patch.contactId === undefined ? {} : { contactId: patch.contactId }),
    });
    return present(this.requireRow(row));
  }

  async approve(id: string): Promise<Record<string, unknown>> {
    const current = await this.repository.get(id);
    if (!current) throw new ApiError(404, "outreach_not_found", "Outreach was not found.");
    if (current.kind === "initial" && current.status === "sent") {
      const followup = await this.createFollowup(id);
      return this.approve(String(followup.id));
    }
    await this.assertReady(current);
    await this.repository.patch(id, { status: "approved" });
    return this.schedule(id);
  }

  async reject(id: string, reason = "Rejected by Brian."): Promise<Record<string, unknown>> {
    const current = await this.repository.get(id);
    if (!current) throw new ApiError(404, "outreach_not_found", "Outreach was not found.");
    return present(this.requireRow(await this.repository.markClosed(id, reason)));
  }

  async schedule(id: string, scheduledFor?: string): Promise<Record<string, unknown>> {
    const current = await this.repository.get(id);
    if (!current) throw new ApiError(404, "outreach_not_found", "Outreach was not found.");
    await this.assertReady(current);
    const job = await this.context.job(String(current.job_id));
    if (!job) throw new ApiError(404, "job_not_found", "Job was not found.");
    const settings = await this.context.settings();
    const zone = timezoneForCountries(job.countries);
    const requested = scheduledFor ? new Date(scheduledFor) : null;
    if (requested && Number.isNaN(requested.getTime())) {
      throw new ApiError(400, "validation_error", "scheduledFor must be an ISO date.");
    }
    const base = requested ?? nextWorkWindow(this.clock.now(), zone, settings);
    const jitterMs = () => Math.round((4 + this.random() * 8) * 60_000);
    const latest = requested ? undefined : await this.repository.latestScheduledAt();
    const scheduled = requested
      ? new Date(requested)
      : new Date(Math.max(base.getTime() + jitterMs(), (latest?.getTime() ?? 0) + jitterMs()));
    if (scheduled.getTime() < this.clock.now().getTime()) {
      throw new ApiError(400, "validation_error", "scheduledFor cannot be in the past.");
    }
    return present(this.requireRow(await this.repository.patch(id, {
      status: "scheduled",
      scheduledFor: scheduled.toISOString(),
    })));
  }

  async send(id: string): Promise<{ outreach: Record<string, unknown>; gate: Record<string, unknown> }> {
    const current = await this.repository.get(id);
    if (!current) throw new ApiError(404, "outreach_not_found", "Outreach was not found.");
    const gateJob = await this.context.job(String(current.job_id));
    if (gateJob && gateJob.jevVerified === false) {
      throw new ApiError(409, "jev_unverified", "Jev has not verified this job yet, so it cannot be sent (PRD 11).");
    }
    const gate = await this.evaluateGate(current);
    if (!gate.pass) {
      throw new ApiError(409, gate.code, gate.reason);
    }
    const decision = await this.jev.decide({
      decisionId: "send_gate",
      subjectType: "outreach",
      subjectId: id,
      input: { gate, subject: current.subject, body: current.body },
    });
    if (decision.verdict.value !== true) {
      throw new ApiError(409, "send_gate", "Jev did not permit this email to be sent.");
    }
    const job = await this.context.job(String(current.job_id));
    const contact = current.contact_id ? await this.context.contact(String(current.contact_id)) : undefined;
    const settings = await this.context.settings();
    if (!job || !contact) throw new ApiError(409, "missing_contact", "Job or evidenced contact is missing.");
    await this.repository.markSending(id);
    try {
      const attachmentItems = await this.attachments.load(String(current.cv_variant));
      const sent = await this.mail.send({
        to: contact.email,
        from: settings.sender.fromEmail,
        fromName: settings.sender.fromName,
        subject: String(current.subject),
        body: String(current.body),
        ...(current.gmail_thread_id ? { threadId: String(current.gmail_thread_id) } : {}),
        ...(attachmentItems ? { attachments: attachmentItems } : {}),
      });
      const row = await this.repository.markSent(id, this.clock.now().toISOString(), sent.threadId);
      return { outreach: present(this.requireRow(row)), gate };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Mail transport failed.";
      await this.repository.markFailed(id, message.slice(0, 4_000));
      throw new ApiError(502, "send_failed", message.slice(0, 4_000));
    }
  }

  async sendDue(limit = 10): Promise<Array<Record<string, unknown>>> {
    const rows = await this.repository.dueScheduled(this.clock.now(), limit);
    const sent: Array<Record<string, unknown>> = [];
    for (const row of rows) {
      try {
        const job = await this.context.job(String(row.job_id));
        const settings = await this.context.settings();
        const timeZone = job ? timezoneForCountries(job.countries) : "UTC";
        if (!isWithinWorkWindow(this.clock.now(), timeZone, settings)) {
          sent.push({ ...(await this.schedule(String(row.id))), status: "rescheduled" });
          continue;
        }
        sent.push((await this.send(String(row.id))).outreach);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Send failed.";
        if (error instanceof ApiError && ["job_closed", "job_unverified", "missing_contact", "invalid_contact", "do_not_contact", "duplicate_outreach"].includes(error.code)) {
          await this.repository.markClosed(String(row.id), message);
          sent.push({ id: row.id, status: "closed", error: message });
        } else if (error instanceof ApiError && error.code === "daily_cap") {
          await this.repository.patch(String(row.id), {
            status: "scheduled",
            scheduledFor: new Date(this.clock.now().getTime() + 24 * 60 * 60 * 1_000).toISOString(),
          });
          sent.push({ id: row.id, status: "rescheduled", error: message });
        } else if (error instanceof ApiError && error.code === "send_failed") {
          await this.repository.markFailed(String(row.id), message);
          sent.push({ id: row.id, status: "failed", error: message });
        } else {
          await this.repository.patch(String(row.id), {
            status: "scheduled",
            scheduledFor: new Date(this.clock.now().getTime() + 60 * 60 * 1_000).toISOString(),
          });
          sent.push({ id: row.id, status: "rescheduled", error: message });
        }
      }
    }
    return sent;
  }

  async trackReplies(limit = 50): Promise<Array<Record<string, unknown>>> {
    const cutoff = this.clock.now().getTime() - 60 * 60 * 1_000;
    const rows = (await this.repository.listReplyCandidates()).filter((row) => {
      const sentAt = row.sent_at === null ? 0 : new Date(String(row.sent_at)).getTime();
      return sentAt <= cutoff;
    }).slice(0, limit);
    const results: Array<Record<string, unknown>> = [];
    for (const row of rows) {
      const replies = await this.mail.fetchThreadReplies(String(row.gmail_thread_id));
      const latest = replies.at(-1);
      if (!latest) continue;
      const decision = await this.jev.decide({
        decisionId: "reply_class",
        subjectType: "outreach",
        subjectId: String(row.id),
        input: { quote: latest.body, from: latest.from, receivedAt: latest.receivedAt },
      });
      const value = String(decision.verdict.value);
      const replyClass: ReplyClass = ["positive", "negative", "auto_reply", "bounce"].includes(value)
        ? value as ReplyClass
        : classifyReply(latest.body);
      const updated = await this.repository.recordReply(String(row.id), replyClass, latest.body.slice(0, 20_000));
      if (replyClass === "negative") await this.context.blockContact(latest.from, "Negative reply.");
      if (replyClass === "bounce" && row.contact_id) {
        await this.context.invalidateContact(String(row.contact_id), "Mailbox bounced.");
      }
      results.push(present(this.requireRow(updated)));
    }
    return results;
  }

  async followupsDue(): Promise<Array<Record<string, unknown>>> {
    const rows = await this.repository.followupCandidates(this.clock.now(), 6 * 86_400_000);
    return rows.map((row) => ({ ...present(row), status: "followup_due" }));
  }

  async createFollowup(initialId: string): Promise<Record<string, unknown>> {
    const initial = await this.repository.get(initialId);
    if (!initial) throw new ApiError(404, "outreach_not_found", "Initial outreach was not found.");
    if (initial.kind !== "initial" || initial.status !== "sent") {
      throw new ApiError(409, "followup_not_due", "Follow-up requires a sent initial email.");
    }
    const sentAt = initial.sent_at ? new Date(String(initial.sent_at)).getTime() : 0;
    if (this.clock.now().getTime() - sentAt < 6 * 86_400_000) {
      throw new ApiError(409, "followup_not_due", "Follow-up is due six days after the initial email.");
    }
    if (await this.repository.hasFollowup(String(initial.job_id))) {
      throw new ApiError(409, "followup_exists", "Only one follow-up is allowed.");
    }
    const draft = await this.draft({
      jobId: String(initial.job_id),
      ...(initial.contact_id ? { contactId: String(initial.contact_id) } : {}),
      kind: "followup",
    });
    const row = await this.repository.patch(String(draft.id), {
      subject: `Follow-up: ${String(initial.subject)}`.slice(0, 180),
    });
    return present(this.requireRow(row));
  }

  async operationalCounts(): Promise<Record<string, number>> {
    return this.repository.statusCounts();
  }

  async exportRows(): Promise<Array<Record<string, unknown>>> {
    return (await this.repository.exportRows()).map(present);
  }

  private filtersForTab(filters: { tab?: string; status?: string; kind?: string; replyClass?: string }): {
    status?: string;
    kind?: string;
    replyClass?: string;
  } {
    const tabStatus: Record<string, string> = {
      drafts: "draft",
      draft: "draft",
      scheduled: "scheduled",
      sent: "sent",
      replied: "replied",
    };
    return {
      ...(filters.tab && tabStatus[filters.tab] ? { status: tabStatus[filters.tab] } : {}),
      ...(filters.tab === "scheduled" ? { status: "scheduled_queue" } : {}),
      ...(filters.tab === "followup_due" ? { status: "followup_due" } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.kind ? { kind: filters.kind } : {}),
      ...(filters.replyClass ? { replyClass: filters.replyClass } : {}),
    };
  }

  private async assertReady(row: OutreachRow): Promise<void> {
    const job = await this.context.job(String(row.job_id));
    if (!job) throw new ApiError(404, "job_not_found", "Job was not found.");
    if (!emailBodyValid(String(row.subject), String(row.body), job.url)) {
      throw new ApiError(422, "draft_constraints", "Outreach does not satisfy the grounded email constraints.");
    }
  }

  private async evaluateGate(row: OutreachRow): Promise<{ pass: boolean; code: string; reason: string }> {
    const job = await this.context.job(String(row.job_id));
    const contact = row.contact_id ? await this.context.contact(String(row.contact_id)) : undefined;
    const settings = await this.context.settings();
    const profileTimezone = settings.profile.timezone;
    const timeZone = typeof profileTimezone === "string" && profileTimezone.length > 0
      ? profileTimezone
      : "Asia/Jakarta";
    const result = sendGate({
      outreach: {
        id: String(row.id),
        kind: row.kind as "initial" | "followup",
        status: String(row.status),
        contactId: row.contact_id === null ? null : String(row.contact_id),
      },
      job: job ?? {
        id: String(row.job_id),
        title: "",
        url: "",
        jdText: "",
        status: "closed",
        countries: [],
      },
      ...(contact ? { contact } : {}),
      doNotContact: contact ? await this.context.isDoNotContact(contact.email) : true,
      sentToday: await this.repository.sentOnDay(this.clock.now(), timeZone),
      alreadySentSameKind: await this.repository.alreadySentSameKind(String(row.job_id), String(row.kind), String(row.id)),
      dailySendCap: settings.dailySendCap,
    });
    return result;
  }

  private requireRow(row: OutreachRow | undefined): OutreachRow {
    if (!row) throw new ApiError(404, "outreach_not_found", "Outreach was not found.");
    return row;
  }
}

function normalizeCvVariant(value: string): string {
  const normalizedValue = value.trim().toLowerCase().replaceAll(" ", "_");
  if (normalizedValue === "ai_fullstack" || normalizedValue === "ai_engineer") return normalizedValue;
  throw new ApiError(400, "validation_error", "cvVariant must be ai_fullstack or ai_engineer.");
}
