import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/** A trigger that opens an anchored panel. Closes on outside click, Escape, or close(). */
export function Popover({ trigger, label, align = "start", children, panelClassName = "" }: {
  trigger: (props: { onClick: () => void; "aria-expanded": boolean; "aria-controls": string; "aria-label": string }) => ReactNode;
  label: string;
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
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <div className="ui-popover" ref={root}>
      {trigger({ onClick: () => setOpen((value) => !value), "aria-expanded": open, "aria-controls": id, "aria-label": label })}
      {open ? <div id={id} className={`ui-popover-panel is-${align} ${panelClassName}`.trim()}>{children(() => setOpen(false))}</div> : null}
    </div>
  );
}

export function MenuItem({ children, onClick, danger = false, disabled = false }: { children: ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return <button type="button" role="menuitem" className={`ui-menu-item ${danger ? "is-danger" : ""}`.trim()} disabled={disabled} onClick={onClick}>{children}</button>;
}
