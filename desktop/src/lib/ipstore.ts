import { api } from "@/lib/api";

/** One row of the IP Storage page. The label given in Capture is stored in `note` (the field keeps its old name so saved lists still load). */
export interface IpEntry {
  id: string;
  address: string;
  note: string;
  createdAt: number;
  /** When the label last changed on this computer. Used to decide which copy is newest when syncing. */
  updatedAt?: number;
  /** When capture first and last saw this address (ms), and how many separate visits (a return after 30+ minutes away is a new visit). */
  firstSeen?: number;
  lastSeen?: number;
  timesSeen?: number;
  /** Where it was last seen, e.g. "United Kingdom · Caddington", and the ISP. */
  place?: string;
  isp?: string;
  /** Labels that were on this address before the current one, so an address that changed hands can be flagged. */
  prevLabels?: PrevLabel[];
  /** Entries whose labels share a key are the same person. */
  groupKey?: string;
  favorite?: boolean;
}

export interface PrevLabel {
  label: string;
  /** When the address stopped carrying that label (ms). */
  until: number;
}

export const IP_STORE = "ip-storage";
/** A local copy of the admin's shared IP Storage, for accounts the admin gave access to. Refreshed by the sync. */
export const SHARED_STORE = "ip-shared";

/** Addresses an admin marked "always hidden": never saved to IP Storage, never captured. A local copy of the cloud list. */
export const HIDDEN_STORE = "ip-hidden";
let hiddenCache = new Set<string>();

/** True when an admin hid this address for everyone. Answered from memory, so it is safe to call per packet. */
export const isHiddenIp = (address: string) => hiddenCache.has(address);
export const hiddenIps = () => hiddenCache;

export function setHiddenCache(list: string[]) {
  hiddenCache = new Set(list);
}

