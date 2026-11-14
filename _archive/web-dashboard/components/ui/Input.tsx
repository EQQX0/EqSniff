import { InputHTMLAttributes, forwardRef, useId } from "react";

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hideLabel?: boolean;
  error?: string;
  hint?: string;
}

export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  { label, hideLabel, error, hint, id, className = "", ...rest },
  ref
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className={hideLabel ? "sr-only" : "text-sm font-medium text-text"}>
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={!!error || undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
        className={`h-10 rounded-md border bg-surface px-3 text-sm text-text placeholder:text-muted
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent
          disabled:opacity-50
          ${error ? "border-danger" : "border-border-input"} ${className}`}
        {...rest}
      />
      {hint && !error && (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
});
