export function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  const atLimit = value >= max;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted">{label}</span>
        <span className={atLimit ? "font-medium text-danger" : "font-medium text-text"}>
          {value} / {max}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label}
        className="h-2 w-full overflow-hidden rounded-pill bg-white/10"
      >
        <div
          className={`h-full rounded-pill transition-[width] duration-slow ease-brand ${atLimit ? "bg-danger-solid" : "bg-[linear-gradient(90deg,#a82f42,#d1495b,#f59e0b)] shadow-[0_0_14px_rgba(209,73,91,0.6)]"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
