export type { Clock, IdGenerator } from "../../core/ports/runtime";
export type { LunaPort } from "../../core/ports/ai";
export type { Queryable } from "../../core/ports/database";
export type { Settings } from "../../core/domain";
import type { LlmUsage } from "../../core/ports/ai";
export type { LlmUsage };

export type UsageRecorder = {
  record(usage: LlmUsage): Promise<void>;
};

export type ExportProvider = {
  rows(kind: "targets" | "outreach"): Promise<Array<Record<string, unknown>>>;
};
