import { ApiError } from "../../core/http";
import type { ContactRecord } from "../../core/domain";
import type { Clock, IdGenerator, JevPort } from "./ports";
import { ContactsRepository } from "./repo";

export type ContactInput = {
  jobId: string;
  email: string;
  name?: string | null | undefined;
  role?: string | null | undefined;
  kind: ContactRecord["kind"];
  sourceUrl: string;
  sourceQuote: string;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validatePublicContact(input: {
  email: string;
  sourceUrl: string;
  sourceQuote: string;
}): void {
  const email = input.email.trim();
  if (!EMAIL.test(email)) throw new ApiError(400, "invalid_email", "A complete public email address is required.");
  if (!input.sourceQuote.includes(email)) {
    throw new ApiError(400, "email_not_evidenced", "The email must appear exactly in the source quote.");
  }
  const url = new URL(input.sourceUrl);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new ApiError(400, "invalid_contact_source", "Contact source must be a public HTTPS URL.");
  }
}

import { searchRecruiterEmails } from "./recruiter-search";

export class ContactsService {
  constructor(
    private readonly repository: ContactsRepository,
    private readonly jev: JevPort,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  /** PRD 8.1 recruiter_search for one company per call (paced by the caller). */
  async recruiterSearchOnce(): Promise<{ company?: string; found: number }> {
    const company = await this.repository.nextCompanyToSearch();
    if (!company) return { found: 0 };
    await this.repository.markSearched(company.id);
    let found;
    try {
      found = await searchRecruiterEmails(company.name);
    } catch (error) {
      await this.repository.unmarkSearched(company.id); // try this company again later
      throw error;
    }
    let kept = 0;
    for (const item of found) {
      let verdict: unknown;
      try {
        const decision = await this.jev.decide({
          decisionId: "contact_valid",
          subjectType: "company",
          subjectId: company.id,
          input: { company: company.name, email: item.email, sourceUrl: item.sourceUrl, evidence: [{ quote: item.quote, source: item.sourceUrl, reason: "Public search result" }] },
        });
        verdict = decision.verdict;
        if (decision.verdict.value === false) continue;
      } catch {
        verdict = undefined; // kept, labelled unverified until Jev is reachable
      }
      await this.repository.insertRecruiterContact(company.id, { ...item, verdict });
      kept++;
    }
    return { company: company.name, found: kept };
  }

  async listForJob(jobId: string) {
    return this.repository.listForJob(jobId);
  }

  async addPublicContact(input: ContactInput): Promise<Record<string, unknown>> {
    validatePublicContact(input);
    if (!await this.repository.jobExists(input.jobId)) {
      throw new ApiError(404, "job_not_found", "Job was not found.");
    }
    if (await this.repository.isDoNotContact(input.email)) {
      throw new ApiError(409, "do_not_contact", "This email or domain is on the do-not-contact list.");
    }
    const decision = await this.jev.decide({
      decisionId: "contact_valid",
      subjectType: "contact",
      subjectId: input.jobId,
      input: {
        email: input.email,
        sourceUrl: input.sourceUrl,
        evidence: [{ quote: input.sourceQuote, source: input.sourceUrl, reason: "Public contact evidence" }],
      },
    });
    const record: ContactRecord = {
      id: this.ids.newId(),
      companyId: "",
      jobId: input.jobId,
      email: input.email.trim(),
      name: input.name ?? null,
      role: input.role ?? null,
      kind: input.kind,
      sourceUrl: input.sourceUrl,
      sourceQuote: input.sourceQuote,
      invalidAt: null,
    };
    return this.repository.insert({ ...record, verdict: decision.verdict as never });
  }

  async invalidate(id: string, reason: string): Promise<Record<string, unknown>> {
    const record = await this.repository.invalidate(id, reason);
    if (!record) throw new ApiError(404, "contact_not_found", "Contact was not found or is already invalid.");
    return record;
  }

  async isDoNotContact(email: string): Promise<boolean> {
    return this.repository.isDoNotContact(email);
  }
}
