import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/Checkbox";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { BookmarkIcon, CopyIcon } from "@/components/ui/icons";

import { toast } from "@/components/ui/Toast";
import { IP_STORE, ago, groupByLabel, isEntryArray, isHiddenIp, loadShared, newEntryId, onChange, renameLabel, saveEntries, setFavorite, setLink, type IpEntry, type LabelGroup, type SharedStorage } from "@/lib/ipstore";
import { SYNC_DONE, deleteSharedEntry, saveSharedEntry } from "@/lib/cloud";
import { cell, copyText, download } from "@/lib/export";

export type { IpEntry };

const ADDRESS_MAX = 100;
const NOTE_MAX = 500;

export function IpStorageView() {
  const [entries, setEntries] = useState<IpEntry[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<{ mode: "add" | "edit"; entry: IpEntry } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<IpEntry[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<{ label: string; next: string } | null>(null);
  const [shared, setShared] = useState<SharedStorage>({ access: "none", owner: "", entries: [] });
  const [sharedModal, setSharedModal] = useState<{ mode: "add" | "edit"; entry: IpEntry } | null>(null);
  const [sharedDelete, setSharedDelete] = useState<IpEntry | null>(null);

  function handleCopy(key: string, value: string) {
    void copyText(value).then((ok) =>
      ok === false ? toast("Copying was blocked by Windows. Select the text and press Ctrl+C instead.", { kind: "error" }) : toast(`Copied ${key.startsWith("label") || key.includes("note") ? "label" : "address"}: ${value.length > 50 ? value.slice(0, 47) + "…" : value}`)
    );
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1200);
  }

  useEffect(() => {
    const load = () =>
      api
        .getStore(IP_STORE)
        .then((v) => isEntryArray(v) && setEntries(v))
        .catch((e) => setError(String(e)));
    const loadShare = () => void loadShared().then(setShared).catch(() => {});
    loadShare();
    window.addEventListener(SYNC_DONE, loadShare);
    load();
    window.addEventListener(SYNC_DONE, load); // a change pulled from the account in the background
    const off = onChange(load); // a label added on the Capture page appears here at once
    const offShared = onChange(loadShare);
    return () => {
      window.removeEventListener(SYNC_DONE, load);
      window.removeEventListener(SYNC_DONE, loadShare);
      off();
      offShared();
    };
  }, []);

  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  /** Saves the list. Returns false (after showing why) when nothing was saved, so callers only confirm real successes. */
  async function persist(next: IpEntry[]): Promise<boolean> {
    try {
      const saved = await saveEntries(next);
      setEntries(saved);
      setError(null);
      if (saved.length < next.length) {
        toast("An admin always hides one of these addresses, so it was not saved.", { kind: "error" });
        return false;
      }
      return true;
    } catch (e) {
      setError(String(e));
      toast(String(e instanceof Error ? e.message : e), { kind: "error" });
      return false;
    }
  }

  function openAdd() {
    setModal({ mode: "add", entry: { id: newEntryId(), address: "", note: "", createdAt: Date.now() } });
  }

  function openEdit(entry: IpEntry) {
    setModal({ mode: "edit", entry });
  }

  async function save(entry: IpEntry) {
    const address = entry.address.trim().slice(0, ADDRESS_MAX);
    if (!address) return;
    if (isHiddenIp(address)) {
      toast(`${address} is always hidden by an admin, so it cannot be saved.`, { kind: "error" });
      return;
    }
    const note = entry.note.trim().slice(0, NOTE_MAX);
    const clean: IpEntry = { ...entry, address, note };
    const exists = entries.some((e) => e.id === clean.id);
    const next = exists ? entries.map((e) => (e.id === clean.id ? clean : e)) : [...entries, clean];
    if (!(await persist(next))) return;
    toast(exists ? `Saved changes to ${address}` : `Added ${address}`);
    setModal(null);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const ids = new Set(deleteTarget.map((e) => e.id));
    const removed = entries.filter((e) => ids.has(e.id));
    if (!(await persist(entries.filter((e) => !ids.has(e.id))))) {
      setDeleteTarget(null);
      return;
    }
    toast(ids.size === 1 ? `Deleted ${deleteTarget[0].address}` : `Deleted ${ids.size} addresses`, {
      // Undo puts back only what was deleted, so anything changed in the meantime stays.
      action: {
        label: "Undo",
        run: () => {
          const now = entriesRef.current;
          const have = new Set(now.map((e) => e.address));
          void persist([...now, ...removed.filter((e) => !have.has(e.address))]).then((saved) => saved && toast("Restored"));
        },
      },
    });
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    setDeleteTarget(null);
  }

  const q = search.trim().toLowerCase();
  // A label matches when its current address or any earlier one matches (address, label, place, ISP or an earlier label).
  const matches = (e: IpEntry) =>
    q === "" || [e.address, e.note, e.place ?? "", e.isp ?? "", ...(e.prevLabels ?? []).map((p) => p.label)].some((v) => v.toLowerCase().includes(q));
  const groups = useMemo(
    () => groupByLabel(entries).filter((g) => [g.current, ...g.past].some(matches)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, q]
  );
  const filtered = useMemo(() => groups.flatMap((g) => [g.current, ...g.past]), [groups]);
  const sharedGroups = useMemo(() => groupByLabel(shared.entries).filter((g) => [g.current, ...g.past].some(matches)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shared.entries, q]);

  useEffect(() => {
    const ids = new Set(entries.map((e) => e.id));
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [entries]);

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allFilteredSelected = filtered.length > 0 && filtered.every((e) => selected.has(e.id));
  const someFilteredSelected = filtered.some((e) => selected.has(e.id));

  function exportEntries() {
    const head = ["Address", "Label", "Added", "First seen", "Last seen", "Times seen", "Location", "ISP"].join(",");
    const iso = (t?: number) => (t ? new Date(t).toISOString() : "");
    const lines = filtered.map((e) =>
      [e.address, e.note, iso(e.createdAt), iso(e.firstSeen), iso(e.lastSeen), String(e.timesSeen ?? ""), e.place ?? "", e.isp ?? ""].map(cell).join(",")
    );
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    download(`ip-storage-${stamp}.csv`, [head, ...lines].join("\r\n") + "\r\n", "text/csv");
  }

  const toggleOpen = (label: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });

  const selectedLabels = [...new Set(entries.filter((e) => selected.has(e.id) && e.note).map((e) => e.note))];
  const selectedLinked = entries.some((e) => selected.has(e.id) && e.groupKey);

  async function link() {
    const key = entries.find((e) => selectedLabels.includes(e.note) && e.groupKey)?.groupKey ?? `g-${newEntryId()}`;
    await setLink(selectedLabels, key);
    toast(`Linked ${selectedLabels.length} labels as one person`);
    setSelected(new Set());
  }

  async function unlink() {
    await setLink(selectedLabels, "");
    toast("Unlinked");
    setSelected(new Set());
  }

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) filtered.forEach((e) => next.delete(e.id));
      else filtered.forEach((e) => next.add(e.id));
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-text">IP Storage</h1>
        <p className="mt-1 text-sm text-muted">
          Your own saved addresses and labels. A label shows its current address, and the addresses it used before sit behind
          the more+ button with when each was first and last seen. Not used by any capture filter. This list stays on this computer.
          {shared.access !== "none" && " An admin also shares a storage list with you, shown below."}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          label="Search"
          hideLabel
          placeholder="Search address, label, country, ISP or an earlier IP"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-xs"
        />
        <div className="flex gap-2">
          <Button variant="secondary" disabled={filtered.length === 0} onClick={exportEntries}>
            Export
          </Button>
          <Button onClick={openAdd}>Add address</Button>
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {selected.size > 0 && (
        <div className="flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2">
          <span className="text-sm text-text">{selected.size} selected</span>
          <div className="flex gap-2">
            {selectedLabels.length >= 2 && (
              <Button size="sm" variant="secondary" onClick={() => void link()} title="Treat these labels as the same person">
                Link as one person
              </Button>
            )}
            {selectedLinked && (
              <Button size="sm" variant="secondary" onClick={() => void unlink()}>
                Unlink
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => setDeleteTarget(entries.filter((e) => selected.has(e.id)))}
            >
              Delete selected
            </Button>
          </div>
        </div>
      )}
      <Card className="p-0">
        {entries.length === 0 ? (
          <EmptyState
            icon={<BookmarkIcon className="h-6 w-6" />}
            title="No saved addresses yet."
            body="Press Add address to save your first one."
            action={<Button onClick={openAdd}>Add address</Button>}
          />
        ) : filtered.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted">No saved addresses match “{search}”.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-muted">
              <tr className="border-b border-border">
                <th scope="col" className="w-10 px-3 py-2">
                  <Checkbox
                    checked={allFilteredSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = !allFilteredSelected && someFilteredSelected;
                    }}
                    onChange={toggleAll}
                    aria-label="Select all addresses"
                  />
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">Address</th>
                <th scope="col" className="px-3 py-2 font-semibold">Label</th>
                <th scope="col" className="px-3 py-2 font-semibold">Last seen</th>
                <th scope="col" className="px-3 py-2 font-semibold">First seen</th>
                <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <GroupRows
                  key={g.current.id}
                  g={g}
                  entries={entries}
                  expanded={open.has(g.label || g.current.id)}
                  onToggle={() => toggleOpen(g.label || g.current.id)}
                  selected={selected}
                  onSelect={toggleOne}
                  copiedKey={copiedKey}
                  onCopy={handleCopy}
                  onEdit={openEdit}
                  onDelete={(e) => setDeleteTarget([e])}
                  onFavorite={(e) => void setFavorite(e.address, !e.favorite).then(() => toast(e.favorite ? `Removed ${e.address} from favourites` : `Added ${e.address} to favourites`))}
                  onRename={(label) => setRenaming({ label, next: label })}
                />
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {shared.access !== "none" && (
        <Card className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-text">Shared storage</h2>
              <p className="text-xs text-muted">
                Kept by an admin and always up to date. {shared.access === "edit" ? "You can add and change addresses here." : "Read only."} Its labels also show in Capture.
              </p>
            </div>
            {shared.access === "edit" && (
              <Button size="sm" onClick={() => setSharedModal({ mode: "add", entry: { id: newEntryId(), address: "", note: "", createdAt: Date.now() } })}>
                Add address
              </Button>
            )}
          </div>
          {sharedGroups.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted">{shared.entries.length === 0 ? "Nothing in the shared storage yet." : `No shared addresses match “${search}”.`}</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="text-muted">
                <tr className="border-b border-border">
                  <th scope="col" className="px-3 py-2 font-semibold">Address</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Label</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Last seen</th>
                  <th scope="col" className="px-3 py-2 font-semibold">First seen</th>
                  <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {sharedGroups.map((g) => (
                  <GroupRows
                    key={g.current.id}
                    g={g}
                    entries={shared.entries}
                    expanded={open.has(`shared:${g.label || g.current.id}`)}
                    onToggle={() => toggleOpen(`shared:${g.label || g.current.id}`)}
                    copiedKey={copiedKey}
                    onCopy={handleCopy}
                    onEdit={shared.access === "edit" ? (e) => setSharedModal({ mode: "edit", entry: e }) : undefined}
                    onDelete={shared.access === "edit" ? (e) => setSharedDelete(e) : undefined}
                  />
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      <Modal open={sharedModal !== null} onClose={() => setSharedModal(null)} title={sharedModal?.mode === "edit" ? "Edit shared address" : "Add shared address"}>
        {sharedModal && (
          <EntryForm
            key={sharedModal.entry.id}
            initial={sharedModal.entry}
            onCancel={() => setSharedModal(null)}
            onSave={async (entry) => {
              const address = entry.address.trim().slice(0, ADDRESS_MAX);
              if (!address) return;
              try {
                await saveSharedEntry(shared.owner, { ...entry, address, note: entry.note.trim().slice(0, NOTE_MAX), updatedAt: Date.now() });
                setError(null);
                toast(sharedModal?.mode === "add" ? `Added ${address} to shared storage` : `Saved changes to ${address} in shared storage`);
              } catch (e) {
                setError(String(e instanceof Error ? e.message : e));
                toast(String(e instanceof Error ? e.message : e), { kind: "error" });
              }
              setSharedModal(null);
            }}
          />
        )}
      </Modal>

      <Modal open={sharedDelete !== null} onClose={() => setSharedDelete(null)} title="Delete shared address">
        {sharedDelete && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-text">
              Delete <span className="font-mono">{sharedDelete.address}</span> from the shared storage? It disappears for everyone who can see it.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setSharedDelete(null)}>Cancel</Button>
              <Button
                variant="danger"
                onClick={async () => {
                  try {
                    await deleteSharedEntry(shared.owner, sharedDelete.address);
                    setError(null);
                    toast(`Deleted ${sharedDelete.address} from shared storage`);
                  } catch (e) {
                    setError(String(e instanceof Error ? e.message : e));
                    toast(String(e instanceof Error ? e.message : e), { kind: "error" });
                  }
                  setSharedDelete(null);
                }}
              >
                Delete
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={renaming !== null} onClose={() => setRenaming(null)} title="Rename label">
        {renaming && (
          <form
            className="flex flex-col gap-4"
            onSubmit={(ev) => {
              ev.preventDefault();
              void renameLabel(renaming.label, renaming.next).then(() => { toast(`Renamed label to ${renaming.next.trim()}`); setRenaming(null); }).catch((e) => toast(String(e instanceof Error ? e.message : e), { kind: "error" }));
            }}
          >
            <Input label="Label" value={renaming.next} maxLength={NOTE_MAX} onChange={(ev) => setRenaming({ ...renaming, next: ev.target.value })} hint="Every address this label has used gets the new name." />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setRenaming(null)}>Cancel</Button>
              <Button type="submit" disabled={!renaming.next.trim() || renaming.next.trim() === renaming.label}>Rename</Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={modal !== null} onClose={() => setModal(null)} title={modal?.mode === "edit" ? "Edit address" : "Add address"}>
        {modal && (
          <EntryForm
            key={modal.entry.id}
            initial={modal.entry}
            onCancel={() => setModal(null)}
            onSave={save}
          />
        )}
      </Modal>

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={deleteTarget && deleteTarget.length > 1 ? "Delete addresses" : "Delete address"}
      >
        {deleteTarget && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-text">
              {deleteTarget.length > 1 ? (
                <>Delete {deleteTarget.length} addresses? This cannot be undone.</>
              ) : (
                <>
                  Delete <span className="font-mono">{deleteTarget[0].address}</span>? This cannot be undone.
                </>
              )}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={confirmDelete}>
                Delete
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function CopyButton({
  value,
  label,
  copied,
  onCopy,
}: {
  value: string;
  label: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={`Copy ${label}`}
      title={`Copy ${label}`}
      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-white/10
        ${copied ? "text-accent-soft" : "text-muted hover:text-text"}`}
    >
      <CopyIcon className="h-3.5 w-3.5" />
    </button>
  );
}

function EntryForm({
  initial,
  onCancel,
  onSave,
}: {
  initial: IpEntry;
  onCancel: () => void;
  onSave: (entry: IpEntry) => Promise<void>;
}) {
  const [address, setAddress] = useState(initial.address);
  const [note, setNote] = useState(initial.note);
  const [touched, setTouched] = useState(false);
  const addressError = touched && address.trim() === "" ? "Enter an address." : undefined;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (address.trim() === "") return;
        onSave({ ...initial, address, note });
      }}
    >
      <Input
        label="Address"
        placeholder="e.g. 192.168.1.1 or router"
        value={address}
        maxLength={ADDRESS_MAX}
        autoFocus
        onChange={(e) => setAddress(e.target.value)}
        onBlur={() => setTouched(true)}
        error={addressError}
        hint="Any text, not only an IP, up to 100 characters."
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="ip-label" className="text-sm font-medium text-text">
          Label
        </label>
        <textarea
          id="ip-label"
          value={note}
          maxLength={NOTE_MAX}
          placeholder="Add a label"
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          className="rounded-md border border-border-input bg-surface px-3 py-2 text-sm text-text placeholder:text-muted
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">Save</Button>
      </div>
    </form>
  );
}

const star = "★";

/** One label: its current address, then (behind more+) the addresses it used before with when each was seen. */
function GroupRows({
  g,
  entries,
  expanded,
  onToggle,
  selected,
  onSelect,
  copiedKey,
  onCopy,
  onEdit,
  onDelete,
  onFavorite,
  onRename,
}: {
  g: LabelGroup;
  entries: IpEntry[];
  expanded: boolean;
  onToggle: () => void;
  selected?: Set<string>;
  onSelect?: (id: string) => void;
  copiedKey: string | null;
  onCopy: (key: string, value: string) => void;
  onEdit?: (e: IpEntry) => void;
  onDelete?: (e: IpEntry) => void;
  onFavorite?: (e: IpEntry) => void;
  onRename?: (label: string) => void;
}) {
  const e = g.current;
  const linked = e.groupKey ? [...new Set(entries.filter((x) => x.groupKey === e.groupKey && x.note !== e.note && x.note).map((x) => x.note))] : [];
  const seenLine = (x: IpEntry) =>
    [
      x.place,
    ]
      .filter(Boolean)
      .join(" · ");
  const row = (x: IpEntry, current: boolean) => (
    <tr key={x.id} className={`border-b border-border last:border-0 ${current ? "" : "bg-white/[0.03]"}`}>
      {selected && onSelect && (
        <td className="w-10 px-3 py-2">
          <Checkbox checked={selected.has(x.id)} onChange={() => onSelect(x.id)} aria-label={`Select ${x.address}`} />
        </td>
      )}
      <td className="px-3 py-2 font-mono text-xs text-text">
        <span className={`inline-flex items-center gap-1.5 ${current ? "" : "pl-4"}`}>
          {x.address}
          <CopyButton value={x.address} label="address" copied={copiedKey === `${x.id}-address`} onCopy={() => onCopy(`${x.id}-address`, x.address)} />
        </span>
        {!current && <div className="pl-4 font-sans text-[11px] text-muted">{seenLine(x)}</div>}
      </td>
      <td className="max-w-sm px-3 py-2 text-sm text-muted">
        {current ? (
          <>
            <span className="inline-flex flex-wrap items-center gap-1.5">
              {onFavorite && (
                <button
                  type="button"
                  onClick={() => onFavorite(x)}
                  aria-pressed={!!x.favorite}
                  aria-label={`${x.favorite ? "Unfavourite" : "Favourite"} ${x.note || x.address}`}
                  title={x.favorite ? "Favourite. Click to remove." : "Mark as a favourite (kept at the top)"}
                  className={`text-base leading-none ${x.favorite ? "text-[#ffd34d]" : "text-muted/40 hover:text-muted"}`}
                >
                  {star}
                </button>
              )}
              {x.note || <span className="italic">No label</span>}
              {x.note && <CopyButton value={x.note} label="label" copied={copiedKey === `${x.id}-note`} onCopy={() => onCopy(`${x.id}-note`, x.note)} />}
              {g.past.length > 0 && (
                <button
                  type="button"
                  onClick={onToggle}
                  aria-expanded={expanded}
                  className="rounded-pill border border-border-input px-2 py-0.5 text-[11px] font-semibold text-text hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
                >
                  {expanded ? "less" : `more+ (${g.past.length})`}
                </button>
              )}
            </span>
            <div className="text-[11px] text-muted">{seenLine(x)}</div>
            {linked.length > 0 && <div className="text-[11px] text-accent-soft" title="Labels marked as the same person">Linked with {linked.join(", ")}</div>}
          </>
        ) : (
          <span className="text-xs italic">earlier address</span>
        )}
        {(x.prevLabels?.length ?? 0) > 0 && (
          <div
            className="text-[11px] text-[#ffb454]"
            title={x.prevLabels!.map((p) => `${p.label} until ${new Date(p.until).toLocaleDateString()}`).join("; ")}
          >
            Also labelled {[...new Set(x.prevLabels!.map((p) => p.label))].join(", ")} before
          </div>
        )}
      </td>
      <td className="px-3 py-2 text-xs text-muted" title={x.lastSeen ? new Date(x.lastSeen).toLocaleString() : "Capture has not seen this address yet"}>
        {x.lastSeen ? ago(x.lastSeen) : <span className="italic">not yet</span>}
      </td>
      <td className="px-3 py-2 text-xs text-muted" title={x.firstSeen ? new Date(x.firstSeen).toLocaleString() : "Capture has not seen this address yet"}>
        {x.firstSeen ? new Date(x.firstSeen).toLocaleDateString() : <span className="italic">not yet</span>}
      </td>
      <td className="px-3 py-1.5 text-right">
        <div className="flex justify-end gap-2">
          {current && onRename && x.note && (
            <Button size="sm" variant="ghost" onClick={() => onRename(x.note)} aria-label={`Rename label ${x.note}`}>
              Rename
            </Button>
          )}
          {onEdit && (
            <Button size="sm" variant="secondary" onClick={() => onEdit(x)} aria-label={`Edit ${x.address}`}>
              Edit
            </Button>
          )}
          {onDelete && (
            <Button size="sm" variant="danger" onClick={() => onDelete(x)} aria-label={`Delete ${x.address}`}>
              Delete
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
  return (
    <>
      {row(e, true)}
      {expanded && g.past.map((x) => row(x, false))}
    </>
  );
}
