import { formatAgo, parseDate } from "../utils.ts";
import type { StatusStrip as StatusData } from "../types.ts";

/** One quiet line for the sidebar: the most recent crawl of any tier. */
export function LastCrawl({ status }: { status: StatusData }) {
  const latest = [status.lastRunT1, status.lastRunT2, status.lastRunT3]
    .map((value) => parseDate(value))
    .filter((value): value is Date => value !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  return <p className="last-crawl">Last crawl {latest ? formatAgo(latest.toISOString()) : "never"}</p>;
}

export function StatusStrip({ status, variant = "strip" }: { status: StatusData; variant?: "strip" | "stack" }) {
  const items = [
    { label: "T1 run", value: formatAgo(status.lastRunT1) },
    { label: "T2 run", value: formatAgo(status.lastRunT2) },
    { label: "T3 run", value: formatAgo(status.lastRunT3) },
    { label: "Queue", value: String(status.queueDepth) },
    { label: "LLM spend", value: `$${(status.llmSpendUsd ?? 0).toFixed(2)}` },
    { label: "Blocked", value: String(status.blockedSources), warn: status.blockedSources > 0 },
  ];
  return (
    <section className={variant === "stack" ? "status-stack" : "status-strip"} aria-label="System status" data-tauri-drag-region>
      <dl data-tauri-drag-region>
        {items.map((item) => (
          <div key={item.label} className={item.warn ? "status-item is-warn" : "status-item"} data-tauri-drag-region>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
