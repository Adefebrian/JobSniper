import { initials, monogramTint } from "../utils.ts";

/** Company monogram: a rounded square with white initials, tint picked from the name. */
export function Monogram({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <span className="monogram" aria-hidden="true" style={{ width: size, height: size, background: monogramTint(name), fontSize: Math.round(size * 0.4), borderRadius: Math.round(size * 0.28) }}>
      {initials(name)}
    </span>
  );
}
