import type { ReactNode } from "react";
import { Icon } from "../Icon.tsx";

/** Status on a tinted surface with a full hairline, an icon, and a title that names the state. */
export function Notice({ tone = "info", title, children, onClose }: { tone?: "info" | "warning" | "positive" | "negative"; title: string; children?: ReactNode; onClose?: () => void }) {
  return (
    <div className={`ui-notice is-${tone}`} role={tone === "warning" || tone === "negative" ? "alert" : "status"}>
      <Icon name={tone === "positive" ? "check" : "alert"} />
      <div className="ui-notice-text"><strong>{title}</strong>{children ? <span>{children}</span> : null}</div>
      {onClose ? <button type="button" className="ui-icon-button" aria-label="Dismiss" onClick={onClose}><Icon name="close" /></button> : null}
    </div>
  );
}
