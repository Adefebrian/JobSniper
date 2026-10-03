export type Tier = 1 | 2 | 3;

export const TIER_HOURS: Record<Tier, number> = {
  1: 1,
  2: 3,
  3: 24,
};

export const CLOSED_CHECK_HOURS = 12;

export function nextDue(now: Date, tier: Tier, kind: "crawl" | "closed_check" = "crawl"): Date {
  const hours = kind === "closed_check" ? CLOSED_CHECK_HOURS : TIER_HOURS[tier];
  return new Date(now.getTime() + hours * 60 * 60 * 1_000);
}

export function queuePriority(tier: Tier, kind: "discover" | "crawl" | "closed_check"): number {
  const base = tier === 1 ? 100 : tier === 2 ? 60 : 20;
  return kind === "closed_check" ? Math.max(1, base - 10) : base;
}

export function catchUpOrder(tiers: Tier[]): Tier[] {
  return [...tiers].sort((left, right) => left - right);
}

export function adjustedTier(input: {
  current: Tier;
  relevantJobs: number;
  failures: number;
  successRate: number;
}): Tier {
  if (input.relevantJobs > 0 && input.successRate >= 0.9 && input.failures === 0) {
    return input.current === 3 ? 2 : 1;
  }
  if (input.failures >= 3 || input.successRate < 0.5) {
    return input.current === 1 ? 2 : 3;
  }
  return input.current;
}

export function retryBackoffSeconds(attempts: number, baseSeconds = 60, maxSeconds = 86_400): number {
  return Math.min(maxSeconds, baseSeconds * (2 ** Math.max(1, attempts)));
}
