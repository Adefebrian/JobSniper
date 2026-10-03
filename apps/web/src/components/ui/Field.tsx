import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

/**
 * Label, control, hint. `row` is the System Settings layout (label and hint on the
 * start edge, control on the end edge); `stack` puts the label above the control.
 */
export function Field({ label, hint, htmlFor, layout = "stack", children, wide = false }: {
  label: ReactNode;
  hint?: ReactNode;
  htmlFor?: string;
  layout?: "stack" | "row";
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`ui-field ui-field--${layout} ${wide ? "is-wide" : ""}`.trim()}>
      <div className="ui-field-text">
        {htmlFor ? <label className="ui-field-label" htmlFor={htmlFor}>{label}</label> : <span className="ui-field-label">{label}</span>}
        {hint ? <span className="ui-field-hint">{hint}</span> : null}
      </div>
      <div className="ui-field-control">{children}</div>
    </div>
  );
}

export const TextInput = ({ className = "", ...rest }: InputHTMLAttributes<HTMLInputElement>) =>
  <input {...rest} className={`ui-control ${className}`.trim()} />;

export const Select = ({ className = "", children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) =>
  <select {...rest} className={`ui-control ui-select ${className}`.trim()}>{children}</select>;

export const TextArea = ({ className = "", ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) =>
  <textarea {...rest} className={`ui-control ui-textarea ${className}`.trim()} />;
