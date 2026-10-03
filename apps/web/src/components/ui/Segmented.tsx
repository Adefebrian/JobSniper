export interface SegmentOption<T extends string> { value: T; label: string; count?: number }

/** A row of mutually exclusive choices on one track. `tabs` switches the role to tabs. */
export function Segmented<T extends string>({ options, value, onChange, label, tabs = false, full = false }: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  tabs?: boolean;
  full?: boolean;
}) {
  return (
    <div className={`ui-segmented ${full ? "is-full" : ""}`} role={tabs ? "tablist" : "radiogroup"} aria-label={label}>
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button key={option.value} type="button" role={tabs ? "tab" : "radio"} aria-selected={tabs ? on : undefined} aria-checked={tabs ? undefined : on}
            className={on ? "is-on" : undefined} onClick={() => onChange(option.value)}>
            <span>{option.label}</span>
            {option.count !== undefined ? <span className="ui-segmented-count tabular">{option.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
