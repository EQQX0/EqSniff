import type { IpEntry } from "./ipstore";

/** One saved address as the cloud table holds it. `updatedAt` is the server's clock, in milliseconds. */
export interface RemoteEntry {
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
  push: { address: string; label: string }[];
  /** Addresses to remove from the cloud because they were deleted here after the cloud copy was last changed. */
  remove: string[];
  /** True when `entries` differs from the list that went in. */
  changedLocal: boolean;
}

const stamp = (e: IpEntry) => e.updatedAt ?? e.createdAt;

/**
 * Two-way merge of the local list and the cloud list, one address at a time.
 * - The newest label wins. A tie keeps the local one.
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
      if (l.note === r.label) {
        entries.push(l);
      } else if (r.updatedAt > stamp(l)) {
        entries.push({ ...l, note: r.label, updatedAt: r.updatedAt });
        changedLocal = true;
      } else {
        entries.push(l);
        push.push({ address, label: l.note });
      }
    } else if (lAlive) {
      entries.push(l);
      push.push({ address, label: l.note });
    } else if (rAlive) {
      entries.push({ id: newId(), address, note: r.label, createdAt: r.updatedAt, updatedAt: r.updatedAt });
      changedLocal = true;
    }
  }
  return { entries, push, remove, changedLocal };
}
