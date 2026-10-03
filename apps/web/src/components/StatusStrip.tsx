import { formatAgo } from "../utils.ts";
import type { StatusStrip as StatusData } from "../types.ts";

export function StatusStrip({ status }: { status: StatusData }) {
  const items = [
    { label: "T1 run", value: formatAgo(status.lastRunT1) },
    { label: "T2 run", value: formatAgo(status.lastRunT2) },
    { label: "T3 run", value: formatAgo(status.lastRunT3) },
    { label: "Queue", value: String(status.queueDepth) },
    { label: "LLM spend", value: `$${(status.llmSpendUsd ?? 0).toFixed(2)}` },
    { label: "Blocked", value: String(status.blockedSources), warn: status.blockedSources > 0 },
  ];
  return (
    <section className="status-strip" aria-label="System status">
      <dl>
        {items.map((item) => (
          <div key={item.label} className={item.warn ? "status-item is-warn" : "status-item"}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
