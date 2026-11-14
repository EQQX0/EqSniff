import { HTMLAttributes, ReactNode } from "react";

export function Card({
  children,
  className = "",
  ...rest
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div
      className={`rounded-lg border border-border bg-surface p-5 shadow-card ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

/** A "card inside a card" row — same surface token, one more border, no new color. */
export function NestedRow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-md border border-border bg-surface/60 p-4 ${className}`}>{children}</div>
  );
}
