import { useId } from "react";

/** A switch with its label on the start edge. */
export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  const id = useId();
  return (
    <div className="ui-toggle">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="checkbox" role="switch" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </div>
  );
}
