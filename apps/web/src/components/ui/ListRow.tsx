import type { ReactNode } from "react";

/** Leading visual, a title line, a subtitle line, a trailing value. A link, a button, or static. */
export function ListRow({ leading, title, subtitle, trailing, href, onClick, active = false, className = "" }: {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  href?: string;
  onClick?: () => void;
  active?: boolean;
  className?: string;
}) {
  const classes = `ui-row ${active ? "is-active" : ""} ${href || onClick ? "is-interactive" : ""} ${className}`.trim();
  const body = (
    <>
      {leading ? <span className="ui-row-leading">{leading}</span> : null}
      <span className="ui-row-text">
        <span className="ui-row-title">{title}</span>
        {subtitle ? <span className="ui-row-subtitle">{subtitle}</span> : null}
      </span>
      {trailing !== undefined && trailing !== null ? <span className="ui-row-trailing">{trailing}</span> : null}
    </>
  );
  if (href) return <a className={classes} href={href} aria-current={active ? "true" : undefined}>{body}</a>;
  if (onClick) return <button type="button" className={classes} onClick={onClick} aria-pressed={active}>{body}</button>;
  return <div className={classes}>{body}</div>;
}

/** Meta parts joined with a middle dot; each part keeps its words together and wraps as a whole. */
export function Meta({ parts }: { parts: (ReactNode | null | false | undefined)[] }) {
  const shown = parts.filter((part) => part !== null && part !== false && part !== undefined && part !== "");
  return (
    <span className="ui-meta">
      {shown.map((part, index) => <span key={index} className="ui-meta-part">{part}</span>)}
    </span>
  );
}
