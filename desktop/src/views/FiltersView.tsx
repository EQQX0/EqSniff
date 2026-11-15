import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { EmptyState } from "@/components/ui/EmptyState";
import { Switch } from "@/components/ui/Switch";
import { NetworkIcon } from "@/components/ui/icons";
import {
  DIRECTIONS,
  PROTOCOLS,
  STARTERS,
  blankFilter,
  describe,
  fromFile,
  newId,
  problems,
  toFile,
  type Direction,
  type Filter,
  type Mode,
  type Proto,
} from "@/lib/filters";
import { download } from "@/lib/export";

interface Props {
  filters: Filter[];
  onChange: (next: Filter[]) => Promise<void>;
  /** Switch on only this filter and go to the capture table. */
  onUse: (id: string) => void;
}

const selectClass =
  "h-10 w-full rounded-pill border border-border-input bg-white/[0.06] px-4 text-sm text-text transition-all duration-base ease-brand hover:bg-white/[0.09] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft";

export function FiltersView({ filters, onChange, onUse }: Props) {
  const [draft, setDraft] = useState<Filter | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const errors = draft ? problems(draft) : {};

  async function run(work: () => Promise<void>, ok: string) {
    try {
      await work();
      setMessage({ kind: "ok", text: ok });
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    }
  }

  async function save() {
    if (!draft) return;
    if (Object.keys(errors).length > 0) return setShowErrors(true);
    const exists = filters.some((f) => f.id === draft.id);
    await run(async () => {
      await onChange(exists ? filters.map((f) => (f.id === draft.id ? draft : f)) : [...filters, draft]);
      setDraft(null);
      setShowErrors(false);
    }, `Saved “${draft.name.trim()}”.`);
  }

  const remove = (f: Filter) => run(() => onChange(filters.filter((x) => x.id !== f.id)), `Deleted “${f.name}”.`);

  const toggle = (f: Filter) =>
    run(() => onChange(filters.map((x) => (x.id === f.id ? { ...x, enabled: !x.enabled } : x))), `${f.name} is now ${f.enabled ? "off" : "on"}.`);

  async function addStarters() {
    const have = new Set(filters.map((f) => f.name));
    const fresh = STARTERS.filter((s) => !have.has(s.name)).map((s) => ({ ...s, id: newId() }));
    if (fresh.length === 0) return setMessage({ kind: "ok", text: "All starter filters are already in your list." });
    await run(() => onChange([...filters, ...fresh]), `Added ${fresh.length} starter filter${fresh.length === 1 ? "" : "s"}.`);
  }

  function exportFile() {
    download("my-filters.json", toFile(filters), "application/json");
    setMessage({ kind: "ok", text: `Exported ${filters.length} filter${filters.length === 1 ? "" : "s"}. Windows saved my-filters.json in your Downloads folder.` });
  }

  async function importFile(file: File | undefined) {
    if (!file) return;
    try {
      const imported = fromFile(await file.text());
      await onChange([...filters, ...imported]);
      setMessage({ kind: "ok", text: `Imported ${imported.length} filter${imported.length === 1 ? "" : "s"}. They start switched off.` });
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    }
    if (fileInput.current) fileInput.current.value = "";
  }

  const onCount = filters.filter((f) => f.enabled).length;
  const closeDraft = () => {
    setDraft(null);
    setShowErrors(false);
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold text-text">Filters</h1>
        <p className="mt-1 text-sm text-muted">
          A filter is either a <strong className="font-semibold text-text">Show</strong> filter, which keeps only the packets it matches, or a{" "}
          <strong className="font-semibold text-text">Hide</strong> filter, which removes them. A packet must match every box you fill in. With
          several Show filters on, a packet that matches any of them stays. A Hide filter always wins. With none on, everything is shown.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => { setDraft(blankFilter(newId())); setShowErrors(false); }}>New filter</Button>
        <Button variant="secondary" onClick={addStarters}>Add starter filters</Button>
        <span className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden="true" />
        <Button variant="ghost" onClick={() => fileInput.current?.click()}>Import</Button>
        <Button variant="ghost" onClick={exportFile} disabled={filters.length === 0}>Export</Button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose a filter file to import"
          onChange={(e) => importFile(e.target.files?.[0])}
        />
      </div>

      {message && (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={`anim-fade rounded-pill border px-4 py-2 text-sm ${
            message.kind === "error" ? "border-danger/40 bg-danger-solid/20 text-danger" : "border-border bg-white/[0.05] text-muted"
          }`}
        >
          {message.text}
        </p>
      )}

      {draft && (
        <Card className="anim-pop flex flex-col gap-6">
          <h2 className="text-lg font-semibold text-text">{filters.some((f) => f.id === draft.id) ? "Edit filter" : "New filter"}</h2>

          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-text">What this filter does</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {([
                ["show", "Show only matches", "Packets that do not match disappear from the table."],
                ["hide", "Hide matches", "Packets that match disappear from the table."],
              ] as [Mode, string, string][]).map(([id, title, text]) => (
                <label
                  key={id}
                  className={`flex cursor-pointer flex-col gap-0.5 rounded-lg border px-4 py-3 text-sm transition-all duration-base ease-brand focus-within:ring-2 focus-within:ring-accent-soft ${
                    draft.mode === id ? "border-accent bg-accent/15" : "border-border-input bg-white/[0.04] hover:bg-white/[0.08]"
                  }`}
                >
                  <input type="radio" name="filter-mode" className="sr-only" checked={draft.mode === id} onChange={() => setDraft({ ...draft, mode: id })} />
                  <span className="font-semibold text-text">{title}</span>
                  <span className="text-xs text-muted">{text}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <Input
                label="Name"
                value={draft.name}
                maxLength={80}
                error={showErrors ? errors.name : undefined}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-text">Protocol</span>
              <select value={draft.protocol} onChange={(e) => setDraft({ ...draft, protocol: e.target.value as Proto })} className={selectClass}>
                {PROTOCOLS.map((p) => (
                  <option key={p} value={p}>{p === "any" ? "Any protocol" : p}</option>
                ))}
              </select>
            </label>
          </div>

          <fieldset>
            <legend className="mb-3 text-sm font-semibold text-text">Who is talking</legend>
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium text-text">Direction</span>
                <select value={draft.direction} onChange={(e) => setDraft({ ...draft, direction: e.target.value as Direction })} className={selectClass}>
                  {DIRECTIONS.map((d) => (
                    <option key={d.id} value={d.id}>{d.label}</option>
                  ))}
                </select>
                <span className="text-xs text-muted">Which side Port and Address check.</span>
              </label>
              <Input
                label="Port"
                hint="Empty means any."
                inputMode="numeric"
                value={draft.port}
                error={showErrors ? errors.port : undefined}
                onChange={(e) => setDraft({ ...draft, port: e.target.value })}
              />
              <Input
                label="Address"
                hint="192.168.0.20 matches one device. 192.168. matches everything starting with it."
                value={draft.address}
                onChange={(e) => setDraft({ ...draft, address: e.target.value })}
              />
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-3 text-sm font-semibold text-text">Size and content</legend>
            <div className="grid gap-4 sm:grid-cols-3">
              <Input
                label="Smallest packet (bytes)"
                hint="Empty means any size."
                inputMode="numeric"
                value={draft.minBytes}
                error={showErrors ? errors.minBytes : undefined}
                onChange={(e) => setDraft({ ...draft, minBytes: e.target.value })}
              />
              <Input
                label="Largest packet (bytes)"
                hint="Empty means any size."
                inputMode="numeric"
                value={draft.maxBytes}
                error={showErrors ? errors.maxBytes : undefined}
                onChange={(e) => setDraft({ ...draft, maxBytes: e.target.value })}
              />
              <Input
                label="Contains bytes (hex)"
                hint="47 45 54 20 finds “GET ”. Checks the first 32 payload bytes of TCP and UDP."
                value={draft.hex}
                error={showErrors ? errors.hex : undefined}
                onChange={(e) => setDraft({ ...draft, hex: e.target.value })}
              />
            </div>
          </fieldset>

          <div className="flex gap-2">
            <Button onClick={save}>Save filter</Button>
            <Button variant="ghost" onClick={closeDraft}>Cancel</Button>
          </div>
        </Card>
      )}

      <Card className="p-0">
        {filters.length === 0 ? (
          <EmptyState
            icon={<NetworkIcon className="h-6 w-6" />}
            title="No filters yet"
            body="Add the starter filters for common cases, or make your own. Filters stay on this computer."
          />
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <h2 className="text-sm font-semibold text-text">Your filters</h2>
              <span className="text-xs text-muted">
                {filters.length} saved · {onCount} on
              </span>
            </div>
            <ul>
              {filters.map((f) => (
                <li
                  key={f.id}
                  className="flex flex-wrap items-center gap-4 border-b border-border px-5 py-3.5 transition-colors duration-fast last:border-0 hover:bg-white/[0.04]"
                >
                  <Switch checked={f.enabled} label={`Switch ${f.name} on`} onChange={() => toggle(f)} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate text-sm font-semibold text-text">
                      <span
                        className={`shrink-0 rounded-pill border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                          f.mode === "hide" ? "border-danger/40 bg-danger-solid/20 text-danger" : "border-success/40 bg-success/10 text-success"
                        }`}
                      >
                        {f.mode === "hide" ? "Hide" : "Show"}
                      </span>
                      <span className="truncate">{f.name}</span>
                    </p>
                    <p className="truncate text-xs text-muted">{describe(f)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button size="sm" variant="secondary" onClick={() => onUse(f.id)} aria-label={`Show only ${f.name} on the capture table`}>Use alone</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setDraft({ ...f }); setShowErrors(false); }} aria-label={`Edit ${f.name}`}>Edit</Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(f)} aria-label={`Delete ${f.name}`}>Delete</Button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
