import { useEffect, useRef, useState } from "react";
import { easeStandard, prefersReducedMotion } from "../utils.ts";

/** Counts from 0 to the value once, on first show. The box keeps its width. */
export function CountUp({ value, duration = 600 }: { value: number; duration?: number }) {
  const [shown, setShown] = useState(() => prefersReducedMotion() ? value : 0);
  const played = useRef(false);
  useEffect(() => {
    if (played.current || prefersReducedMotion() || typeof requestAnimationFrame !== "function") { setShown(value); return; }
    played.current = true;
    const start = performance.now();
    let frame = 0;
    const tick = (time: number) => {
      const t = Math.min(1, (time - start) / duration);
      setShown(Math.round(value * easeStandard(t)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);
  return <span className="tabular count" style={{ minWidth: `${String(value).length}ch` }}>{shown.toLocaleString("en")}</span>;
}
