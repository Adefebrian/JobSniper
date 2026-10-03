import { useId } from "react";
import { Icon } from "../Icon.tsx";

/** Search input with a reserved icon lane. */
export function SearchField({ value, onChange, label, placeholder = "Search", className = "" }: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={`ui-search ${className}`.trim()}>
      <label className="sr-only" htmlFor={id}>{label}</label>
      <Icon name="search" />
      <input id={id} className="ui-control" type="search" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}
