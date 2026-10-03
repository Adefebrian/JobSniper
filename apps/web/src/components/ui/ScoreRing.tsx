import { useEffect, useState } from "react";

/** Match score as a ring filled to the score, the number centred. Fills once on mount when `animate`. */
export function ScoreRing({ score, size = 28, animate = false }: { score: number; size?: 28 | 40 | 64 | 96; animate?: boolean }) {
  const [shown, setShown] = useState(animate ? 0 : score);
  useEffect(() => {
    if (!animate) { setShown(score); return; }
    const frame = requestAnimationFrame(() => setShown(score));
    return () => cancelAnimationFrame(frame);
  }, [score, animate]);
  const stroke = size >= 64 ? 6 : size >= 40 ? 4 : 3;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const value = Math.max(0, Math.min(100, shown));
  return (
    <span className={`ui-ring is-${size}`} role="img" aria-label={`Match score ${score} of 100`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="ui-ring-track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} fill="none" />
        <circle className="ui-ring-value" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} fill="none"
          strokeDasharray={circumference} strokeDashoffset={circumference * (1 - value / 100)} strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <span className="ui-ring-number tabular">{score}</span>
    </span>
  );
}

/** Progress toward a goal on the same ring, "3 of 10" in the centre. */
export function GoalRing({ value, goal }: { value: number; goal: number }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(value));
    return () => cancelAnimationFrame(frame);
  }, [value]);
  const size = 96;
  const stroke = 8;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const ratio = goal > 0 ? Math.min(1, shown / goal) : 0;
  return (
    <span className="ui-ring ui-goal-ring is-96" role="img" aria-label={`${value} of ${goal} applications this week`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="ui-ring-track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} fill="none" />
        <circle className="ui-ring-value" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} fill="none"
          strokeDasharray={circumference} strokeDashoffset={circumference * (1 - ratio)} strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <span className="ui-ring-number tabular"><span>{value}<span className="ui-ring-of">/{goal}</span></span></span>
    </span>
  );
}
