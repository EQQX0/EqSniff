"use client";

import { useState } from "react";

export function Switch({
  defaultChecked = false,
  checked: controlled,
  label,
  disabled = false,
  onChange,
}: {
  defaultChecked?: boolean;
  /** When given, the parent owns the state. */
  checked?: boolean;
  label: string;
  disabled?: boolean;
  onChange?: (checked: boolean) => void;
}) {
  const [internal, setInternal] = useState(defaultChecked);
  const checked = controlled ?? internal;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        const next = !checked;
        setInternal(next);
        onChange?.(next);
      }}
      className={`relative h-6 w-11 shrink-0 rounded-pill transition-colors duration-fast
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2
        focus-visible:ring-offset-bg disabled:opacity-50 disabled:pointer-events-none ${checked ? "bg-accent" : "bg-surface border border-border-input"}`}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-pill bg-on-accent transition-transform duration-fast
          ${checked ? "translate-x-5" : "translate-x-0"}`}
      />
    </button>
  );
}
