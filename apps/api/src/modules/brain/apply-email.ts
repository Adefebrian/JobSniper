// The sniper's core detector: does this job take applications by email, and to which address?
// Strict on purpose: only an address written inside an application instruction counts. Addresses
// for accommodations, privacy, security, support, sales and the like never do, and neither does an
// address whose domain cannot be real.
import { sentences } from "./prefilter";

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}/g;

// Application object + verb, or an explicit "apply by email".
const APPLY_STRONG =
  /\b(send|email|e-mail|mail|submit|forward|share|drop|attach)\b[^.\n]{0,80}\b(cv|c\.v\.|resume|résumé|resumes|application|portfolio|cover letter|github|linkedin profile)\b|\b(apply|applications?|applying|candidates?)\b[^.\n]{0,60}\b(by|via|to|at|through|on)\b[^.\n]{0,30}(e-?mail|@)|\b(bewerbung|lebenslauf|candidature)\b/i;
// Softer invitations count only when the text around them is clearly about a job.
const APPLY_SOFT = /\b(interested|reach out|get in touch|email us|e-mail us|write to us|ping us|contact (me|us))\b/i;
const HIRING_CONTEXT = /\b(job|role|position|opening|hiring|join|team|engineer|developer|candidate|apply|application)\b/i;
const HIRING_MAILBOX = /^(jobs?|careers?|hiring|recruit(ing|ment|er)?|talent|hr|people|apply|join|work)([._+-].*)?$/i;
// Never an application address, wherever it appears.
const NOT_APPLY_LOCAL =
  /(privacy|gdpr|dpo|legal|abuse|no-?reply|donotreply|security|press|media|invest|billing|invoice|support|help|accommodat|accessib|ethics|compliance|disab|eeo|benefit|payroll|sales|partner|marketing|^info$|feedback|webmaster|admin)/i;
const NOT_APPLY_CONTEXT =
  /(accommodation|disabilit|reasonable adjustment|privacy|data protection|personal data|security (issue|vulnerab|report)|report (a|any) (bug|vulnerab)|whistle|equal opportunity|eeo)/i;
const SHORT_TLD = /^[a-z]{2,6}$/;
const LONG_TLDS = new Set(["technology", "engineering", "solutions", "software", "careers", "systems", "digital", "agency", "network", "energy", "company", "capital", "ventures", "studio", "health", "finance", "global"]);

export function plausibleEmail(email: string): boolean {
  const [local, domain] = email.split("@");
  if (!local || !domain || local.length > 64) return false;
  const tld = domain.split(".").pop()!.toLowerCase();
  return SHORT_TLD.test(tld) || LONG_TLDS.has(tld);
}

export type ApplyEmail = { email: string; quote: string };

function clean(email: string): string {
  return email.replace(/[.,;:)\]]+$/, "").toLowerCase();
}

export function detectApplyEmail(jdText: string, applyUrl: string | null): ApplyEmail | null {
  if (applyUrl && /^mailto:/i.test(applyUrl)) {
    const email = clean(decodeURIComponent(applyUrl.slice(7).split("?")[0] ?? "").trim());
    if (email.includes("@") && plausibleEmail(email) && !NOT_APPLY_LOCAL.test(email.split("@")[0]!)) {
      return { email, quote: `Apply link: mailto:${email}` };
    }
  }
  const list = sentences(jdText);
  for (let i = 0; i < list.length; i++) {
    const sentence = list[i]!;
    const found = sentence.match(EMAIL);
    if (!found) continue;
    const context = `${list[i - 1] ?? ""} ${sentence}`;
    if (NOT_APPLY_CONTEXT.test(sentence)) continue;
    for (const raw of found) {
      const email = clean(raw);
      const local = email.split("@")[0]!;
      if (!plausibleEmail(email) || NOT_APPLY_LOCAL.test(local)) continue;
      const strong = APPLY_STRONG.test(context);
      const soft = APPLY_SOFT.test(context) && HIRING_CONTEXT.test(context);
      const mailbox = HIRING_MAILBOX.test(local) && HIRING_CONTEXT.test(context);
      if (strong || soft || mailbox) {
        return { email, quote: sentence.length > 300 ? `${sentence.slice(0, 297)}...` : sentence };
      }
    }
  }
  return null;
}
