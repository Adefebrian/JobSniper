export type { Clock, IdGenerator } from "../../core/ports/runtime";
export type { JevPort } from "../../core/ports/ai";
export type { Queryable } from "../../core/ports/database";

export type CrawlEnqueuer = {
  enqueueDiscovery(input: {
    sourceId: string | null;
    payload: Record<string, unknown>;
    dedupeKey: string;
  }): Promise<boolean>;
  enqueueCrawl?(input: {
    sourceId: string | null;
    payload: Record<string, unknown>;
    dedupeKey: string;
  }): Promise<boolean>;
};

export type DashboardDependencies = {
  schedulerStatus(): Promise<Record<string, unknown>>;
  brainStatus(): Promise<Record<string, number>>;
  outreachStatus(): Promise<Record<string, number>>;
  monthlyLlmSpend(): Promise<number>;
};
