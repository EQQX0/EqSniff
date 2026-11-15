import { HTMLAttributes, ReactNode } from "react";

export function Card({
  children,
  className = "",
  lift = false,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode; lift?: boolean }) {
  return (
    <div className={`glass ${lift ? "lift" : ""} rounded-lg p-5 ${className}`} {...rest}>
      {children}
    </div>
  );
}

/** A row inside a card: lighter tint, no blur, no lift. */
export function NestedRow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-md border border-border bg-white/[0.04] p-4 ${className}`}>{children}</div>
  );
}
