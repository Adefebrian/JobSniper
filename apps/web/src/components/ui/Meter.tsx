import type React from "react";
import type { CSSProperties } from "react";

/** A thin horizontal bar for a share of a whole. Draws in once from the start edge. */
export function Meter({ value, max = 100, tone = "accent", label, index = 0 }: {
  value: number;
  max?: number;
  tone?: "accent" | "neutral" | "positive" | "warning";
  label?: string;
  index?: number;
}) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <span className={`ui-meter is-${tone}`} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}
      style={{ "--i": index } as CSSProperties}>
      <span className="ui-meter-fill" style={{ transform: `scaleX(${ratio})` }} />
    </span>
  );
}

/** Label and value on one line, the meter underneath. The one bar-row used for every breakdown. */
export function MeterRow({ label, value, display, max = 100, tone = "accent", aside, index = 0 }: {
  label: React.ReactNode;
  value: number;
  display?: React.ReactNode;
  max?: number;
  tone?: "accent" | "neutral" | "positive" | "warning";
  aside?: React.ReactNode;
  index?: number;
}) {
  return (
    <li className="ui-meter-row">
      <span className="ui-meter-row-label">{label}{aside ? <span className="ui-meter-row-aside">{aside}</span> : null}</span>
      <span className="ui-meter-row-value tabular">{display ?? value}</span>
      <Meter value={value} max={max} tone={tone} index={index} />
    </li>
  );
}
