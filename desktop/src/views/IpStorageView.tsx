import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { BookmarkIcon } from "@/components/ui/icons";

export interface IpEntry {
  id: string;
  address: string;
  note: string;
  createdAt: number;
}

const ADDRESS_MAX = 100;
const NOTE_MAX = 500;

function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isEntryArray(v: unknown): v is IpEntry[] {
  return Array.isArray(v) && v.every((e) => e && typeof e === "object" && typeof (e as IpEntry).address === "string");
}

export function IpStorageView() {
  const [entries, setEntries] = useState<IpEntry[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<{ mode: "add" | "edit"; entry: IpEntry } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<IpEntry | null>(null);

  useEffect(() => {
    api
      .getStore("ip-storage")
      .then((v) => isEntryArray(v) && setEntries(v))
      .catch((e) => setError(String(e)));
  }, []);

  async function persist(next: IpEntry[]) {
    setEntries(next);
    try {
      await api.saveStore("ip-storage", next);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  function openAdd() {
    setModal({ mode: "add", entry: { id: newId(), address: "", note: "", createdAt: Date.now() } });
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
    await persist(entries.filter((e) => e.id !== deleteTarget.id));
    setDeleteTarget(null);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? entries.filter((e) => e.address.toLowerCase().includes(q) || e.note.toLowerCase().includes(q))
      : entries;
    return [...list].sort((a, b) => b.createdAt - a.createdAt);
  }, [entries, search]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-text">IP Storage</h1>
        <p className="mt-1 text-sm text-muted">
          Your own saved addresses and notes. Jot down a router, a server, or any address you want to remember, with a
          comment next to it. This list stays on this computer and is not used by any capture filter.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          label="Search"
          hideLabel
          placeholder="Search by address or note"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-xs"
        />
        <Button onClick={openAdd}>Add address</Button>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
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
                <th scope="col" className="px-3 py-2 font-semibold">Address</th>
                <th scope="col" className="px-3 py-2 font-semibold">Note</th>
                <th scope="col" className="px-3 py-2 font-semibold">Added</th>
                <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-mono text-xs text-text">{e.address}</td>
                  <td className="max-w-sm px-3 py-2 text-sm text-muted">{e.note || <span className="italic">No note</span>}</td>
                  <td className="px-3 py-2 text-xs text-muted">{new Date(e.createdAt).toLocaleDateString()}</td>
                  <td className="px-3 py-1.5 text-right">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="secondary" onClick={() => openEdit(e)} aria-label={`Edit ${e.address}`}>
                        Edit
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => setDeleteTarget(e)} aria-label={`Delete ${e.address}`}>
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

      <Modal open={deleteTarget !== null} onClose={() => setDeleteTarget(null)} title="Delete address">
        {deleteTarget && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-text">
              Delete <span className="font-mono">{deleteTarget.address}</span>? This cannot be undone.
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
        <label htmlFor="ip-note" className="text-sm font-medium text-text">
          Note
        </label>
        <textarea
          id="ip-note"
          value={note}
          maxLength={NOTE_MAX}
          placeholder="Add a comment"
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          className="rounded-md border border-border-input bg-surface px-3 py-2 text-sm text-text placeholder:text-muted
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
