import type { ReactNode } from "react";

/**
 * The one surface panel. `title` gives it the Section header style inside;
 * `flush` drops the padding for edge-to-edge rows.
 */
export function Card({ title, action, children, className = "", flush = false, as: Tag = "section", label }: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  flush?: boolean;
  as?: "section" | "div" | "article";
  label?: string;
}) {
  return (
    <Tag className={`ui-card ${flush ? "is-flush" : ""} ${className}`.trim()} aria-label={title ? undefined : label}>
      {title ? (
        <header className="ui-card-head">
          <h2>{title}</h2>
          {action ? <div className="ui-card-action">{action}</div> : null}
        </header>
      ) : null}
      {children}
    </Tag>
  );
}
