import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { EmptyState } from "@/components/ui/EmptyState";
import { NetworkIcon } from "@/components/ui/icons";
import { PROTOCOLS, STARTERS, fromFile, newId, problems, toFile, type Filter, type Proto } from "@/lib/filters";

interface Props {
  filters: Filter[];
  onChange: (next: Filter[]) => Promise<void>;
  onUse: (id: string) => void;
}

const blank = (): Filter => ({ id: newId(), name: "", protocol: "any", port: "", address: "", minBytes: "" });

export function FiltersView({ filters, onChange, onUse }: Props) {
  const [draft, setDraft] = useState<Filter | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const errors = draft ? problems(draft) : {};

  async function save() {
    if (!draft) return;
    if (Object.keys(errors).length > 0) return setShowErrors(true);
    const exists = filters.some((f) => f.id === draft.id);
    try {
      await onChange(exists ? filters.map((f) => (f.id === draft.id ? draft : f)) : [...filters, draft]);
      setDraft(null);
      setShowErrors(false);
      setMessage({ kind: "ok", text: `Saved “${draft.name.trim()}”.` });
    } catch (e) {
      setMessage({ kind: "error", text: String(e) });
    }
  }

  async function remove(f: Filter) {
    try {
      await onChange(filters.filter((x) => x.id !== f.id));
      setMessage({ kind: "ok", text: `Deleted “${f.name}”.` });
    } catch (e) {
      setMessage({ kind: "error", text: String(e) });
    }
  }

  async function addStarters() {
    const have = new Set(filters.map((f) => f.name));
    const fresh = STARTERS.filter((s) => !have.has(s.name)).map((s) => ({ ...s, id: newId() }));
    if (fresh.length === 0) return setMessage({ kind: "ok", text: "All starter filters are already in your list." });
    try {
      await onChange([...filters, ...fresh]);
      setMessage({ kind: "ok", text: `Added ${fresh.length} starter filter${fresh.length === 1 ? "" : "s"}.` });
    } catch (e) {
      setMessage({ kind: "error", text: String(e) });
    }
  }

  function exportFile() {
    const url = URL.createObjectURL(new Blob([toFile(filters)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "my-filters.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importFile(file: File | undefined) {
    if (!file) return;
    try {
      const imported = fromFile(await file.text());
      await onChange([...filters, ...imported]);
      setMessage({ kind: "ok", text: `Imported ${imported.length} filter${imported.length === 1 ? "" : "s"}.` });
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
          A filter chooses which packets the Capture table shows. A packet must match every box you fill in.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => { setDraft(blank()); setShowErrors(false); }}>New filter</Button>
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
              <select
                value={draft.protocol}
                onChange={(e) => setDraft({ ...draft, protocol: e.target.value as Proto })}
                className="h-10 rounded-md border border-border-input bg-surface px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {PROTOCOLS.map((p) => (
                  <option key={p} value={p}>{p === "any" ? "Any protocol" : p}</option>
                ))}
              </select>
            </label>
            <Input
              label="Port"
              hint="Matches the source or destination port. Empty means any."
              inputMode="numeric"
              value={draft.port}
              error={showErrors ? errors.port : undefined}
              onChange={(e) => setDraft({ ...draft, port: e.target.value })}
            />
            <Input
              label="Address starts with"
              hint="For example 192.168. Matches the source or destination. Empty means any."
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
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-text">{f.name}</p>
                  <p className="text-xs text-muted">
                    {[f.protocol !== "any" && f.protocol, f.port && `port ${f.port}`, f.address && `address ${f.address}…`, f.minBytes && `${f.minBytes}+ bytes`]
                      .filter(Boolean)
                      .join(" · ") || "Matches everything"}
                  </p>
                </div>
                <Button size="sm" variant="secondary" onClick={() => onUse(f.id)} aria-label={`Use ${f.name} on the capture table`}>Use</Button>
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
