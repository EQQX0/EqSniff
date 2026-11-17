import type { IpEntry, PrevLabel } from "./ipstore";

/** What the cloud keeps about an address besides its label. Every field is optional: older rows have none of it. */
export interface Meta {
  firstSeen?: number;
  lastSeen?: number;
  timesSeen?: number;
  place?: string;
  isp?: string;
  groupKey?: string;
  favorite?: boolean;
  prevLabels?: PrevLabel[];
}

/** One saved address as the cloud table holds it. `updatedAt` is the server's clock, in milliseconds. */
export interface RemoteEntry extends Meta {
  address: string;
  label: string;
  updatedAt: number;
  /** The cloud keeps a deleted row (marked) so every computer learns about the deletion. */
  deleted?: boolean;
}

export interface MergeResult {
  /** The list this computer should keep. */
  entries: IpEntry[];
  /** Rows to send up (new or newer here). */
  push: ({ address: string; label: string } & Meta)[];
  /** Addresses to remove from the cloud because they were deleted here after the cloud copy was last changed. */
  remove: string[];
  /** True when `entries` differs from the list that went in. */
  changedLocal: boolean;
}

const stamp = (e: IpEntry) => e.updatedAt ?? e.createdAt;

const metaOf = (e: Meta): Meta => ({
  firstSeen: e.firstSeen,
  lastSeen: e.lastSeen,
  timesSeen: e.timesSeen,
  place: e.place,
  isp: e.isp,
  groupKey: e.groupKey || undefined,
  favorite: e.favorite || undefined,
  prevLabels: e.prevLabels && e.prevLabels.length ? e.prevLabels : undefined,
});

/** True when two sides carry the same label and the same extra details. */
const same = (a: Meta & { label: string }, b: Meta & { label: string }) => a.label === b.label && JSON.stringify(metaOf(a)) === JSON.stringify(metaOf(b));

const lo = (a?: number, b?: number) => (a === undefined ? b : b === undefined ? a : Math.min(a, b));
const hi = (a?: number, b?: number) => (a === undefined ? b : b === undefined ? a : Math.max(a, b));

/** Seen details from both sides: the earliest first sighting, the latest last one, the higher visit count. */
function seenOf(l: Meta, r: Meta): Pick<Meta, "firstSeen" | "lastSeen" | "timesSeen" | "place" | "isp"> {
  const newerLocal = (l.lastSeen ?? 0) >= (r.lastSeen ?? 0);
  return {
    firstSeen: lo(l.firstSeen, r.firstSeen),
    lastSeen: hi(l.lastSeen, r.lastSeen),
    timesSeen: hi(l.timesSeen, r.timesSeen),
    place: (newerLocal ? l.place ?? r.place : r.place ?? l.place) || undefined,
    isp: (newerLocal ? l.isp ?? r.isp : r.isp ?? l.isp) || undefined,
  };
}

/**
 * Two-way merge of the local list and the cloud list, one address at a time.
 * - The newest label wins (with its link, favourite and earlier labels). A tie keeps the local one.
 * - Seen details are combined from both sides, so no computer loses a sighting.
 * - An address deleted here (see `deleted`, address -> time) is removed from the cloud, unless the cloud copy is newer than the deletion.
 * - A deletion recorded in the cloud (`deleted`) removes the local copy unless that copy was edited after it.
 * - Nothing is ever deleted without such a record, so a new computer joining an account only adds.
 */
export function mergeSync(
  local: IpEntry[],
  deleted: Record<string, number>,
  remote: RemoteEntry[],
  newId: () => string
): MergeResult {
  const locals = new Map(local.map((e) => [e.address, e]));
  const remotes = new Map(remote.map((r) => [r.address, r]));
  const addresses = new Set([...locals.keys(), ...remotes.keys()]);

  const entries: IpEntry[] = [];
  const push: MergeResult["push"] = [];
  const remove: string[] = [];
  let changedLocal = false;

  for (const address of addresses) {
    const l = locals.get(address);
    const r = remotes.get(address);
    const t = deleted[address];
    const rGone = !!r?.deleted;
    // A deletion made here, or one the cloud recorded, ends a local copy that is not newer than it.
    const cut = Math.max(t ?? -Infinity, rGone ? r!.updatedAt : -Infinity);
    const lAlive = l && !(cut !== -Infinity && cut >= stamp(l));
    const rAlive = r && !rGone && !(t !== undefined && t >= r.updatedAt);

    if (l && !lAlive) changedLocal = true; // deleted somewhere else: drop the leftover copy
    if (r && !rGone && !rAlive && !lAlive) remove.push(address); // a live local copy overwrites the stale cloud row instead

    if (lAlive && rAlive) {
      const remoteWins = r.updatedAt > stamp(l);
      const base = remoteWins ? { label: r.label, ...metaOf(r) } : { label: l.note, ...metaOf(l) };
      const merged: IpEntry = {
        ...l,
        note: base.label,
        groupKey: base.groupKey,
        favorite: base.favorite,
        prevLabels: base.prevLabels,
        ...seenOf(l, r),
        updatedAt: remoteWins ? r.updatedAt : l.updatedAt,
      };
      const m = { label: merged.note, ...metaOf(merged) };
      if (!same(m, { label: l.note, ...metaOf(l) })) changedLocal = true;
      entries.push(merged);
      if (!same(m, { label: r.label, ...metaOf(r) })) push.push({ address, ...m });
    } else if (lAlive) {
      entries.push(l);
      push.push({ address, label: l.note, ...metaOf(l) });
    } else if (rAlive) {
      entries.push({ id: newId(), address, note: r.label, createdAt: r.updatedAt, updatedAt: r.updatedAt, ...metaOf(r) });
      changedLocal = true;
    }
  }
  return { entries, push, remove, changedLocal };
}
