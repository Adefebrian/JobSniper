import { ApiError } from "../../core/http";
import type { Clock, JevPort } from "./ports";
import { adjustedTier, type Tier } from "./policy";
import { SchedulerRepository, type CrawlTaskRow } from "./repo";

export class SchedulerService {
  constructor(
    private readonly repository: SchedulerRepository,
    private readonly jev: JevPort,
    private readonly clock: Clock,
  ) {}

  async runDueCatchUp(): Promise<Record<string, unknown>> {
    const now = this.clock.now();
    const enqueued = await this.repository.scheduleDue(now);
    return {
      enqueued,
      queue: await this.repository.status(now),
      lastRuns: await this.repository.lastRuns(),
      lastRunsByTier: await this.repository.lastRunsByTier(),
      catchUpBasis: "next_due_at",
    };
  }

  async enqueueDiscovery(input: {
    sourceId: string | null;
    payload: Record<string, unknown>;
    dedupeKey: string;
  }): Promise<boolean> {
    return this.repository.enqueueDiscovery(input);
  }

  async enqueueCrawl(input: {
    sourceId: string | null;
    payload: Record<string, unknown>;
    dedupeKey: string;
  }): Promise<boolean> {
    return this.repository.enqueueCrawl(input);
  }

  async claim(workerId: string, leaseSeconds = 300, limit = 10): Promise<CrawlTaskRow[]> {
    if (!workerId.trim()) throw new ApiError(400, "worker_id_required", "workerId is required.");
    return this.repository.claim(workerId, leaseSeconds, limit);
  }

  async complete(id: string): Promise<void> {
    await this.repository.complete(id);
  }

  async retry(id: string, error: string): Promise<"queued" | "failed"> {
    return this.repository.retry(id, error.slice(0, 4_000), 60);
  }

  async status() {
    const now = this.clock.now();
    return {
      queue: await this.repository.status(now),
      lastRuns: await this.repository.lastRuns(),
      lastRunsByTier: await this.repository.lastRunsByTier(),
    };
  }

  async recommendTier(input: {
    sourceId: string;
    current: Tier;
    relevantJobs: number;
    failures: number;
    successRate: number;
  }): Promise<Tier> {
    const decision = await this.jev.decide({
      decisionId: "crawl_priority",
      subjectType: "source",
      subjectId: input.sourceId,
      input: {
        current: input.current,
        relevantJobs: input.relevantJobs,
        failures: input.failures,
        successRate: input.successRate,
      },
    });
    const fallback = adjustedTier(input);
    const value = Number(decision.verdict.value);
    const tier = value === 1 || value === 2 || value === 3 ? value : fallback;
    await this.repository.setTier(input.sourceId, tier);
    return tier;
  }
}
