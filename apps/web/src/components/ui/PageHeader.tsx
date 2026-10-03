import type { ReactNode } from "react";

/**
 * The top bar of every pane: title, an optional quiet count or line, actions on the end edge.
 * 52px tall so it lines up with the window's traffic lights; it is a window drag region in the app.
 */
export function PageHeader({ title, meta, actions, level = 1 }: { title: string; meta?: ReactNode; actions?: ReactNode; level?: 1 | 2 }) {
  const Heading = level === 1 ? "h1" : "h2";
  return (
    <header className="ui-page-header" data-tauri-drag-region>
      <div className="ui-page-title" data-tauri-drag-region>
        <Heading>{title}</Heading>
        {meta !== undefined && meta !== null ? <span className="ui-page-meta tabular">{meta}</span> : null}
      </div>
      {actions ? <div className="ui-page-actions">{actions}</div> : null}
    </header>
  );
}

/** Loading skeleton in the shape of a list of rows. */
export function LoadingRows({ rows = 6, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div className="ui-skeleton" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, index) => <span key={index} className="ui-skeleton-row" />)}
    </div>
  );
}
