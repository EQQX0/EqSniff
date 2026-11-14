import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { EmptyState } from "@/components/ui/EmptyState";
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
  "h-10 rounded-md border border-border-input bg-surface px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

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

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-text">Filters</h1>
        <p className="mt-1 text-sm text-muted">
          A filter picks which packets the Capture table shows. A packet must match every box you fill in. Switch several filters on and the
          table shows packets that match any of them. With none on, it shows everything.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => { setDraft(blankFilter(newId())); setShowErrors(false); }}>New filter</Button>
        <Button variant="secondary" onClick={addStarters}>Add starter filters</Button>
        <Button variant="secondary" onClick={() => fileInput.current?.click()}>Import file</Button>
        <Button variant="secondary" onClick={exportFile} disabled={filters.length === 0}>Export file</Button>
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

      <p
        role={message?.kind === "error" ? "alert" : "status"}
        className={`min-h-5 text-sm ${message?.kind === "error" ? "text-danger" : "text-muted"}`}
      >
        {message?.text}
      </p>

      {draft && (
        <Card className="flex flex-col gap-4">
          <h2 className="text-base font-semibold text-text">
            {filters.some((f) => f.id === draft.id) ? "Edit filter" : "New filter"}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Name"
              value={draft.name}
              maxLength={80}
              error={showErrors ? errors.name : undefined}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-text">Protocol</span>
              <select value={draft.protocol} onChange={(e) => setDraft({ ...draft, protocol: e.target.value as Proto })} className={selectClass}>
                {PROTOCOLS.map((p) => (
                  <option key={p} value={p}>{p === "any" ? "Any protocol" : p}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-text">Direction</span>
              <select value={draft.direction} onChange={(e) => setDraft({ ...draft, direction: e.target.value as Direction })} className={selectClass}>
                {DIRECTIONS.map((d) => (
                  <option key={d.id} value={d.id}>{d.label}</option>
                ))}
              </select>
              <span className="text-xs text-muted">Which side the port and address boxes check.</span>
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
              hint="A full address such as 192.168.0.20 matches only that device. Something shorter, such as 192.168., matches every address that starts with it."
              value={draft.address}
              onChange={(e) => setDraft({ ...draft, address: e.target.value })}
            />
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
              hint="For example 47 45 54 20 for “GET ”. Looks in the first 32 bytes of the payload of TCP and UDP packets."
              value={draft.hex}
              error={showErrors ? errors.hex : undefined}
              onChange={(e) => setDraft({ ...draft, hex: e.target.value })}
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={save}>Save filter</Button>
            <Button variant="ghost" onClick={() => { setDraft(null); setShowErrors(false); }}>Cancel</Button>
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
          <ul className="divide-y divide-border">
            {filters.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={f.enabled}
                    onChange={() => toggle(f)}
                    className="h-4 w-4 accent-[var(--color-accent)]"
                    aria-label={`Switch ${f.name} on`}
                  />
                  <span className="text-xs text-muted">{f.enabled ? "On" : "Off"}</span>
                </label>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-text">{f.name}</p>
                  <p className="text-xs text-muted">{describe(f)}</p>
                </div>
                <Button size="sm" variant="secondary" onClick={() => onUse(f.id)} aria-label={`Show only ${f.name} on the capture table`}>Use alone</Button>
                <Button size="sm" variant="ghost" onClick={() => { setDraft({ ...f }); setShowErrors(false); }} aria-label={`Edit ${f.name}`}>Edit</Button>
                <Button size="sm" variant="ghost" onClick={() => remove(f)} aria-label={`Delete ${f.name}`}>Delete</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
