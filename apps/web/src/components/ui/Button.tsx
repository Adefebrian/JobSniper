import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon, Spinner, type IconName } from "../Icon.tsx";

export type ButtonVariant = "primary" | "secondary" | "plain" | "destructive";

interface Common {
  variant?: ButtonVariant;
  icon?: IconName;
  busy?: boolean;
  children?: ReactNode;
  className?: string;
}

type AsButton = Common & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children"> & { href?: undefined };
type AsLink = Common & { href: string; target?: string; rel?: string; download?: string | boolean; onClick?: () => void; "aria-label"?: string };

/** One button for the whole app. A link when it navigates, a button when it acts. */
export function Button(props: AsButton | AsLink) {
  const { variant = "secondary", icon, busy = false, children, className = "" } = props;
  const classes = `ui-button ui-button--${variant} ${className}`.trim();
  const inner = <>{busy ? <Spinner /> : icon ? <Icon name={icon} /> : null}{children ? <span className="ui-button-label">{children}</span> : null}</>;
  if (props.href !== undefined) {
    const { href, target, rel, download, onClick } = props as AsLink;
    return <a className={classes} href={href} target={target} rel={rel} download={download} onClick={onClick} aria-label={(props as AsLink)["aria-label"]}>{inner}</a>;
  }
  const { variant: _v, icon: _i, busy: _b, children: _c, className: _cn, type = "button", disabled, ...rest } = props as AsButton;
  return <button {...rest} type={type} className={classes} disabled={disabled || busy} aria-busy={busy || undefined}>{inner}</button>;
}

/** Square icon-only button. The label is required and becomes the accessible name. */
export function IconButton({ icon, label, pressed, className = "", flip, filled, ...rest }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  icon: IconName;
  label: string;
  pressed?: boolean;
  flip?: boolean;
  filled?: boolean;
}) {
  return (
    <button type="button" {...rest} className={`ui-icon-button ${pressed ? "is-on" : ""} ${className}`.trim()} aria-label={label} aria-pressed={pressed}>
      <Icon name={icon} flip={flip} filled={filled} />
    </button>
  );
}
