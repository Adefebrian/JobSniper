import { ApiError } from "../http";
import type {
  GroundedDraft,
  JobExtraction,
  LunaPort,
  LlmUsage,
  ParsedProfile,
} from "../ports/ai";
import type { CredentialStore } from "../ports/runtime";

type ChatCompletion = {
  id?: string;
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

function parseJson<T>(text: string): T {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new ApiError(502, "luna_invalid_response", "gpt-6-luna returned invalid JSON.");
  }
}

export class LunaClient implements LunaPort {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly credentials: CredentialStore,
    private readonly prices = { inputPerMillion: 2, outputPerMillion: 8 },
  ) {}

  async parseProfile(input: { sourceText: string }): Promise<{ result: ParsedProfile; usage: LlmUsage }> {
    return this.complete<ParsedProfile>(
      "profile_parse",
      `Extract the candidate profile from the CV text. Use only facts written in the CV. Reply with JSON exactly:
{"profile":{"name":string,"email":string,"location":string,"timezone":"Asia/Jakarta","skills":string[] (up to 30 concrete technical skills, most important first, spelled as in the CV),
"achievements":string[] (up to 10 quantified achievements copied from the CV, each one sentence with its number),
"titles":string[],"yearsExperience":number,"availability":string,"noticePeriod":string,"links":{"github":string,"linkedin":string,"portfolio":string}},
"sourceText":string (the CV text you used)}. Use "" when a field is not in the CV.`,
      input,
    );
  }

  async extractJob(input: {
    title: string;
    jdText: string;
    language: string;
  }): Promise<{ result: JobExtraction; usage: LlmUsage }> {
    return this.complete<JobExtraction>(
      "job_extract",
      `Translate and structure a job posting. Reply with JSON exactly:
{"title":string,"location":string|null,"countries":string[],"workMode":"remote"|"hybrid"|"onsite"|"unknown",
"remoteScope":"remote_global"|"remote_apac"|"remote_restricted"|"onsite"|"unknown","sponsorship":"yes"|"no"|"unknown",
"seniority":"mid"|"early"|"senior"|"lead"|"unknown","salary":string|null,"requirements":string[],
"jdTextEnglish":string (the full description translated to English, nothing left out, language requirements kept),
"translated":boolean,"evidence":[{"quote":string (copied character for character from the ORIGINAL text),"source":"JD","reason":string}]}`,
      input,
    );
  }

  async draftEmail(input: {
    profile: Record<string, unknown>;
    job: Record<string, unknown>;
    sourceText: string;
  }): Promise<{ result: GroundedDraft; usage: LlmUsage }> {
    return this.complete<GroundedDraft>(
      "email_draft",
      `You write a short cold application email (English, 120 to 190 words, plain text, no markdown, no emoji, no em dash) from the candidate to the hiring team.
Reply with JSON exactly: {"subject":string,"whyCompany":string,"body":string,"evidence":[{"quote":string,"source":"JD","reason":string}]}.
Rules, all mandatory:
1. subject: role title + posting reference if the job has one + one concrete hook from the candidate's achievements; 8 to 120 characters.
2. whyCompany: ONE sentence about why this company/role, built only on facts in sourceText; it must appear word for word inside body.
3. evidence: 1 to 3 quotes copied character for character from sourceText that support whyCompany.
4. body must contain: a greeting; whyCompany; 2 or 3 of the candidate's achievements that best match the job requirements, each with its number; the work-status line given in job.workStatus, verbatim;
   the availability line "Availability: <profile.availability or 'available to start within 30 days'>"; the exact posting URL job.url on its own line; a call to action asking for a short 15 minute call; a sign-off with profile.name and profile links that are not empty.
5. Never invent achievements, numbers, company facts, or email addresses. Use only profile and sourceText.`,
      input,
    );
  }

  private async complete<T>(
    purpose: string,
    instruction: string,
    input: unknown,
  ): Promise<{ result: T; usage: LlmUsage }> {
    const apiKey = (await this.credentials.get("OPENAI_API_KEY")) ?? process.env.OPENAI_API_KEY;
    if (!apiKey) throw new ApiError(503, "luna_credentials_missing", "OpenAI API key is not configured.");

    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: instruction },
          { role: "user", content: JSON.stringify(input) },
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: 4_000,
      }),
    });

    if (!response.ok) {
      throw new ApiError(502, "luna_request_failed", `gpt-6-luna request failed with ${response.status}.`);
    }
    const payload = await response.json() as ChatCompletion;
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new ApiError(502, "luna_empty_response", "gpt-6-luna returned no content.");

    const tokensIn = payload.usage?.prompt_tokens ?? 0;
    const tokensOut = payload.usage?.completion_tokens ?? 0;
    const usage: LlmUsage = {
      model: this.model,
      purpose,
      requestId: payload.id ?? crypto.randomUUID(),
      tokensIn,
      tokensOut,
      costUsd:
        (tokensIn / 1_000_000) * this.prices.inputPerMillion +
        (tokensOut / 1_000_000) * this.prices.outputPerMillion,
    };
    return { result: parseJson<T>(content), usage };
  }
}
