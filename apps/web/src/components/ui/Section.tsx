import type { ReactNode } from "react";

/** Title, optional quiet description and end action, then the body. One header style everywhere. */
export function Section({ title, description, action, children, className = "", id }: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section className={`ui-section ${className}`.trim()} aria-labelledby={id ? `${id}-title` : undefined}>
      <header className="ui-section-head">
        <div className="ui-section-text">
          <h2 id={id ? `${id}-title` : undefined}>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {action ? <div className="ui-section-action">{action}</div> : null}
      </header>
      {children}
    </section>
  );
}
