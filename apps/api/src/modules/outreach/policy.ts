import type { Settings } from "../../core/domain";
import type { OutreachContact, OutreachJobContext } from "./ports";

export type SendGateState = {
  outreach: {
    id: string;
    kind: "initial" | "followup";
    status: string;
    contactId: string | null;
  };
  job: OutreachJobContext;
  contact?: OutreachContact;
  doNotContact: boolean;
  sentToday: number;
  alreadySentSameKind: boolean;
  dailySendCap: number;
};

export type SendGateResult = {
  pass: boolean;
  code:
    | "ok"
    | "not_approved"
    | "job_closed"
    | "job_unverified"
    | "missing_contact"
    | "invalid_contact"
    | "do_not_contact"
    | "duplicate_outreach"
    | "daily_cap";
  reason: string;
};

export function sendGate(state: SendGateState): SendGateResult {
  const result = (pass: boolean, code: SendGateResult["code"], reason: string): SendGateResult =>
    ({ pass, code, reason });
  if (!["approved", "scheduled", "sending"].includes(state.outreach.status)) {
    return result(false, "not_approved", "Email must be approved before sending.");
  }
  if (state.job.status === "closed" || state.job.status === "skipped" || state.job.status === "blacklisted") {
    return result(false, "job_closed", "Job is closed, skipped, or blacklisted.");
  }
  if (state.job.status === "unverified" || state.job.status === "pending_judge") {
    return result(false, "job_unverified", "Unverified jobs are never sent.");
  }
  if (!state.outreach.contactId || !state.contact) {
    return result(false, "missing_contact", "No evidenced public contact is attached.");
  }
  if (state.contact.invalidAt) return result(false, "invalid_contact", "Contact is invalid.");
  if (state.doNotContact) return result(false, "do_not_contact", "Email or domain is on do-not-contact.");
  if (state.alreadySentSameKind) return result(false, "duplicate_outreach", "This outreach kind was already sent.");
  if (state.sentToday >= state.dailySendCap) return result(false, "daily_cap", "Daily send cap reached.");
  return result(true, "ok", "Send gate passed.");
}

export type ReplyClass = "positive" | "negative" | "auto_reply" | "bounce";

export function classifyReply(text: string): ReplyClass {
  const lower = text.toLowerCase();
  if (/delivery failed|undeliverable|mailbox unavailable|address not found|550 5\.1\./.test(lower)) return "bounce";
  if (/out of office|automatic reply|auto-reply|vacation responder/.test(lower)) return "auto_reply";
  if (/unfortunately|not moving forward|decided not to|other candidates|position has been filled|no longer considering/.test(lower)) {
    return "negative";
  }
  return "positive";
}

const COUNTRY_ZONES: Record<string, string> = {
  SG: "Asia/Singapore",
  AU: "Australia/Sydney",
  NZ: "Pacific/Auckland",
  US: "America/New_York",
  UK: "Europe/London",
  CA: "America/Toronto",
  CH: "Europe/Zurich",
  DE: "Europe/Berlin",
  AE: "Asia/Dubai",
  QA: "Asia/Qatar",
  SA: "Asia/Riyadh",
  ID: "Asia/Jakarta",
};

export function timezoneForCountries(countries: string[]): string {
  return countries.map((country) => COUNTRY_ZONES[country.toUpperCase()]).find(Boolean) ?? "UTC";
}

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    weekday: weekdays[get("weekday")] ?? 0,
  };
}

function timezoneOffset(time: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(time));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - time;
}

export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, 0, 0);
  const firstOffset = timezoneOffset(guess, timeZone);
  const adjusted = guess - firstOffset;
  const secondOffset = timezoneOffset(adjusted, timeZone);
  return new Date(guess - secondOffset);
}

export function isWithinWorkWindow(date: Date, timeZone: string, settings: Settings): boolean {
  const local = zonedParts(date, timeZone);
  return settings.workWindows.days.includes(local.weekday) &&
    local.hour >= settings.workWindows.startHour &&
    local.hour < settings.workWindows.endHour;
}

export function nextWorkWindow(now: Date, timeZone: string, settings: Settings): Date {
  if (isWithinWorkWindow(now, timeZone, settings)) return now;
  for (let offset = 0; offset <= 21; offset += 1) {
    const candidate = new Date(now.getTime() + offset * 86_400_000);
    const local = zonedParts(candidate, timeZone);
    if (!settings.workWindows.days.includes(local.weekday)) continue;
    const start = zonedTimeToUtc(
      local.year,
      local.month,
      local.day,
      settings.workWindows.startHour,
      timeZone,
    );
    if (start > now) return start;
  }
  return new Date(now.getTime() + 24 * 60 * 60 * 1_000);
}

export function cvVariantForTitle(title: string): string {
  return /full\s?stack|backend|back-end|platform/i.test(title) ? "ai_fullstack" : "ai_engineer";
}
