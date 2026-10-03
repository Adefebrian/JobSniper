import type { JevDecision } from "./ai";

export interface DecisionRecorder {
  record(decision: JevDecision): Promise<void>;
}
