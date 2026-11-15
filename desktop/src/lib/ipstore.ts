import { api } from "@/lib/api";

/** One row of the IP Storage page. The label given in Capture is stored in `note` (the field keeps its old name so saved lists still load). */
export interface IpEntry {
  id: string;
  address: string;
  note: string;
  createdAt: number;
  /** When the label last changed on this computer. Used to decide which copy is newest when syncing. */
  updatedAt?: number;
}

export const IP_STORE = "ip-storage";
/** Addresses deleted here, with the time. Lets a sync remove them from the cloud instead of bringing them back. */
export const IP_DELETED = "ip-storage-deleted";
const EDITED = "ip-storage-edited";
const CHANGED = "ip-storage-changed";
export const NAME_MAX = 500;

export function isEntryArray(v: unknown): v is IpEntry[] {
  return Array.isArray(v) && v.every((e) => e && typeof e === "object" && typeof (e as IpEntry).address === "string");
}

export const newEntryId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export async function loadEntries(): Promise<IpEntry[]> {
  const v = await api.getStore(IP_STORE);
  return isEntryArray(v) ? v : [];
}

export async function loadDeleted(): Promise<Record<string, number>> {
  const v = await api.getStore(IP_DELETED);
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, number>) : {};
}

/** The one way to write the list. Stamps changed labels, records deletions, then tells the pages and the sync. */
export async function saveEntries(next: IpEntry[], prev?: IpEntry[]): Promise<IpEntry[]> {
  const before = prev ?? (await loadEntries());
  const was = new Map(before.map((e) => [e.address, e]));
  const now = Date.now();
  const stamped = next.map((e) => {
    const old = was.get(e.address);
    return old && old.note === e.note ? e : { ...e, updatedAt: now };
  });
  const keep = new Set(stamped.map((e) => e.address));
  const deleted = await loadDeleted();
  let deletedChanged = false;
  for (const e of before) {
    if (!keep.has(e.address)) {
      deleted[e.address] = now;
      deletedChanged = true;
    }
  }
  for (const a of keep) {
    if (a in deleted) {
      delete deleted[a];
      deletedChanged = true;
    }
  }
  await api.saveStore(IP_STORE, stamped);
  if (deletedChanged) await api.saveStore(IP_DELETED, deleted);
  announceChange();
  window.dispatchEvent(new Event(EDITED));
  return stamped;
}

/** Fires after the user (not a sync) changed the list. */
export function onEdited(fn: () => void): () => void {
  window.addEventListener(EDITED, fn);
  return () => window.removeEventListener(EDITED, fn);
}

/** Tells every open page that the list changed, so the IP Storage page and the Capture table stay in step. */
export function announceChange() {
  window.dispatchEvent(new Event(CHANGED));
}

export function onChange(fn: () => void): () => void {
  window.addEventListener(CHANGED, fn);
  return () => window.removeEventListener(CHANGED, fn);
}

/** One label keeps at most this many addresses. A fourth one written to it replaces the oldest. */
export const LABEL_IPS_MAX = 3;

/** Drops the oldest addresses of `label` so only the newest LABEL_IPS_MAX stay. `newest` is the address just written; it always stays. */
export function capLabel(list: IpEntry[], label: string, newest: string): IpEntry[] {
  const same = list.filter((e) => e.note === label);
  if (same.length <= LABEL_IPS_MAX) return list;
  const age = (e: IpEntry) => (e.address === newest ? Infinity : e.updatedAt ?? e.createdAt);
  const drop = new Set(same.sort((a, b) => age(b) - age(a)).slice(LABEL_IPS_MAX).map((e) => e.address));
  return list.filter((e) => !drop.has(e.address));
}

/** Sets, changes or (with an empty label) removes the label saved for an address. Returns the new list. */
export async function setName(address: string, name: string): Promise<IpEntry[]> {
  const list = await loadEntries(); // read fresh, so a change made on the IP Storage page is never overwritten
  const clean = name.trim().slice(0, NAME_MAX);
  const at = list.findIndex((e) => e.address === address);
  let next: IpEntry[];
  if (clean === "") next = at === -1 ? list : list.filter((_, i) => i !== at);
  else if (at === -1) next = [...list, { id: newEntryId(), address, note: clean, createdAt: Date.now() }];
  else next = list.map((e, i) => (i === at ? { ...e, note: clean } : e));
  if (clean !== "") next = capLabel(next, clean, address);
  return saveEntries(next, list);
}
