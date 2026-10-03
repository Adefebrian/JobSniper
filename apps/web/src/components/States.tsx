import type { ReactNode } from "react";

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

export function LoadingState({ label = "Loading workspace data" }: { label?: string }) {
  return <div className="state-panel state-loading" role="status"><span className="loader" aria-hidden="true" /><div><strong>{label}</strong><p>Waiting for the local API.</p></div></div>;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="state-panel state-error" role="alert"><div><strong>Something needs attention</strong><p>{message}</p></div>{onRetry ? <button className="button button-secondary" onClick={onRetry}>Retry</button> : null}</div>;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="state-panel state-empty"><div><strong>{title}</strong><p>{description}</p></div>{action}</div>;
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warning" | "success"; children: ReactNode }) {
  return <div className={`notice notice-${tone}`}><span>{children}</span></div>;
}
