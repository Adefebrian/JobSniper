import type { ReactNode } from "react";

export type BadgeTone = "neutral" | "accent" | "positive" | "warning" | "negative";

/** Short status word on a tinted chip. Colour is never the only signal: the word carries it. */
export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`ui-badge is-${tone}`}>{children}</span>;
}
