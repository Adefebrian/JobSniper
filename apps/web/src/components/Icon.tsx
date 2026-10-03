// Inline SVG glyphs drawn with currentColor. Thumb outline follows the Lucide thumbs-up shape (ISC).
const PATHS = {
  thumb: "M7 10v12M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z",
  mail: "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM22 7l-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7",
  more: "M5 12h.01M12 12h.01M19 12h.01",
} as const;

export function Icon({ name, size = 18, flip = false, filled = false }: { name: keyof typeof PATHS; size?: number; flip?: boolean; filled?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false"
      fill={filled ? "currentColor" : "none"} fillOpacity={filled ? 0.18 : undefined} stroke="currentColor" strokeWidth={name === "more" ? 3 : 1.75} strokeLinecap="round" strokeLinejoin="round"
      style={flip ? { transform: "rotate(180deg)" } : undefined}>
      <path d={PATHS[name]} />
    </svg>
  );
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}
