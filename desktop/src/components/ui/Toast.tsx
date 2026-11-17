import { useEffect, useRef, useState } from "react";

interface ToastItem {
  id: number;
  text: string;
  kind: "ok" | "error";
  action?: { label: string; run: () => void };
}

const EVENT = "eqnet-toast";

/**
 * Shows a short confirmation at the bottom of the window. Call it from anywhere, after any action.
 * `action` adds a button (used for Undo). Errors stay a little longer and are announced as alerts.
 */
export function toast(text: string, opts: { kind?: "ok" | "error"; action?: { label: string; run: () => void } } = {}) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { text, kind: opts.kind ?? "ok", action: opts.action } }));
}

/** Mount once near the top of the app. */
export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(0);

  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<Omit<ToastItem, "id">>).detail;
      const id = ++next.current;
      setItems((list) => [...list.slice(-3), { id, ...d }]);
      window.setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), d.action ? 7000 : d.kind === "error" ? 6000 : 3200);
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);

  if (items.length === 0) return null;
  const close = (id: number) => setItems((list) => list.filter((t) => t.id !== id));
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-[70] flex w-[min(92vw,28rem)] -translate-x-1/2 flex-col items-center gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          role={t.kind === "error" ? "alert" : "status"}
          className={`pointer-events-auto flex w-full items-center justify-between gap-3 rounded-pill border px-4 py-2 text-sm shadow-[0_10px_30px_rgba(0,0,0,0.45)] backdrop-blur ${
            t.kind === "error" ? "border-danger/50 bg-[#2a0f14]/95 text-danger" : "border-border-input bg-[#1a0b0f]/95 text-text"
          }`}
        >
          <span className="min-w-0 truncate">{t.text}</span>
          {t.action && (
            <button
              type="button"
              onClick={() => {
                t.action!.run();
                close(t.id);
              }}
              className="shrink-0 rounded-pill px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-accent-soft hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
