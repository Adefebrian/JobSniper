import { createHash } from "node:crypto";
import type { JevAnswer, JevDecision, JevPort, JevQuestion } from "../ports/ai";
import type { DecisionRecorder } from "../ports/decisions";
import type { Queryable } from "../ports/database";
import type { IdGenerator } from "../ports/runtime";

function inputDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export class PostgresDecisionRecorder implements DecisionRecorder {
  constructor(
    private readonly database: Queryable,
    private readonly ids: IdGenerator,
  ) {}

  async record(decision: JevDecision): Promise<void> {
    await this.database.query(
      `INSERT INTO decisions
       (id, decision_id, subject_type, subject_id, input_digest, input, verdict, confidence)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)`,
      [
        this.ids.newId(),
        decision.decisionId,
        decision.subjectType,
        decision.subjectId,
        inputDigest(decision.input),
        JSON.stringify(decision.input),
        JSON.stringify(decision.verdict),
        decision.confidence,
      ],
    );
  }
}

export class RecordingJev implements JevPort {
  constructor(
    private readonly delegate: JevPort,
    private readonly recorder: DecisionRecorder,
  ) {}

  async ask(state: unknown, questions: Record<string, JevQuestion>): Promise<Record<string, JevAnswer>> {
    if (!this.delegate.ask) throw new Error("Jev delegate cannot ask");
    return this.delegate.ask(state, questions);
  }

  async decide(input: Parameters<JevPort["decide"]>[0]): Promise<JevDecision> {
    const decision = await this.delegate.decide(input);
    await this.recorder.record(decision);
    return decision;
  }
}
