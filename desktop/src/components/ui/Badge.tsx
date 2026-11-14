import { ReactNode } from "react";

type Tone = "neutral" | "accent" | "danger-soft" | "success";

const TONE: Record<Tone, string> = {
  neutral: "bg-surface border border-border text-muted",
  accent: "bg-accent/15 border border-accent/30 text-accent",
  "danger-soft": "bg-danger/15 border border-danger/30 text-danger",
  success: "bg-success/15 border border-success/30 text-success",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-pill px-2.5 py-0.5 text-xs font-medium ${TONE[tone]}`}>
      {children}
    </span>
  );
}
