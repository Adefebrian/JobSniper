import { initials, monogramTint } from "../../utils.ts";

/** Company initials on a tinted rounded square. Sizes: 24 (table), 32 (rows), 40 (detail). */
export function Monogram({ name, size = 32 }: { name: string; size?: 24 | 32 | 40 }) {
  return (
    <span className={`ui-monogram is-${size}`} aria-hidden="true" style={{ background: monogramTint(name) }}>
      {initials(name)}
    </span>
  );
}
