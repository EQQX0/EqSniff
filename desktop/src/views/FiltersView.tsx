import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Switch } from "@/components/ui/Switch";
import { NetworkIcon } from "@/components/ui/icons";
import { FilterWizard } from "@/components/FilterWizard";
import { blankFilter, describe, fromFile, newId, toFile, type Filter } from "@/lib/filters";
import { download } from "@/lib/export";

interface Props {
  filters: Filter[];
  onChange: (next: Filter[]) => Promise<void>;
  /** Filters an admin published for every signed-in account, empty when signed out or none exist. */
  globalFilters?: Filter[];
  /** True only for an admin account. Lets this computer publish, edit and retire global filters. */
  isAdmin?: boolean;
  /** Turns one global filter on or off for the signed-in account only. */
  onToggleGlobal?: (f: Filter) => Promise<void>;
  /** Admin only: publishes a new global filter, switched on by default for everyone. */
  onPublishGlobal?: (f: Filter) => Promise<void>;
  /** Admin only: edits a global filter's shared definition. */
  onEditGlobal?: (id: string, f: Filter) => Promise<void>;
  /** Admin only: retires a global filter. It disappears for everyone. */
  onRetireGlobal?: (id: string) => Promise<void>;
}

export function FiltersView({ filters, onChange, globalFilters = [], isAdmin = false, onToggleGlobal, onPublishGlobal, onEditGlobal, onRetireGlobal }: Props) {
  const [draft, setDraft] = useState<Filter | null>(null);
  const [draftGlobal, setDraftGlobal] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function run(work: () => Promise<void>, ok: string) {
    try {
      await work();
      setMessage({ kind: "ok", text: ok });
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    }
  }

  const remove = (f: Filter) => run(() => onChange(filters.filter((x) => x.id !== f.id)), `Deleted “${f.name}”.`);

  const toggle = (f: Filter) =>
    run(() => onChange(filters.map((x) => (x.id === f.id ? { ...x, enabled: !x.enabled } : x))), `${f.name} is now ${f.enabled ? "off" : "on"}.`);

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
    setDraftGlobal(false);
  };

  const toggleGlobal = (f: Filter) =>
    run(() => onToggleGlobal!(f).then(() => {}), `${f.name} is now ${f.enabled ? "off" : "on"} for you. Nobody else is affected.`);

  const retireGlobal = (f: Filter) =>
    run(() => onRetireGlobal!(f.globalId!), `Retired “${f.name}”. It is gone for everyone who had it switched on.`);

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
        <Button onClick={() => { setDraft(blankFilter(newId())); setDraftGlobal(false); }}>New filter</Button>
        {isAdmin && (
          <Button variant="secondary" onClick={() => { setDraft(blankFilter(newId())); setDraftGlobal(true); }}>
            New global filter
          </Button>
        )}
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
        <FilterWizard
          key={draft.id}
          initial={draft}
          isNew={draftGlobal ? !globalFilters.some((f) => f.globalId === draft.id) : !filters.some((f) => f.id === draft.id)}
          onCancel={closeDraft}
          onSave={(f) =>
            run(async () => {
              if (draftGlobal) {
                const exists = globalFilters.find((x) => x.globalId === f.id);
                await (exists ? onEditGlobal!(exists.globalId!, f) : onPublishGlobal!(f));
              } else {
                const exists = filters.some((x) => x.id === f.id);
                await onChange(exists ? filters.map((x) => (x.id === f.id ? f : x)) : [...filters, f]);
              }
              closeDraft();
            }, draftGlobal ? `Published “${f.name}” for every signed-in account.` : `Saved “${f.name}”.`)
          }
        />
      )}

      {globalFilters.length > 0 && (
        <Card className="p-0">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <h2 className="text-sm font-semibold text-text">Global filters</h2>
            <span className="text-xs text-muted">
              {globalFilters.length} published · on by default, turn one off below for just your account
            </span>
          </div>
          <ul>
            {globalFilters.map((f) => (
              <li
                key={f.globalId}
                className="flex flex-wrap items-center gap-4 border-b border-border px-5 py-3.5 transition-colors duration-fast last:border-0 hover:bg-white/[0.04]"
              >
                <Switch checked={f.enabled} label={`Switch ${f.name} on for you`} onChange={() => toggleGlobal(f)} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate text-sm font-semibold text-text">
                    <span className="shrink-0 rounded-pill border border-accent-soft bg-accent-soft/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-text">
                      Global
                    </span>
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
                {isAdmin && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => { setDraft({ ...f }); setDraftGlobal(true); }} aria-label={`Edit ${f.name} for everyone`}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => retireGlobal(f)} aria-label={`Retire ${f.name} for everyone`}>
                      Retire
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="p-0">
        {filters.length === 0 ? (
          <EmptyState
            icon={<NetworkIcon className="h-6 w-6" />}
            title="No filters yet"
            body="Press New filter to make your first one. Filters stay on this computer unless you turn on sync in Settings."
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
                    <Button size="sm" variant="ghost" onClick={() => { setDraft({ ...f }); }} aria-label={`Edit ${f.name}`}>Edit</Button>
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
