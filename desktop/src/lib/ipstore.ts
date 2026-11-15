import { api } from "@/lib/api";

/** One row of the IP Storage page. The label given in Capture is stored in `note` (the field keeps its old name so saved lists still load). */
export interface IpEntry {
  id: string;
  address: string;
  note: string;
  createdAt: number;
}

export const IP_STORE = "ip-storage";
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

/** Tells every open page that the list changed, so the IP Storage page and the Capture table stay in step. */
export function announceChange() {
  window.dispatchEvent(new Event(CHANGED));
}

export function onChange(fn: () => void): () => void {
  window.addEventListener(CHANGED, fn);
  return () => window.removeEventListener(CHANGED, fn);
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
  await api.saveStore(IP_STORE, next);
  announceChange();
  return next;
}
