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
      "Extract a complete editable candidate profile from the CV. Return JSON with profile and sourceText. Preserve factual claims and numeric achievements.",
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
      `Extract structured job data. Translate the JD to English when needed. Return evidence as exact quotes copied from the source. Use only the allowed enum values for workMode, remoteScope, sponsorship, and seniority.`,
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
      "Draft a concise English application. Every company claim in whyCompany and the body must be supported by an exact source quote in evidence. Do not invent facts, email addresses, or achievements.",
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
