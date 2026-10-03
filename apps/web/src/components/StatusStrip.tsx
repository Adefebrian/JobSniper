import { formatAge } from "../utils.ts";
import type { StatusStrip } from "../types.ts";

export function StatusStrip({ status }: { status: StatusStrip }) {
  return (
    <section className="status-strip" aria-label="System status">
      <div className="status-item">
        <span className="status-label">T1 last run</span>
        <strong>{formatAge(status.lastRunT1)} ago</strong>
      </div>
      <div className="status-item">
        <span className="status-label">T2 last run</span>
        <strong>{formatAge(status.lastRunT2)} ago</strong>
      </div>
      <div className="status-item">
        <span className="status-label">T3 last run</span>
        <strong>{formatAge(status.lastRunT3)} ago</strong>
      </div>
      <div className="status-item">
        <span className="status-label">Queue</span>
        <strong>{status.queueDepth} tasks</strong>
      </div>
      <div className="status-item">
        <span className="status-label">LLM spend</span>
        <strong>${status.llmSpendUsd.toFixed(2)}</strong>
      </div>
      <div className="status-item status-warning">
        <span className="status-label">Blocked sources</span>
        <strong>{status.blockedSources}</strong>
      </div>
    </section>
  );
}
