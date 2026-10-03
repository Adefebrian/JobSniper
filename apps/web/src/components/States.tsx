import type { ReactNode } from "react";
import { Mascot } from "./Mascot.tsx";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="page-header" data-tauri-drag-region>
      <div className="page-header-text">
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

export function LoadingState({ label = "Loading workspace data" }: { label?: string }) {
  return <div className="state-panel" role="status"><strong>{label}</strong><p>Waiting for the local API.</p></div>;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="state-panel" role="alert"><strong>Something needs attention</strong><p>{message}</p>{onRetry ? <button className="button button-secondary" onClick={onRetry}>Retry</button> : null}</div>;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="state-panel state-empty"><Mascot size={40} blink={false} reactive={false} /><div className="state-text"><strong>{title}</strong><p>{description}</p>{action}</div></div>;
}

const NOTICE_TITLES = { info: "Note", warning: "Attention", success: "Done" } as const;

export function Notice({ tone = "info", title, children }: { tone?: "info" | "warning" | "success"; title?: string; children: ReactNode }) {
  return (
    <div className={`notice notice-${tone}`} role={tone === "warning" ? "alert" : "status"}>
      <strong>{title ?? NOTICE_TITLES[tone]}</strong>
      <span>{children}</span>
    </div>
  );
}
