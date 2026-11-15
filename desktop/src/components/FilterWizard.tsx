import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  DIRECTIONS,
  PROTOCOLS,
  describe,
  normalizeHex,
  parsePorts,
  problems,
  splitList,
  type Direction,
  type Filter,
  type Mode,
  type Proto,
} from "@/lib/filters";

const selectClass =
  "h-10 w-full rounded-pill border border-border-input bg-white/[0.06] px-4 text-sm text-text transition-all duration-base ease-brand hover:bg-white/[0.09] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft";

interface ChipProps {
  label: string;
  hint: string;
  placeholder: string;
  /** The saved text: items separated by commas. */
  value: string;
  onChange: (v: string) => void;
  /** Returns a plain-language problem for an item, or null when it is fine. */
  check: (item: string) => string | null;
  /** Tidies an item before it is added, such as capitals for country codes. */
  tidy?: (item: string) => string;
}

/** A box that collects several values: type one, press Enter or Add, and it becomes a chip you can remove. */
function ChipField({ label, hint, placeholder, value, onChange, check, tidy }: ChipProps) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const items = splitList(value);

  function add() {
    const parts = text.split(",").map((t) => t.trim()).filter(Boolean);
    if (parts.length === 0) return;
    const next = [...items];
    for (const raw of parts) {
      const item = tidy ? tidy(raw) : raw;
      const bad = check(item);
      if (bad) return setError(bad);
      if (!next.includes(item)) next.push(item);
    }
    onChange(next.join(", "));
    setText("");
    setError(null);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Input
            label={label}
            value={text}
            placeholder={placeholder}
            error={error ?? undefined}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
        </div>
        <Button type="button" variant="ghost" onClick={add} disabled={text.trim() === ""} aria-label={`Add to ${label}`} className="mb-0.5">
          Add
        </Button>
      </div>
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
      {items.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={`${label} in this filter`}>
          {items.map((it) => (
            <li key={it} className="inline-flex items-center gap-1.5 rounded-pill border border-border bg-white/[0.06] py-0.5 pl-3 pr-1 text-xs text-text">
              <span className="font-mono">{it}</span>
              <button
                type="button"
                aria-label={`Remove ${it}`}
                onClick={() => onChange(items.filter((x) => x !== it).join(", "))}
                className="rounded-full px-1.5 text-muted hover:bg-white/10 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const checkAddress = (a: string) => {
  const fake: Filter = { ...EMPTY, name: "x", address: a };
  return problems(fake).address ?? null;
};
const EMPTY: Filter = {
  id: "", name: "", enabled: false, mode: "show", protocol: "any", direction: "any", port: "", address: "", minBytes: "", maxBytes: "", hex: "", countries: "", isps: "",
};
const checkHex = (h: string) => problems({ ...EMPTY, name: "x", hex: h }).hex ?? null;

interface Props {
  /** The filter being made or changed. */
  initial: Filter;
  isNew: boolean;
  onSave: (f: Filter) => Promise<void> | void;
  onCancel: () => void;
}

const STEPS = ["Match", "Behaviour", "Review"];

/** The three-step window for making or changing a filter. */
export function FilterWizard({ initial, isNew, onSave, onCancel }: Props) {
  const [f, setF] = useState<Filter>(initial);
  const [step, setStep] = useState(0);
  const [showErrors, setShowErrors] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const errors = problems(f);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    box.current?.focus();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      opener?.focus?.();
    };
  }, [onCancel]);

  const set = (patch: Partial<Filter>) => setF((x) => ({ ...x, ...patch }));
  const bad = Object.keys(errors).length > 0;

  function next() {
    if (step === 0 && bad) return setShowErrors(true);
    setShowErrors(false);
    setStep((s) => Math.min(2, s + 1));
  }

  return (
    <div className="anim-fade fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" role="presentation">
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby="wizard-title"
        tabIndex={-1}
        className="glass-strong anim-pop flex max-h-[92vh] w-full max-w-lg flex-col rounded-lg focus:outline-none"
      >
        <div className="flex items-start justify-between gap-4 px-6 pb-3 pt-5">
          <div>
            <h2 id="wizard-title" className="text-lg font-semibold text-text">{isNew ? "Create Packet Filter" : "Edit Packet Filter"}</h2>
            <p className="mt-0.5 text-xs text-muted">Pick what to match, then what the filter does with it.</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="rounded-pill px-3 py-1.5 text-lg leading-none text-muted hover:bg-white/10 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
          >
            ×
          </button>
        </div>

        <ol className="flex items-center justify-center gap-2 border-t border-border px-6 py-3" aria-label="Steps">
          {STEPS.map((name, i) => (
            <li key={name} className="flex items-center gap-2" aria-current={i === step ? "step" : undefined}>
              <span
                title={name}
                className={`flex h-8 w-8 items-center justify-center rounded-full border text-xs font-bold ${
                  i === step ? "border-accent bg-accent text-white" : i < step ? "border-accent text-text" : "border-border text-muted"
                }`}
              >
                {i + 1}
              </span>
              <span className={`text-xs ${i === step ? "text-text" : "text-muted"}`}>{name}</span>
              {i < STEPS.length - 1 && <span className="h-px w-6 bg-border" aria-hidden="true" />}
            </li>
          ))}
        </ol>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4">
          {step === 0 && (
            <div className="flex flex-col gap-5">
              <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
                <Input label="Filter Name" value={f.name} maxLength={80} placeholder="e.g., My Filter" error={showErrors ? errors.name : undefined} onChange={(e) => set({ name: e.target.value })} />
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium text-text">Protocol</span>
                  <select value={f.protocol} onChange={(e) => set({ protocol: e.target.value as Proto })} className={selectClass}>
                    {PROTOCOLS.map((p) => (
                      <option key={p} value={p}>{p === "any" ? "Any" : p}</option>
                    ))}
                  </select>
                </label>
              </div>
              <ChipField label="IP / CIDR" placeholder="e.g. 8.8.8.8 or 192.168.1.0/24" hint="Match specific IPs or subnets. 192.168. matches everything starting with it." value={f.address} onChange={(v) => set({ address: v })} check={checkAddress} />
              <ChipField label="Country" placeholder="e.g. US, DE, CA" hint="Match by 2-letter country code." value={f.countries} onChange={(v) => set({ countries: v })} check={(c) => (/^[A-Za-z]{2}$/.test(c) ? null : "Use a 2-letter country code such as US.")} tidy={(c) => c.toUpperCase()} />
              <ChipField label="ISP" placeholder="e.g. Cloudflare, Amazon" hint="Match by ISP name (part of the name is enough, capitals do not matter). Needs the ISP lookup, which Capture runs by itself." value={f.isps} onChange={(v) => set({ isps: v })} check={(n) => (n.length <= 60 ? null : "Keep it under 60 characters.")} />
              <ChipField label="Bytes Pattern (Hex)" placeholder="e.g., FF FF FF, AB CD 01" hint="Hex bytes that appear in the first 32 payload bytes of TCP or UDP. A packet with any one pattern matches." value={f.hex} onChange={(v) => set({ hex: v })} check={checkHex} tidy={(h) => normalizeHex(h).replace(/(..)(?=.)/g, "$1 ").toUpperCase()} />
              <ChipField label="Ports" placeholder="e.g. 80, 443, 100-200" hint="Single ports and ranges. Leave empty to match all ports." value={f.port} onChange={(v) => set({ port: v })} check={(p) => (parsePorts(p) ? null : "Use ports from 1 to 65535, ranges like 100-200.")} />
              <div>
                <p className="mb-2 text-sm font-medium text-text">Packet Length Range</p>
                <div className="grid grid-cols-2 gap-4">
                  <Input label="Min length (bytes)" inputMode="numeric" placeholder="0" value={f.minBytes} error={showErrors ? errors.minBytes : undefined} onChange={(e) => set({ minBytes: e.target.value.replace(/\D/g, "") })} />
                  <Input label="Max length (bytes)" inputMode="numeric" placeholder="65535" value={f.maxBytes} error={showErrors ? errors.maxBytes : undefined} onChange={(e) => set({ maxBytes: e.target.value.replace(/\D/g, "") })} />
                </div>
                <p className="mt-1.5 text-xs text-muted">Optional. Specify packet size constraints in bytes.</p>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="flex flex-col gap-5">
              <fieldset>
                <legend className="mb-2 text-sm font-semibold text-text">What this filter does</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {([
                    ["show", "Show only matches", "Packets that do not match disappear."],
                    ["hide", "Hide matches", "Packets that match disappear."],
                  ] as [Mode, string, string][]).map(([id, title, text]) => (
                    <label
                      key={id}
                      className={`flex cursor-pointer flex-col gap-0.5 rounded-lg border px-4 py-3 text-sm transition-all duration-base ease-brand focus-within:ring-2 focus-within:ring-accent-soft ${
                        f.mode === id ? "border-accent bg-accent/15" : "border-border-input bg-white/[0.04] hover:bg-white/[0.08]"
                      }`}
                    >
                      <input type="radio" name="filter-mode" className="sr-only" checked={f.mode === id} onChange={() => set({ mode: id })} />
                      <span className="font-semibold text-text">{title}</span>
                      <span className="text-xs text-muted">{text}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium text-text">Which side to check</span>
                <select value={f.direction} onChange={(e) => set({ direction: e.target.value as Direction })} className={selectClass}>
                  {DIRECTIONS.map((d) => (
                    <option key={d.id} value={d.id}>{d.label}</option>
                  ))}
                </select>
                <span className="text-xs text-muted">Applies to the IP, Country, ISP and Ports boxes.</span>
              </label>
              <p className="text-xs text-muted">A packet must match every box you filled in. Inside one box, matching any entry is enough.</p>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-3 text-sm">
              <p className="flex items-center gap-2 font-semibold text-text">
                <span className={`rounded-pill border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${f.mode === "hide" ? "border-danger/40 bg-danger-solid/20 text-danger" : "border-success/40 bg-success/10 text-success"}`}>
                  {f.mode === "hide" ? "Hide" : "Show"}
                </span>
                {f.name.trim()}
              </p>
              <p className="rounded-lg border border-border bg-white/[0.04] px-4 py-3 text-muted">{describe(f)}</p>
              <p className="text-xs text-muted">
                {f.mode === "hide" ? "Packets that match will disappear while this filter is on." : "Only packets that match will stay while this filter is on."} New filters start switched off; turn them on from the list.
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border px-6 py-4">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <div className="flex gap-2">
            {step > 0 && <Button variant="ghost" onClick={() => setStep((s) => s - 1)}>Back</Button>}
            {step < 2 ? <Button onClick={next}>Next</Button> : <Button onClick={() => (bad ? (setStep(0), setShowErrors(true)) : onSave({ ...f, name: f.name.trim() }))}>Save filter</Button>}
          </div>
        </div>
      </div>
    </div>
  );
}
