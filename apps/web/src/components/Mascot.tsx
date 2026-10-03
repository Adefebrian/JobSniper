import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "../utils.ts";

export const CHEER_EVENT = "jobsniper:cheer";

/** Ask every listening mascot for one small happy hop (a like, new targets arriving). */
export const cheer = () => window.dispatchEvent(new CustomEvent(CHEER_EVENT));

const PALETTE = {
  light: { body: "#2e9bb5", belly: "#d8f1f6", eye: "#ffffff", pupil: "#1d1d1f", beak: "#ff9500" },
  dark: { body: "#40b4cc", belly: "#cdeef5", eye: "#ffffff", pupil: "#1d1d1f", beak: "#ff9f0a" },
};

const isDark = () => document.documentElement.dataset.shell === "mac"
  && typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;

/** Draws Pip on a 64x64 grid. lid: 0 open, 1 closed. */
function draw(context: CanvasRenderingContext2D, scale: number, pupil: { x: number; y: number }, lid: number) {
  const colors = isDark() ? PALETTE.dark : PALETTE.light;
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.clearRect(0, 0, 64, 64);
  const ellipse = (x: number, y: number, rx: number, ry: number, fill: string) => {
    context.beginPath();
    context.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    context.fillStyle = fill;
    context.fill();
  };
  // ear tufts
  context.fillStyle = colors.body;
  context.beginPath();
  context.moveTo(16, 18); context.lineTo(13, 6); context.lineTo(24, 14); context.closePath();
  context.moveTo(48, 18); context.lineTo(51, 6); context.lineTo(40, 14); context.closePath();
  context.fill();
  ellipse(32, 35, 23, 24, colors.body);
  ellipse(32, 44, 13, 12, colors.belly);
  // lookout eyes, set in light discs like binocular lenses
  for (const cx of [23, 41]) {
    ellipse(cx, 28, 9, 9, colors.eye);
    ellipse(cx + pupil.x, 28.5 + pupil.y, 4, 4, colors.pupil);
    ellipse(cx + 1.5 + pupil.x, 27 + pupil.y, 1.2, 1.2, colors.eye);
    if (lid > 0) {
      // the lid comes down from the top of the eye
      context.save();
      context.beginPath();
      context.arc(cx, 28, 9.4, 0, Math.PI * 2);
      context.clip();
      context.fillStyle = colors.body;
      context.fillRect(cx - 10, 18.6, 20, 18.8 * lid);
      context.restore();
    }
  }
  context.fillStyle = colors.beak;
  context.beginPath();
  context.moveTo(29, 35); context.lineTo(35, 35); context.lineTo(32, 39); context.closePath();
  context.fill();
}

/**
 * Pip, the JobSniper scout: a small round owl with big lookout eyes, drawn on a
 * canvas in flat system colours. Blinks now and then, can follow the pointer a
 * little, hops on cheer(), and dozes when the crawler has been idle. Under
 * reduced motion it is a still picture.
 */
export function Mascot({ size = 72, follow = false, blink = true, sleepy = false, reactive = true, label }: {
  size?: number;
  follow?: boolean;
  blink?: boolean;
  sleepy?: boolean;
  reactive?: boolean;
  label?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const state = useRef({ pupil: { x: 0, y: 0 }, lid: sleepy ? 0.6 : 0 });

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext?.("2d");
    if (!element || !context) return;
    const scale = (size / 64) * (window.devicePixelRatio || 1);
    element.width = Math.round(size * (window.devicePixelRatio || 1));
    element.height = element.width;
    state.current.lid = sleepy ? 0.6 : 0;
    const render = () => draw(context, scale, state.current.pupil, state.current.lid);
    render();
    const reduced = prefersReducedMotion();
    const cleanups: (() => void)[] = [];

    if (blink && !sleepy && !reduced) {
      let timer = 0;
      const schedule = () => {
        timer = window.setTimeout(() => {
          const start = performance.now();
          const step = (time: number) => {
            const t = Math.min(1, (time - start) / 160);
            state.current.lid = t < 0.5 ? t * 2 : (1 - t) * 2;
            render();
            if (t < 1) requestAnimationFrame(step); else { state.current.lid = 0; render(); schedule(); }
          };
          requestAnimationFrame(step);
        }, 4000 + Math.random() * 4000);
      };
      schedule();
      cleanups.push(() => window.clearTimeout(timer));
    }

    if (follow && !reduced) {
      let frame = 0;
      const onMove = (event: PointerEvent) => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          const box = element.getBoundingClientRect();
          const dx = event.clientX - (box.left + box.width / 2);
          const dy = event.clientY - (box.top + box.height / 2);
          const distance = Math.hypot(dx, dy) || 1;
          const reach = Math.min(1, distance / 400) * 2.2;
          state.current.pupil = { x: (dx / distance) * reach, y: (dy / distance) * reach };
          render();
        });
      };
      window.addEventListener("pointermove", onMove);
      cleanups.push(() => { cancelAnimationFrame(frame); window.removeEventListener("pointermove", onMove); });
    }

    const media = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    media?.addEventListener("change", render);
    cleanups.push(() => media?.removeEventListener("change", render));
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [size, follow, blink, sleepy]);

  useEffect(() => {
    if (!reactive) return;
    const hop = () => {
      if (prefersReducedMotion() || !canvas.current?.animate) return;
      canvas.current.animate(
        [{ transform: "translateY(0)" }, { transform: "translateY(-14%)" }, { transform: "translateY(0)" }],
        { duration: 400, easing: "cubic-bezier(0.24, 1, 0.4, 1)" },
      );
    };
    window.addEventListener(CHEER_EVENT, hop);
    return () => window.removeEventListener(CHEER_EVENT, hop);
  }, [reactive]);

  return (
    <canvas ref={canvas} className="mascot" width={size} height={size} style={{ width: size, height: size }}
      role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} />
  );
}
