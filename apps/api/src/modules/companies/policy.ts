export type YieldStats = {
  itemsSeen: number;
  relevantJobs: number;
  duplicateJobs: number;
  failures: number;
  firstYieldAt?: string | null;
  lastYieldAt: string | null;
};

export function sourceYieldAction(
  stats: YieldStats,
  settings: { minRelevantPer100: number; maxDuplicateRatio: number; observationDays: number },
  now = new Date(),
  startedAt?: Date,
): "active" | "paused" {
  if (stats.itemsSeen < 100) return "active";
  const start = startedAt ?? (stats.firstYieldAt ? new Date(stats.firstYieldAt) : new Date(stats.lastYieldAt ?? now));
  if (now.getTime() - start.getTime() < settings.observationDays * 86_400_000) return "active";
  const relevantPer100 = (stats.relevantJobs / stats.itemsSeen) * 100;
  const duplicateRatio = stats.itemsSeen === 0 ? 0 : stats.duplicateJobs / stats.itemsSeen;
  return relevantPer100 < settings.minRelevantPer100 || duplicateRatio > settings.maxDuplicateRatio
    ? "paused"
    : "active";
}

export function updateYieldStats(current: YieldStats, input: {
  items?: number;
  relevant?: number;
  duplicate?: boolean;
  failed?: boolean;
  at: Date;
}): YieldStats {
  return {
    itemsSeen: current.itemsSeen + (input.items ?? 1),
    relevantJobs: current.relevantJobs + (input.relevant ?? 0),
    duplicateJobs: current.duplicateJobs + (input.duplicate ? 1 : 0),
    failures: current.failures + (input.failed ? 1 : 0),
    firstYieldAt: current.firstYieldAt ?? input.at.toISOString(),
    lastYieldAt: input.at.toISOString(),
  };
}
