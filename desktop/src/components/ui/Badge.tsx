import { ReactNode } from "react";

type Tone = "neutral" | "accent" | "danger-soft" | "success";

const TONE: Record<Tone, string> = {
  neutral: "bg-white/[0.07] border border-border text-muted",
  accent: "bg-accent/20 border border-accent/40 text-accent-soft",
  "danger-soft": "bg-danger-solid/30 border border-danger/40 text-danger",
  success: "bg-success/15 border border-success/35 text-success",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-pill px-2.5 py-0.5 text-xs font-medium ${TONE[tone]}`}>
      {children}
    </span>
  );
}
