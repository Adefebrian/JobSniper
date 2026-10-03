import type { ReactNode } from "react";
import { Mascot } from "../Mascot.tsx";

/** Pip, a title that names the state, one line on how it fills, and at most one action. */
export function EmptyState({ title, description, action, compact = false }: {
  title: string;
  description: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`ui-empty ${compact ? "is-compact" : ""}`.trim()} role="status">
      <Mascot size={compact ? 32 : 56} blink={!compact} reactive={false} />
      <div className="ui-empty-text">
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      {action ? <div className="ui-empty-action">{action}</div> : null}
    </div>
  );
}
