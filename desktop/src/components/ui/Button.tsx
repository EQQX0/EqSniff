import { ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

const VARIANT: Record<Variant, string> = {
  primary:
    "bg-[linear-gradient(135deg,#c43e52,#a82f42)] text-on-accent shadow-[0_8px_22px_rgba(168,47,66,0.38)] hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(209,73,91,0.5)]",
  secondary:
    "border border-border-input bg-white/[0.06] text-text hover:-translate-y-0.5 hover:bg-white/[0.12]",
  ghost: "bg-transparent text-text hover:bg-white/10",
  danger:
    "bg-[linear-gradient(135deg,#b3263a,#8e1f2e)] text-on-accent shadow-[0_8px_22px_rgba(142,31,46,0.38)] hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(179,38,58,0.5)]",
};

const SIZE: Record<Size, string> = {
  sm: "h-8 px-3.5 text-xs",
  md: "h-10 px-5 text-sm",
  lg: "h-12 px-6 text-base",
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = "primary", size = "md", loading, disabled, className = "", children, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-pill font-semibold
        transition-all duration-base ease-brand active:translate-y-0 active:scale-[0.97]
        disabled:opacity-40 disabled:pointer-events-none
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2
        focus-visible:ring-offset-bg ${VARIANT[variant]} ${SIZE[size]} ${className}`}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && (
        <span
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden="true"
        />
      )}
      <span>{children}</span>
    </button>
  );
});
