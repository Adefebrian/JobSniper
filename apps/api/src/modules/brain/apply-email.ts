// The sniper's core detector: does this job take applications by email, and to which address?
// Only an email that sits in an application instruction counts ("send your CV to jobs@x.com",
// "apply by email", a mailto: apply link). A privacy or support address never does.
import { sentences } from "./prefilter";

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const APPLY_INTENT =
  /\b(send|email|e-mail|mail|submit|forward|share|drop)\b[^.]{0,80}\b(cv|c\.v\.|resume|résumé|application|portfolio|github|linkedin|profile|cover letter|details)\b|\b(apply|applications?|applying|interested|reach out|get in touch|contact)\b[^.]{0,60}\b(by|via|to|at|on|through|email|e-mail)\b|\b(get in touch|reach out|email us|e-mail us|write to us|drop us a (line|note)|say (hi|hello)|ping us|hiring@|jobs@|careers@)\b|\b(bewerbung|lebenslauf|candidature|cv à)\b/i;
const NOT_APPLY =
  /^(privacy|gdpr|dpo|data\.?protection|legal|abuse|no-?reply|donotreply|security|press|media|investors?|billing|invoices?|support|help|accommodations?|accessibility|sales|partners?|marketing|info@.*privacy)$/i;

export type ApplyEmail = { email: string; quote: string };

export function detectApplyEmail(jdText: string, applyUrl: string | null): ApplyEmail | null {
  if (applyUrl && /^mailto:/i.test(applyUrl)) {
    const email = decodeURIComponent(applyUrl.slice(7).split("?")[0] ?? "").trim().toLowerCase();
    if (email.includes("@")) return { email, quote: `Apply link: mailto:${email}` };
  }
  const list = sentences(jdText);
  for (let i = 0; i < list.length; i++) {
    const sentence = list[i]!;
    const emails = sentence.match(EMAIL);
    if (!emails) continue;
    // the instruction may sit in this sentence or the one right before ("Interested? ... Email: jobs@x.com")
    const context = `${list[i - 1] ?? ""} ${sentence}`;
    if (!APPLY_INTENT.test(context)) continue;
    const email = emails
      .map((e) => e.replace(/[.,;:)]+$/, "").toLowerCase())
      .find((e) => !NOT_APPLY.test(e.split("@")[0] ?? ""));
    if (email) return { email, quote: sentence.length > 300 ? `${sentence.slice(0, 297)}...` : sentence };
  }
  return null;
}
