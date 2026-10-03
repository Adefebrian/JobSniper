import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/** A button that opens an anchored panel. Closes on outside click, Escape, or when a child calls close(). */
export function Popover({ label, buttonClassName, buttonContent, align = "start", panelClassName = "", children }: {
  label: string;
  buttonClassName: string;
  buttonContent: ReactNode;
  align?: "start" | "end";
  panelClassName?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => { if (root.current && !root.current.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="popover" ref={root}>
      <button type="button" className={`${buttonClassName} ${open ? "is-on" : ""}`} aria-label={label} aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)}>
        {buttonContent}
      </button>
      {open ? <div id={id} className={`popover-panel popover-${align} ${panelClassName}`}>{children(() => setOpen(false))}</div> : null}
    </div>
  );
}
