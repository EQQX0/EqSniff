import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/Checkbox";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { BookmarkIcon } from "@/components/ui/icons";

import { IP_STORE, isEntryArray, newEntryId, onChange, saveEntries, type IpEntry } from "@/lib/ipstore";
import { CloudError, syncNow } from "@/lib/cloud";

export type { IpEntry };

const ADDRESS_MAX = 100;
const NOTE_MAX = 500;

export function IpStorageView() {
  const [entries, setEntries] = useState<IpEntry[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [modal, setModal] = useState<{ mode: "add" | "edit"; entry: IpEntry } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<IpEntry[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    const load = () =>
      api
        .getStore(IP_STORE)
        .then((v) => isEntryArray(v) && setEntries(v))
        .catch((e) => setError(String(e)));
    load();
    return onChange(load); // a label added on the Capture page appears here at once
  }, []);

  async function persist(next: IpEntry[]) {
    setEntries(next);
    try {
      await saveEntries(next);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  async function sync() {
    setSyncing(true);
    setError(null);
    setSyncNote(null);
    try {
      const r = await syncNow();
      setSyncNote(`Synced. ${r.added} added here, ${r.sent} sent, ${r.removed} removed from the account.`);
    } catch (e) {
      setError(e instanceof CloudError ? e.message : String(e));
    } finally {
      setSyncing(false);
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
    const note = entry.note.trim().slice(0, NOTE_MAX);
    const clean: IpEntry = { ...entry, address, note };
    const exists = entries.some((e) => e.id === clean.id);
    const next = exists ? entries.map((e) => (e.id === clean.id ? clean : e)) : [...entries, clean];
    await persist(next);
    setModal(null);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const ids = new Set(deleteTarget.map((e) => e.id));
    await persist(entries.filter((e) => !ids.has(e.id)));
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    setDeleteTarget(null);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? entries.filter((e) => e.address.toLowerCase().includes(q) || e.note.toLowerCase().includes(q))
      : entries;
    return [...list].sort((a, b) => b.createdAt - a.createdAt);
  }, [entries, search]);

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
          Your own saved addresses and labels. Jot down a router, a server, or any address you want to remember, with a
          label next to it. Not used by any capture filter. If you're signed in (Settings &gt; Account), this list syncs
          with your account automatically, or press Sync to pull in a change made elsewhere right away.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          label="Search"
          hideLabel
          placeholder="Search by address or label"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-xs"
        />
        <div className="flex gap-2">
          <Button variant="secondary" onClick={sync} loading={syncing}>
            Sync
          </Button>
          <Button onClick={openAdd}>Add address</Button>
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {syncNote && <p role="status" className="text-sm text-muted">{syncNote}</p>}
      {selected.size > 0 && (
        <div className="flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2">
          <span className="text-sm text-text">{selected.size} selected</span>
          <div className="flex gap-2">
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
                <th scope="col" className="px-3 py-2 font-semibold">Added</th>
                <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">
                    <Checkbox
                      checked={selected.has(e.id)}
                      onChange={() => toggleOne(e.id)}
                      aria-label={`Select ${e.address}`}
                    />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-text">{e.address}</td>
                  <td className="max-w-sm px-3 py-2 text-sm text-muted">{e.note || <span className="italic">No label</span>}</td>
                  <td className="px-3 py-2 text-xs text-muted">{new Date(e.createdAt).toLocaleDateString()}</td>
                  <td className="px-3 py-1.5 text-right">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="secondary" onClick={() => openEdit(e)} aria-label={`Edit ${e.address}`}>
                        Edit
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => setDeleteTarget([e])} aria-label={`Delete ${e.address}`}>
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

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
