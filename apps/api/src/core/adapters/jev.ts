import { ApiError } from "../http";
import type { JevDecision, JevPort } from "../ports/ai";

export class JevClient implements JevPort {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
  ) {}

  async decide(input: Parameters<JevPort["decide"]>[0]): Promise<JevDecision> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/decide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: this.model, ...input }),
    });
    if (!response.ok) {
      throw new ApiError(503, "jev_unavailable", `Jev request failed with ${response.status}.`);
    }
    const payload = await response.json() as Partial<JevDecision>;
    if (
      !payload.verdict ||
      typeof payload.confidence !== "number" ||
      payload.confidence < 0 ||
      payload.confidence > 1
    ) {
      throw new ApiError(502, "jev_invalid_response", "Jev returned an invalid decision.");
    }
    return {
      decisionId: input.decisionId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      input: input.input,
      verdict: payload.verdict,
      confidence: payload.confidence,
    };
  }
}
