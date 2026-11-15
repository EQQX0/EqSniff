import { ReactNode, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDownIcon } from "@/components/ui/icons";

export interface SelectOption {
  value: string;
  label: string;
  /** Small muted line under the name (a description or an IP address). */
  description?: string;
  /** Short tag at the right, for example "Not connected" or "Virtual". */
  tags?: string[];
  disabled?: boolean;
}

interface Props {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  hint?: ReactNode;
}

/**
 * Accessible single-select list (select-only combobox pattern).
 * Focus stays on the button; the arrow keys move the highlighted row, Enter picks it, Esc closes,
 * letters jump to the next row that starts with them.
 */
export function Select({ label, value, options, onChange, placeholder = "Choose", disabled, hint }: Props) {
  const uid = useId();
  const btnId = `${uid}-btn`;
  const listId = `${uid}-list`;
  const labelId = `${uid}-label`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [up, setUp] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: "", at: 0 });

  const selected = useMemo(() => options.find((o) => o.value === value), [options, value]);
  const enabled = useMemo(() => options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0), [options]);

  function openList() {
    if (disabled) return;
    const i = options.findIndex((o) => o.value === value && !o.disabled);
    setActive(i >= 0 ? i : (enabled[0] ?? -1));
    setOpen(true);
  }

  function close(refocus = true) {
    setOpen(false);
    if (refocus) btn.current?.focus();
  }

  function pick(i: number) {
    const o = options[i];
    if (!o || o.disabled) return;
    onChange(o.value);
    close();
  }

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  // Open upward when there is not enough room below.
  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    setUp(window.innerHeight - r.bottom < 280 && r.top > window.innerHeight - r.bottom);
  }, [open]);

  // Keep the highlighted row in view.
  useEffect(() => {
    if (!open || active < 0) return;
    document.getElementById(`${uid}-o${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [open, active, uid]);

  function move(dir: 1 | -1) {
    if (!enabled.length) return;
    const pos = enabled.indexOf(active);
    const next = pos < 0 ? (dir === 1 ? 0 : enabled.length - 1) : Math.min(enabled.length - 1, Math.max(0, pos + dir));
    setActive(enabled[next]);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        openList();
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        move(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        move(-1);
        break;
      case "Home":
        e.preventDefault();
        if (enabled.length) setActive(enabled[0]);
        break;
      case "End":
        e.preventDefault();
        if (enabled.length) setActive(enabled[enabled.length - 1]);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        pick(active);
        break;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        close();
        break;
      case "Tab":
        setOpen(false);
        break;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const now = Date.now();
          const t = typed.current;
          t.text = now - t.at > 700 ? e.key.toLowerCase() : t.text + e.key.toLowerCase();
          t.at = now;
          const from = enabled.indexOf(active);
          const order = [...enabled.slice(from + 1), ...enabled.slice(0, from + 1)];
          // A repeated single letter cycles; a longer word searches from the current row.
          const hit = order.find((i) => options[i].label.toLowerCase().startsWith(t.text));
          if (hit !== undefined) setActive(hit);
        }
    }
  }

  return (
    <div ref={root} className="relative flex flex-col gap-1.5">
      <span id={labelId} className="text-sm font-medium text-text">
        {label}
      </span>
      <button
        ref={btn}
        id={btnId}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-labelledby={`${labelId} ${btnId}`}
        aria-activedescendant={open && active >= 0 ? `${uid}-o${active}` : undefined}
        disabled={disabled}
        onClick={() => (open ? close(false) : openList())}
        onKeyDown={onKeyDown}
        className="flex min-h-11 w-full items-center gap-2 rounded-md border border-border-input bg-black/25 px-3 py-1.5 text-left text-sm text-text transition-colors duration-base ease-brand hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft disabled:pointer-events-none disabled:opacity-50"
      >
        <span className="min-w-0 flex-1">
          {selected ? (
            <>
              <span className="block truncate">{selected.label}</span>
              {selected.description && <span className="block truncate text-xs text-muted">{selected.description}</span>}
            </>
          ) : (
            <span className="text-muted">{placeholder}</span>
          )}
        </span>
        <ChevronDownIcon className={`h-4 w-4 shrink-0 text-muted transition-transform duration-base ease-brand ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <ul
          ref={list}
          id={listId}
          role="listbox"
          aria-labelledby={labelId}
          tabIndex={-1}
          className={`glass-strong anim-pop absolute left-0 right-0 z-30 max-h-64 overflow-y-auto rounded-md p-1 ${up ? "bottom-full mb-1" : "top-full mt-1"}`}
        >
          {options.length === 0 && <li className="px-3 py-2 text-sm text-muted">Nothing to choose from.</li>}
          {options.map((o, i) => {
            const isSel = o.value === value;
            const isAct = i === active;
            return (
              <li
                key={o.value}
                id={`${uid}-o${i}`}
                role="option"
                aria-selected={isSel}
                aria-disabled={o.disabled || undefined}
                onMouseEnter={() => !o.disabled && setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(i)}
                className={`flex cursor-pointer items-center gap-2 rounded-sm px-3 py-2 text-sm ${
                  o.disabled ? "cursor-not-allowed opacity-45" : ""
                } ${isSel ? "bg-accent text-on-accent" : isAct ? "bg-white/[0.12] text-text" : "text-text"}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{o.label}</span>
                  {o.description && (
                    <span className={`block truncate text-xs ${isSel ? "text-on-accent/80" : "text-muted"}`}>{o.description}</span>
                  )}
                </span>
                {o.tags?.map((t) => (
                  <span
                    key={t}
                    className={`shrink-0 rounded-pill border px-2 py-0.5 text-[11px] ${
                      isSel ? "border-on-accent/40 text-on-accent/90" : "border-border text-muted"
                    }`}
                  >
                    {t}
                  </span>
                ))}
              </li>
            );
          })}
        </ul>
      )}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}
