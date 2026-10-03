import { useEffect, useState } from "react";
import { scoreBand } from "../utils.ts";

/** Score as a small ring that fills once on mount. Number centred, band coloured. */
export function ScoreRing({ score, size = 22, animate = false }: { score: number; size?: number; animate?: boolean }) {
  const [shown, setShown] = useState(animate ? 0 : score);
  useEffect(() => {
    if (!animate) { setShown(score); return; }
    const frame = requestAnimationFrame(() => setShown(score));
    return () => cancelAnimationFrame(frame);
  }, [score, animate]);
  const stroke = size >= 40 ? 3.5 : 2.5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const value = Math.max(0, Math.min(100, shown));
  return (
    <span className={`score-ring band-${scoreBand(score)} ${size >= 40 ? "is-large" : ""}`} style={{ width: size, height: size }} role="img" aria-label={`Score ${score} of 100`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="ring-track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} fill="none" />
        <circle className="ring-value" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} fill="none"
          strokeDasharray={circumference} strokeDashoffset={circumference * (1 - value / 100)} strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <span className="ring-number tabular">{score}</span>
    </span>
  );
}
