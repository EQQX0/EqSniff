import { ReactNode } from "react";

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="anim-fade flex flex-col items-center gap-4 rounded-lg border border-dashed border-border py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-pill bg-white/[0.08] text-accent-soft shadow-[0_0_30px_rgba(209,73,91,0.25)]" aria-hidden="true">
        {icon}
      </div>
      <div className="space-y-1">
        <p className="text-lg font-semibold text-text">{title}</p>
        <p className="mx-auto max-w-sm text-sm text-muted">{body}</p>
      </div>
      {action}
    </div>
  );
}