/** Reads the local copy of the hidden list into memory. */
export async function loadHidden(): Promise<Set<string>> {
  const v = await api.getStore(HIDDEN_STORE);
  setHiddenCache(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return hiddenCache;
}

export type StorageAccess = "none" | "read" | "edit";

export interface SharedStorage {
  access: StorageAccess;
  /** The admin account whose list this is (needed to save changes back when access is "edit"). */
  owner: string;
  entries: IpEntry[];
}

export async function loadShared(): Promise<SharedStorage> {
  const v = (await api.getStore(SHARED_STORE)) as Partial<SharedStorage> | null;
  const access: StorageAccess = v?.access === "read" || v?.access === "edit" ? v.access : "none";
  return { access, owner: typeof v?.owner === "string" ? v.owner : "", entries: isEntryArray(v?.entries) ? v!.entries! : [] };
}
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
  next = next.filter((e) => !hiddenCache.has(e.address)); // an always-hidden address is never stored
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

/** One label keeps at most this many addresses (its current one and its history). A new one past that drops the oldest. */
export const LABEL_IPS_MAX = 50;

/** Drops the oldest addresses of `label` so only the newest LABEL_IPS_MAX stay. `newest` is the address just written; it always stays. */
export function capLabel(list: IpEntry[], label: string, newest: string): IpEntry[] {
  const same = list.filter((e) => e.note === label);
  if (same.length <= LABEL_IPS_MAX) return list;
  const age = (e: IpEntry) => (e.address === newest ? Infinity : e.lastSeen ?? e.updatedAt ?? e.createdAt);
  const drop = new Set(same.sort((a, b) => age(b) - age(a)).slice(LABEL_IPS_MAX).map((e) => e.address));
  return list.filter((e) => !drop.has(e.address));
}

/** A return after this long away counts as a new visit. */
export const VISIT_GAP_MS = 30 * 60_000;
/** Seen times are written to disk at most this often per address, so capture does not rewrite the list constantly. */
export const SEEN_WRITE_MS = 5 * 60_000;

export interface Sighting {
  address: string;
  place?: string;
  isp?: string;
}

/**
 * Records that capture just saw these addresses. Only addresses that already have a label are kept.
 * Written straight to the store (a sighting is not a user edit), and only when something worth saving changed.
 */
export async function recordSeen(sightings: Sighting[], now = Date.now()): Promise<boolean> {
  if (sightings.length === 0) return false;
  const list = await loadEntries();
  const by = new Map(sightings.map((x) => [x.address, x]));
  let changed = false;
  const next = list.map((e) => {
    const seen = by.get(e.address);
    if (!seen || e.note === "") return e;
    const away = e.lastSeen === undefined || now - e.lastSeen >= VISIT_GAP_MS;
    const place = seen.place ?? e.place;
    const isp = seen.isp ?? e.isp;
    const stale = e.lastSeen === undefined || now - e.lastSeen >= SEEN_WRITE_MS;
    if (!away && !stale && place === e.place && isp === e.isp) return e;
    changed = true;
    return {
      ...e,
      firstSeen: e.firstSeen ?? now,
      lastSeen: now,
      timesSeen: away ? (e.timesSeen ?? 0) + 1 : Math.max(1, e.timesSeen ?? 1),
      place,
      isp,
    };
  });
  if (!changed) return false;
  await api.saveStore(IP_STORE, next);
  announceChange();
  return true;
}

/** One label with its current address (the one seen most recently) and the older addresses it used before. */
export interface LabelGroup {
  label: string;
  current: IpEntry;
  past: IpEntry[];
}

const recency = (e: IpEntry) => e.lastSeen ?? e.updatedAt ?? e.createdAt;

/** Groups the list by label. Entries without a label each stand alone under an empty label. Favourites first, then newest. */
export function groupByLabel(list: IpEntry[]): LabelGroup[] {
  const map = new Map<string, IpEntry[]>();
  const loose: IpEntry[] = [];
  for (const e of list) {
    if (!e.note) loose.push(e);
    else map.set(e.note, [...(map.get(e.note) ?? []), e]);
  }
  const groups: LabelGroup[] = [...map.entries()].map(([label, items]) => {
    const sorted = [...items].sort((a, b) => recency(b) - recency(a));
    return { label, current: sorted[0], past: sorted.slice(1) };
  });
  for (const e of loose) groups.push({ label: "", current: e, past: [] });
  return groups.sort((a, b) => Number(!!b.current.favorite) - Number(!!a.current.favorite) || recency(b.current) - recency(a.current));
}

/** The other addresses that carry (or once carried) the same label as `address`, newest first. */
export function pastFor(list: IpEntry[], address: string): IpEntry[] {
  const me = list.find((e) => e.address === address);
  if (!me || !me.note) return [];
  return list.filter((e) => e.note === me.note && e.address !== address).sort((a, b) => recency(b) - recency(a));
}

/** Sets, changes or (with an empty label) removes the label saved for an address. Returns the new list. */
export async function setName(address: string, name: string): Promise<IpEntry[]> {
  const list = await loadEntries(); // read fresh, so a change made on the IP Storage page is never overwritten
  const clean = name.trim().slice(0, NAME_MAX);
  if (clean !== "" && hiddenCache.has(address)) throw new Error(`${address} is always hidden by an admin, so it cannot be saved.`);
  const at = list.findIndex((e) => e.address === address);
  const now = Date.now();
  let next: IpEntry[];
  if (clean === "") next = at === -1 ? list : list.filter((_, i) => i !== at);
  else if (at === -1) next = [...list, { id: newEntryId(), address, note: clean, createdAt: now }];
  else
    next = list.map((e, i) => {
      if (i !== at) return e;
      // The label that was here before is remembered, so this address can be flagged as having carried it.
      const prev = e.note && e.note !== clean ? [...(e.prevLabels ?? []), { label: e.note, until: now }].slice(-10) : e.prevLabels;
      return { ...e, note: clean, prevLabels: prev };
    });
  if (clean !== "") next = capLabel(next, clean, address);
  return saveEntries(next, list);
}

/** Gives every address of `from` the label `to` (an empty `to` removes them). Used to rename a label in one go. */
export async function renameLabel(from: string, to: string): Promise<IpEntry[]> {
  const list = await loadEntries();
  const clean = to.trim().slice(0, NAME_MAX);
  if (clean === "" || from === "") return list;
  const now = Date.now();
  const next = list.map((e) => (e.note === from ? { ...e, note: clean, prevLabels: [...(e.prevLabels ?? []), { label: from, until: now }].slice(-10) } : e));
  return saveEntries(next, list);
}

/** Marks or unmarks one entry as a favourite. */
export async function setFavorite(address: string, favorite: boolean): Promise<IpEntry[]> {
  const list = await loadEntries();
  const next = list.map((e) => (e.address === address ? { ...e, favorite, updatedAt: Date.now() } : e));
  return saveEntries(next, list);
}

/** Links the labels as one person (a shared key), or with `key` empty unlinks them. */
export async function setLink(labels: string[], key: string): Promise<IpEntry[]> {
  const list = await loadEntries();
  const set = new Set(labels);
  const next = list.map((e) => (set.has(e.note) ? { ...e, groupKey: key || undefined, updatedAt: Date.now() } : e));
  return saveEntries(next, list);
}

/** "3h ago", "2 days ago", or the date for anything older than a month. */
export function ago(ms: number | undefined, now = Date.now()): string {
  if (!ms) return "never";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 31) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(ms).toLocaleDateString();
}
