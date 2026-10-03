import type { ReactNode } from "react";
import { CountUp } from "../CountUp.tsx";

/** A number with its label underneath and an optional quiet delta or context line. */
export function Stat({ value, label, delta, suffix, size = "md", tone }: {
  value: number | string;
  label: string;
  delta?: ReactNode;
  suffix?: string;
  size?: "md" | "lg";
  tone?: "warning" | "negative" | undefined;
}) {
  return (
    <div className={`ui-stat ui-stat--${size} ${tone ? `is-${tone}` : ""}`.trim()}>
      <span className="ui-stat-value tabular">{typeof value === "number" ? <CountUp value={value} /> : value}{suffix ? <span className="ui-stat-suffix">{suffix}</span> : null}</span>
      <span className="ui-stat-label">{label}</span>
      {delta ? <span className="ui-stat-delta">{delta}</span> : null}
    </div>
  );
}
