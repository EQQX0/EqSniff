import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Switch } from "@/components/ui/Switch";
import { Tabs } from "@/components/ui/Tabs";
import { NetworkIcon } from "@/components/ui/icons";
import { FilterWizard } from "@/components/FilterWizard";
import { blankFilter, describe, fromFile, isIspFilter, newId, splitList, toFile, type Filter } from "@/lib/filters";
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
  const [ispText, setIspText] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  // ISP filters (a Hide filter that only names ISPs) get their own tab. Everything else is a packet filter.
  const packetFilters = filters.filter((f) => !isIspFilter(f));
  const ispFilters = filters.filter(isIspFilter);

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

  /** Adds a Hide filter for the ISP, switched on. The same name the Capture right-click uses, so it is made once and reused. */
  function addIsp() {
    const isp = ispText.trim().split(",")[0].trim().slice(0, 120);
    if (isp === "") return;
    const name = `Hide ISP: ${isp}`.slice(0, 80);
    const have = filters.find((f) => f.name === name);
    const next = have
      ? filters.map((f) => (f.id === have.id ? { ...f, enabled: true } : f))
      : [...filters, { ...blankFilter(newId()), name, mode: "hide" as const, isps: isp, enabled: true }];
    void run(() => onChange(next), `Hiding ISP “${isp}”.`);
    setIspText("");
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

  const onCount = packetFilters.filter((f) => f.enabled).length;
  const closeDraft = () => {
    setDraft(null);
    setDraftGlobal(false);
  };

  const toggleGlobal = (f: Filter) =>
    run(() => onToggleGlobal!(f).then(() => {}), `${f.name} is now ${f.enabled ? "off" : "on"} for you. Nobody else is affected.`);

  const retireGlobal = (f: Filter) =>
    run(() => onRetireGlobal!(f.globalId!), `Retired “${f.name}”. It is gone for everyone who had it switched on.`);

  const packetPanel = (
    <div className="flex flex-col gap-5">
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
        {packetFilters.length === 0 ? (
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
                {packetFilters.length} saved · {onCount} on
              </span>
            </div>
            <ul>
              {packetFilters.map((f) => (
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

  const ispPanel = (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-bold text-text">ISP filter</h2>
        <p className="mt-1 text-sm text-muted">
          Hide IPs from specific Internet Service Providers. Useful for filtering out known hosting providers like Take-Two Interactive, Amazon, etc.
          Part of a name is enough and capitals do not matter. A hidden IP stays in the All Traffic list, dimmed, with the ISP filter named in its Filter column.
        </p>
      </div>
      <Card>
        <form
          className="flex flex-wrap items-center gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            addIsp();
          }}
        >
          <input
            value={ispText}
            onChange={(e) => setIspText(e.target.value)}
            aria-label="ISP name to hide"
            placeholder="Enter ISP name (e.g., Amazon, Take-Two Interactive)"
            maxLength={120}
            className="h-10 min-w-0 flex-1 rounded-pill border border-border-input bg-white/[0.06] px-4 text-sm text-text placeholder:text-muted transition-all duration-base ease-brand hover:bg-white/[0.09] focus-visible:bg-white/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
          />
          <Button type="submit" disabled={splitList(ispText).length === 0}>+ Add ISP</Button>
        </form>
        {ispFilters.length === 0 ? (
          <p className="mt-4 text-sm text-muted">No ISPs hidden yet. You can also right-click an IP on the Capture page and choose “Hide ISP”.</p>
        ) : (
          <ul className="mt-4 flex flex-wrap gap-2" aria-label="Hidden ISPs">
            {ispFilters.map((f) => (
              <li
                key={f.id}
                className={`inline-flex items-center gap-1 rounded-pill border py-1 pl-3 pr-1 text-sm transition-colors duration-fast ${
                  f.enabled ? "border-accent bg-surface text-text" : "border-border text-muted"
                }`}
              >
                <button
                  type="button"
                  aria-pressed={f.enabled}
                  title={f.enabled ? "Hiding this ISP. Click to switch off." : "Switched off. Click to switch on."}
                  onClick={() => toggle(f)}
                  className="rounded-pill px-1 font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
                >
                  {f.isps}
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${f.isps}`}
                  onClick={() => remove(f)}
                  className="grid h-6 w-6 place-items-center rounded-full text-muted transition-colors duration-fast hover:bg-white/10 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
                >
                  <span aria-hidden="true">✕</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );

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

      <Tabs
        tabs={[
          { id: "packet", label: "Packet filters", panel: packetPanel },
          {
            id: "isp",
            label: <>ISP filters{ispFilters.length > 0 && <span className="ml-1.5 text-xs opacity-80">{ispFilters.length}</span>}</>,
            panel: ispPanel,
          },
        ]}
      />
    </div>
  );
}
