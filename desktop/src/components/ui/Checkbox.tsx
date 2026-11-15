import { InputHTMLAttributes } from "react";

/** Tick box: the box fills, the tick draws itself, and a ring pulses out. Keeps a real checkbox underneath. */
export function Checkbox({ className = "", ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return (
    <span className={`tick ${className}`}>
      <input type="checkbox" {...rest} />
      <span className="tick-box" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3.5 8.6l3.1 3.1 6-7.2" />
        </svg>
      </span>
    </span>
  );
}
