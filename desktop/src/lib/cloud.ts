import { api } from "@/lib/api";
import { HIDDEN_STORE, IP_DELETED, IP_STORE, SHARED_STORE, announceChange, hiddenIps, isHiddenIp, normalizeIp, loadEntries, saveEntries, setHiddenCache, isEntryArray, loadDeleted, newEntryId, onEdited, type IpEntry, type StorageAccess } from "@/lib/ipstore";
import { mergeSync, type Meta, type RemoteEntry } from "@/lib/ipmerge";
import { bodyForGlobal, filterFromGlobal, type Filter } from "@/lib/filters";

/**
 * Optional account that keeps IP Storage, filters and VPN tunnels the same on every computer you sign in on.
 * Once signed in, sync is always on. Everything is private to the account (the database rules show a row only to its owner)
 * except what the user chooses to share with every account: tunnels and filters, never IP Storage.
 * The password is never saved. The key below is the project's public (publishable) key.
 */
export const CLOUD_URL = "https://bswzptrmeeobbnthjioz.supabase.co";
const CLOUD_KEY = "sb_publishable_efMWSpsdDD8crieaCVSlow_PGXONxdi";
const SESSION_STORE = "cloud-session";
const VPN_DELETED = "vpn-deleted";
export const FILTERS_SYNCED = "filters-synced";
export const GLOBAL_FILTERS_SYNCED = "global-filters-synced";

export interface CloudSession {
  email: string;
  username: string;
  userId: string;
  accessToken: string;
  refreshToken: string;
  /** Milliseconds since 1970 when the access token stops working. */
  expiresAt: number;
  /** Fingerprint of the filter list as of the last sync, to tell which side changed. */
  filtersHash: string | null;
  lastSync: number | null;
}

export class CloudError extends Error {}

async function call(path: string, init: RequestInit & { token?: string } = {}): Promise<Response> {
  const { token, headers, ...rest } = init;
  try {
    return await fetch(`${CLOUD_URL}${path}`, {
      ...rest,
      headers: {
        apikey: CLOUD_KEY,
        Authorization: `Bearer ${token ?? CLOUD_KEY}`,
        "Content-Type": "application/json",
        ...(headers as Record<string, string> | undefined),
      },
    });
  } catch {
    throw new CloudError("Could not reach the sync server. Check your internet connection.");
  }
}

async function fail(res: Response): Promise<never> {
  let text = `The sync server answered with status ${res.status}.`;
  try {
    const j = await res.json();
    const m = j.msg || j.message || j.error_description || j.error;
    if (typeof m === "string" && m) text = m;
  } catch {
    /* keep the status text */
  }
  throw new CloudError(text);
}

async function ok(res: Response): Promise<Response> {
  if (!res.ok) return fail(res);
  return res;
}

export async function loadSession(): Promise<CloudSession | null> {
  const v = (await api.getStore(SESSION_STORE)) as Partial<CloudSession> | null;
  if (!v || typeof v !== "object" || typeof v.refreshToken !== "string" || typeof v.email !== "string") return null;
  return {
    email: v.email,
    username: v.username ?? "",
    userId: v.userId ?? "",
    accessToken: v.accessToken ?? "",
    refreshToken: v.refreshToken,
    expiresAt: v.expiresAt ?? 0,
    filtersHash: v.filtersHash ?? null,
    lastSync: v.lastSync ?? null,
  };
}

async function saveSession(s: CloudSession | null) {
  await api.saveStore(SESSION_STORE, s);
}

interface TokenReply {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  username?: string;
  user?: { id?: string; email?: string };
  error?: string;
  confirmEmail?: boolean;
}

function toSession(r: TokenReply, fallback: { email?: string; username?: string }, keep?: Partial<CloudSession>): CloudSession {
  return {
    email: r.user?.email ?? keep?.email ?? fallback.email ?? "",
    username: r.username ?? keep?.username ?? fallback.username ?? "",
    userId: r.user?.id ?? keep?.userId ?? "",
    accessToken: r.access_token ?? "",
    refreshToken: r.refresh_token ?? "",
    expiresAt: Date.now() + (r.expires_in ?? 3600) * 1000,
    filtersHash: keep?.filtersHash ?? null,
    lastSync: keep?.lastSync ?? null,
  };
}

/** Sign-up and username sign-in go through the project's account function, which keeps emails private. */
async function account(action: "signup" | "login" | "rename", body: Record<string, string>, token?: string): Promise<TokenReply> {
  const res = await call("/functions/v1/account", {
    method: "POST",
    body: JSON.stringify({ action, ...body }),
    headers: token ? { "x-user-token": token } : undefined,
  });
  const out = (await res.json().catch(() => ({}))) as TokenReply;
  if (!res.ok || out.error) throw new CloudError(out.error || `The sync server answered with status ${res.status}.`);
  return out;
}

export type SignUpResult = { session: CloudSession } | { confirmEmail: true };

export async function signUp(username: string, email: string, password: string): Promise<SignUpResult> {
  const out = await account("signup", { username, email, password });
  if (!out.access_token) return { confirmEmail: true }; // the project asks new accounts to confirm their email first
  const s = toSession(out, { email, username });
  await saveSession(s);
  return { session: s };
}

export async function signIn(username: string, password: string): Promise<CloudSession> {
  const s = toSession(await account("login", { username, password }), { username });
  await saveSession(s);
  return s;
}

/** Sends a password-reset email. The link opens a small page on the update site where the new password is typed. */
export async function resetPassword(email: string): Promise<void> {
  await ok(
    await call(`/auth/v1/recover?redirect_to=${encodeURIComponent("https://sniff.eqqx2.com/updates/reset")}`, {
      method: "POST",
      body: JSON.stringify({ email }),
    })
  );
}

/** Changes the username. Usernames are unique, ignoring capital letters. */
export async function renameUser(username: string): Promise<CloudSession> {
  const { token, session } = await freshToken();
  const out = await account("rename", { username }, token);
  const next = { ...session, username: out.username ?? username };
  await saveSession(next);
  return next;
}

export async function signOut(): Promise<void> {
  const s = await loadSession();
  if (s?.accessToken) await call("/auth/v1/logout", { method: "POST", token: s.accessToken }).catch(() => {});
  await saveSession(null);
}

/** A working access token, refreshed when it is about to expire. Signs out if the account no longer accepts the refresh. */
async function freshToken(): Promise<{ token: string; session: CloudSession }> {
  const s = await loadSession();
  if (!s) throw new CloudError("You are not signed in.");
  if (s.accessToken && s.expiresAt - Date.now() > 60_000) return { token: s.accessToken, session: s };
  const res = await call("/auth/v1/token?grant_type=refresh_token", {
    method: "POST",
    body: JSON.stringify({ refresh_token: s.refreshToken }),
  });
  if (!res.ok) {
    if (res.status === 400 || res.status === 401) await saveSession(null);
    return fail(res);
  }
  const next = toSession((await res.json()) as TokenReply, { email: s.email }, s);
  await saveSession(next);
  return { token: next.accessToken, session: next };
}

export interface SyncReport {
  added: number;
  sent: number;
  removed: number;
  /** Plain sentences about anything worth telling the user. */
  notes: string[];
}

let running: Promise<SyncReport> | null = null;

/** Syncs whatever the user turned on. Safe to call at any time; overlapping calls share one run. */
export function syncNow(): Promise<SyncReport> {
  if (!running) running = doSync().finally(() => (running = null));
  return running;
}

// ---- IP Storage ----

const IP_COLUMNS = "address,label,updated_at,deleted,first_seen,last_seen,times_seen,group_key,favorite,prev_labels,place,isp";

interface IpRow {
  address: string;
  label: string;
  updated_at: string;
  deleted: boolean;
  first_seen: string | null;
  last_seen: string | null;
  times_seen: number | null;
  group_key: string | null;
  favorite: boolean | null;
  prev_labels: { label: string; until: number }[] | null;
  place: string | null;
  isp: string | null;
}

const ms = (t: string | null) => (t ? Date.parse(t) || undefined : undefined);

function rowToRemote(r: IpRow): RemoteEntry {
  return {
    address: r.address,
    label: r.label,
    updatedAt: Date.parse(r.updated_at) || 0,
    deleted: r.deleted,
    firstSeen: ms(r.first_seen),
    lastSeen: ms(r.last_seen),
    timesSeen: r.times_seen || undefined,
    groupKey: r.group_key || undefined,
    favorite: r.favorite || undefined,
    prevLabels: Array.isArray(r.prev_labels) && r.prev_labels.length ? r.prev_labels : undefined,
    place: r.place || undefined,
    isp: r.isp || undefined,
  };
}

/** The columns of an `ip_entries` row for one address and its details. */
function metaToRow(p: { address: string; label: string } & Meta) {
  return {
    address: p.address,
    label: p.label,
    first_seen: p.firstSeen ? new Date(p.firstSeen).toISOString() : null,
    last_seen: p.lastSeen ? new Date(p.lastSeen).toISOString() : null,
    times_seen: p.timesSeen ?? 0,
    group_key: p.groupKey ?? null,
    favorite: !!p.favorite,
    prev_labels: p.prevLabels ?? null,
    place: p.place ?? null,
    isp: p.isp ?? null,
  };
}

async function syncIps(token: string, report: SyncReport) {
  const res = await ok(await call(`/rest/v1/ip_entries?select=${IP_COLUMNS}&limit=10000`, { token }));
  const remote: RemoteEntry[] = ((await res.json()) as IpRow[]).map(rowToRemote);

  const stored = await api.getStore(IP_STORE);
  const local: IpEntry[] = isEntryArray(stored) ? stored : [];
  const result = mergeSync(local, await loadDeleted(), remote, newEntryId);

  if (result.push.length) {
    await ok(
      await call("/rest/v1/ip_entries?on_conflict=user_id,address", {
        method: "POST",
        token,
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(result.push.map((p) => ({ ...metaToRow(p), deleted: false }))),
      })
    );
  }
  for (const address of result.remove) {
    await ok(
      await call(`/rest/v1/ip_entries?address=eq.${encodeURIComponent(address)}`, {
        method: "PATCH",
        token,
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ deleted: true }),
      })
    );
  }
  if (result.changedLocal) {
    await api.saveStore(IP_STORE, result.entries); // written directly: a sync is not a user edit and must not trigger another sync
    announceChange();
  }
  await api.saveStore(IP_DELETED, {}); // every deletion is now recorded in the cloud

  report.added += result.entries.filter((e) => !local.some((l) => l.address === e.address)).length;
  report.sent += result.push.length;
  report.removed += result.remove.length;
}

// ---- tunnels and filters (the sync_items table) ----

interface Item {
  name: string;
  fingerprint: string;
  body: string;
  updatedAt: number;
  deleted: boolean;
}

async function listItems(token: string, kind: "tunnel" | "filters"): Promise<Item[]> {
  const res = await ok(await call(`/rest/v1/sync_items?kind=eq.${kind}&select=name,fingerprint,body,updated_at,deleted&limit=1000`, { token }));
  return ((await res.json()) as { name: string; fingerprint: string; body: string; updated_at: string; deleted: boolean }[]).map((r) => ({
    name: r.name,
    fingerprint: r.fingerprint,
    body: r.body,
    updatedAt: Date.parse(r.updated_at) || 0,
    deleted: r.deleted,
  }));
}

async function putItems(token: string, kind: "tunnel" | "filters", rows: { name: string; fingerprint: string; body: string }[]) {
  if (!rows.length) return;
  await ok(
    await call("/rest/v1/sync_items?on_conflict=user_id,kind,name", {
      method: "POST",
      token,
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows.map((r) => ({ ...r, kind, deleted: false }))),
    })
  );
}

async function dropItem(token: string, kind: "tunnel" | "filters", name: string) {
  await ok(
    await call(`/rest/v1/sync_items?kind=eq.${kind}&name=eq.${encodeURIComponent(name)}`, {
      method: "PATCH",
      token,
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ deleted: true, body: "" }),
    })
  );
}

/** A short fingerprint of some text, the same on every computer. */
export async function fingerprintOf(text: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...d.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function syncTunnels(token: string, report: SyncReport) {
  const rows = await listItems(token, "tunnel");

  const here = await api.vpnSyncList();
  const gone = rows.filter((r) => r.deleted);
  // A tunnel the account deleted after it last changed here stays on this computer, untouched and unsynced.
  const kept = new Set(here.filter((l) => gone.some((g) => g.name === l.name && g.updatedAt >= l.modified)).map((l) => l.name));
  if (kept.size) report.notes.push(`${kept.size} tunnel${kept.size === 1 ? " was" : "s were"} removed from your account elsewhere. ${kept.size === 1 ? "It stays" : "They stay"} on this computer, not synced.`);

  const tomb = await api.getStore(VPN_DELETED);
  const deleted = tomb && typeof tomb === "object" && !Array.isArray(tomb) ? (tomb as Record<string, number>) : {};

  const local: IpEntry[] = here
    .filter((t) => !kept.has(t.name))
    .map((t) => ({ id: t.name, address: t.name, note: t.hash, createdAt: t.modified, updatedAt: t.modified }));
  const remote: RemoteEntry[] = rows
    .filter((r) => !kept.has(r.name))
    .map((r) => ({ address: r.name, label: r.fingerprint, updatedAt: r.updatedAt, deleted: r.deleted }));
  const result = mergeSync(local, deleted, remote, newEntryId);

  const up: { name: string; fingerprint: string; body: string }[] = [];
  for (const p of result.push) up.push({ name: p.address, fingerprint: p.label, body: await api.vpnSyncRead(p.address) });
  await putItems(token, "tunnel", up);
  for (const name of result.remove) await dropItem(token, "tunnel", name);

  // Tunnels where the account's copy won: save them here.
  let downloaded = 0;
  for (const e of result.entries) {
    const mine = here.find((t) => t.name === e.address);
    if (mine && mine.hash === e.note) continue;
    const row = rows.find((r) => r.name === e.address && !r.deleted);
    if (!row) continue;
    try {
      await api.vpnSyncWrite(e.address, row.body);
      downloaded++;
    } catch (err) {
      report.notes.push(`${e.address}: ${String(err)}`);
    }
  }
  await api.saveStore(VPN_DELETED, {});

  report.added += downloaded;
  report.sent += up.length;
  report.removed += result.remove.length;
}

async function syncFilters(token: string, session: CloudSession, report: SyncReport): Promise<string> {
  const rows = await listItems(token, "filters");
  const row = rows.find((r) => r.name === "all" && !r.deleted);
  const raw = await api.getFilters();
  let list: unknown[] = Array.isArray(raw) ? raw : [];
  let hash = await fingerprintOf(JSON.stringify(list));

  const write = async (next: unknown[]) => {
    await api.saveFilters(next);
    window.dispatchEvent(new Event(FILTERS_SYNCED)); // the open pages reload the list
  };
  const push = async (next: unknown[]) => {
    const body = JSON.stringify(next);
    await putItems(token, "filters", [{ name: "all", fingerprint: await fingerprintOf(body), body }]);
    report.sent += 1;
  };

  if (!row) {
    if (list.length) await push(list);
    return hash;
  }
  if (row.fingerprint === hash) return hash;

  const before = session.filtersHash;
  const localChanged = before !== hash;
  const remoteChanged = before !== row.fingerprint;
  if (localChanged && !remoteChanged) {
    await push(list);
    return hash;
  }
  let theirs: unknown[] = [];
  try {
    const parsed = JSON.parse(row.body);
    theirs = Array.isArray(parsed) ? parsed : [];
  } catch {
    throw new CloudError("The filter list in your account is damaged.");
  }
  if (!localChanged && remoteChanged) {
    await write(theirs);
    report.added += theirs.length;
    return await fingerprintOf(JSON.stringify(theirs));
  }
  // Both sides changed (or this is the first sync with filters on both): keep every filter, this computer's copy wins on a tie.
  const idOf = (f: unknown) => (f && typeof f === "object" ? String((f as { id?: unknown }).id ?? "") : "");
  const mine = new Set(list.map(idOf));
  list = [...list, ...theirs.filter((f) => !mine.has(idOf(f)))];
  await write(list);
  await push(list);
  report.notes.push("Filters had changed in two places, so both sets were kept.");
  return await fingerprintOf(JSON.stringify(list));
}

// ---- always-hidden IPs: set by an admin, applies to every account ----

export interface HiddenIp {
  address: string;
  note: string;
  createdAt: number;
}

export async function listHiddenIps(): Promise<HiddenIp[]> {
  const { token } = await freshToken();
  const res = await ok(await call("/rest/v1/hidden_ips?select=address,note,created_at&order=created_at.asc&limit=1000", { token }));
  return ((await res.json()) as { address: string; note: string; created_at: string }[]).map((r) => ({ address: r.address, note: r.note, createdAt: Date.parse(r.created_at) || 0 }));
}

/** Keeps a local copy of the hidden list, and removes any hidden address already saved in IP Storage. */
async function refreshHidden(token: string) {
  const res = await ok(await call("/rest/v1/hidden_ips?select=address&limit=1000", { token }));
  const list = ((await res.json()) as { address: string }[]).map((r) => normalizeIp(r.address) ?? r.address);
  setHiddenCache(list);
  await api.saveStore(HIDDEN_STORE, list);
  const entries = await loadEntries();
  if (entries.some((e) => isHiddenIp(e.address))) await saveEntries(entries, entries); // saveEntries drops hidden addresses and records the deletions
}

/** Admin only: hides an address for every account, from IP Storage and from capture. */
export async function addHiddenIp(address: string, note: string): Promise<void> {
  const { token } = await freshToken();
  await ok(
    await call("/rest/v1/hidden_ips?on_conflict=address", {
      method: "POST",
      token,
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ address: normalizeIp(address) ?? address, note }),
    })
  );
  try {
    await refreshHidden(token); // the address is already hidden for everyone; a failed refresh only delays this computer
  } catch {
    setHiddenCache([...hiddenIps(), normalizeIp(address) ?? address]);
  }
}

/** Admin only: stops hiding an address. */
export async function removeHiddenIp(address: string): Promise<void> {
  const { token } = await freshToken();
  await ok(await call(`/rest/v1/hidden_ips?address=eq.${encodeURIComponent(address)}`, { method: "DELETE", token }));
  await refreshHidden(token);
}

/** What the admin let this account do with the shared IP Storage: nothing, read it, or read and change it. */
export async function getStorageAccess(): Promise<StorageAccess> {
  const { token } = await freshToken();
  const res = await ok(await call("/rest/v1/rpc/caller_storage_access", { method: "POST", token, body: "{}" }));
  const v = (await res.json()) as string;
  return v === "read" || v === "edit" ? v : "none";
}

/** Keeps a local copy of the admin's shared IP Storage for accounts that were given access; clears it for everyone else. */
async function refreshSharedStorage(token: string) {
  const access = await getStorageAccess();
  const before = (await api.getStore(SHARED_STORE)) as { access?: string; entries?: unknown[] } | null;
  if (access === "none") {
    if (before && (before.access !== "none" || (before.entries?.length ?? 0) > 0)) {
      await api.saveStore(SHARED_STORE, { access: "none", owner: "", entries: [] });
      announceChange();
    }
    return;
  }
  const ownerRes = await ok(await call("/rest/v1/rpc/shared_storage_owner", { method: "POST", token, body: "{}" }));
  const owner = ((await ownerRes.json()) as string | null) ?? "";
  if (!owner) {
    if (before && (before.entries?.length ?? 0) > 0) {
      await api.saveStore(SHARED_STORE, { access, owner: "", entries: [] });
      announceChange();
    }
    return;
  }
  const res = await ok(await call(`/rest/v1/ip_entries?user_id=eq.${owner}&deleted=eq.false&select=${IP_COLUMNS}&limit=10000`, { token }));
  const entries: IpEntry[] = ((await res.json()) as IpRow[]).map((row) => {
    const r = rowToRemote(row);
    const { address, label, updatedAt, deleted: _d, ...meta } = r;
    return { id: `shared-${address}`, address, note: label, createdAt: updatedAt, updatedAt, ...meta };
  }).filter((e) => !isHiddenIp(e.address));
  const next = { access, owner, entries };
  if (JSON.stringify(next) !== JSON.stringify(before)) {
    await api.saveStore(SHARED_STORE, next);
    announceChange();
  }
}

/** For an account with "edit" access: saves one address (label and details) into the shared list. */
export async function saveSharedEntry(owner: string, e: IpEntry): Promise<void> {
  const { token } = await freshToken();
  await ok(
    await call("/rest/v1/ip_entries?on_conflict=user_id,address", {
      method: "POST",
      token,
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ ...metaToRow({ ...e, label: e.note }), user_id: owner, deleted: false }),
    })
  );
  await refreshSharedStorage(token);
}

/** For an account with "edit" access: removes one address from the shared list. */
export async function deleteSharedEntry(owner: string, address: string): Promise<void> {
  const { token } = await freshToken();
  await ok(
    await call(`/rest/v1/ip_entries?user_id=eq.${owner}&address=eq.${encodeURIComponent(address)}`, {
      method: "PATCH",
      token,
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ deleted: true }),
    })
  );
  await refreshSharedStorage(token);
}

async function doSync(): Promise<SyncReport> {
  const { token, session } = await freshToken();
  const report: SyncReport = { added: 0, sent: 0, removed: 0, notes: [] };
  let filtersHash = session.filtersHash;

  // Only an admin's IP Storage goes to the cloud (it is the shared list). Everyone else keeps theirs on this computer.
  // A failure in one of the small side lists must not stop the filters and tunnels from syncing.
  try {
    await refreshHidden(token);
  } catch (e) {
    report.notes.push(`Hidden IP list: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (await isAdmin()) await syncIps(token, report);
  try {
    await refreshSharedStorage(token);
  } catch (e) {
    report.notes.push(`Shared IP Storage: ${e instanceof Error ? e.message : String(e)}`);
  }
  filtersHash = await syncFilters(token, session, report);
  await syncTunnels(token, report);

  const latest = (await loadSession()) ?? session;
  await saveSession({ ...latest, filtersHash, lastSync: Date.now() });
  return report;
}

/**
 * Starts the background sync: once shortly after start-up, then a few seconds after each edit to IP Storage.
 * Does nothing at all when the user is signed out or has turned every part off.
 */
export function startAutoSync(onResult?: (r: SyncReport | CloudError) => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let lastRun = 0;
  const run = async () => {
    if (running) return; // never overlap two syncs
    running = true;
    try {
      if (!(await loadSession())) return;
      const r = await syncNow();
      lastRun = Date.now();
      window.dispatchEvent(new Event(SYNC_DONE)); // screens showing synced lists reload
      onResult?.(r);
    } catch (e) {
      onResult?.(e instanceof CloudError ? e : new CloudError(String(e)));
    } finally {
      running = false;
    }
  };
  // Back in the app after being away: catch up at once (at most every 10 seconds).
  const onFocus = () => {
    if (document.visibilityState === "visible" && Date.now() - lastRun > 10_000) void run();
  };
  const first = setTimeout(run, 1500);
  const every = setInterval(run, 30_000);
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onFocus);
  const off = onEdited(() => {
    clearTimeout(timer);
    timer = setTimeout(run, 3000);
  });
  return () => {
    clearTimeout(first);
    clearTimeout(timer);
    clearInterval(every);
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onFocus);
    off();
  };
}

/** Fired after every background sync, so screens that show synced lists can reload them. */
export const SYNC_DONE = "eqnet-sync-done";

// ---- shared library: tunnels and filters shared with every signed-in account ----

export interface SharedItem {
  id: string;
  ownerId: string;
  ownerName: string;
  kind: "tunnel" | "filter" | "ip";
  name: string;
  body: string;
  updatedAt: number;
  /** The one account this is shared with, or null when it is shared with every account. */
  recipientId: string | null;
}

export async function listShared(): Promise<SharedItem[]> {
  const { token } = await freshToken();
  const res = await ok(await call("/rest/v1/shared_items?select=id,owner_id,owner_name,kind,name,body,updated_at,recipient_id&order=updated_at.desc&limit=500", { token }));
  return ((await res.json()) as { id: string; owner_id: string; owner_name: string; kind: "tunnel" | "filter" | "ip"; name: string; body: string; updated_at: string; recipient_id: string | null }[]).map((r) => ({
    id: r.id,
    ownerId: r.owner_id,
    ownerName: r.owner_name,
    kind: r.kind,
    name: r.name,
    body: r.body,
    updatedAt: Date.parse(r.updated_at) || 0,
    recipientId: r.recipient_id ?? null,
  }));
}

/** Finds an enabled account by username (case-insensitive) so something can be shared with just that account. */
export async function findUserByUsername(username: string): Promise<{ userId: string; username: string } | null> {
  const { token } = await freshToken();
  const res = await ok(await call("/rest/v1/rpc/find_user_by_username", { method: "POST", token, body: JSON.stringify({ u: username }) }));
  const rows = (await res.json()) as { user_id: string; username: string }[];
  return rows[0] ? { userId: rows[0].user_id, username: rows[0].username } : null;
}

const recipientFilter = (recipientId: string | null) => (recipientId ? `recipient_id=eq.${recipientId}` : "recipient_id=is.null");

/** Shares one tunnel or IP list with every signed-in account, or with only `recipientId`. Sharing again replaces the earlier share. */
export async function shareItem(kind: "tunnel" | "filter" | "ip", name: string, body: string, recipientId: string | null = null): Promise<void> {
  const { token, session } = await freshToken();
  await unshareItem(kind, name, recipientId);
  await ok(
    await call("/rest/v1/shared_items", {
      method: "POST",
      token,
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ kind, name, body, owner_name: session.username, recipient_id: recipientId }),
    })
  );
}

export async function unshareItem(kind: "tunnel" | "filter" | "ip", name: string, recipientId: string | null = null): Promise<void> {
  const { token, session } = await freshToken();
  await ok(
    await call(`/rest/v1/shared_items?owner_id=eq.${session.userId}&kind=eq.${kind}&name=eq.${encodeURIComponent(name)}&${recipientFilter(recipientId)}`, {
      method: "DELETE",
      token,
    })
  );
}

/** Admin only: removes anyone's shared tunnel, filter or IP Storage share by its row id. */
export async function adminRemoveShared(id: string): Promise<void> {
  const { token } = await freshToken();
  await ok(await call(`/rest/v1/shared_items?id=eq.${id}`, { method: "DELETE", token }));
}

// ---- admin panel: every account, and the power to disable one ----

export interface AdminProfile {
  userId: string;
  username: string;
  isAdmin: boolean;
  disabled: boolean;
  createdAt: number;
  /** What this account may do with the admin's shared IP Storage. */
  storageAccess: StorageAccess;
}

/** Admin only: every signed-up account. A non-admin gets back just their own row (the database rule, not this code, decides). */
export async function listProfiles(): Promise<AdminProfile[]> {
  const { token } = await freshToken();
  const res = await ok(
    await call("/rest/v1/profiles?select=user_id,username,is_admin,disabled,created_at,storage_access&order=created_at.asc&limit=1000", { token })
  );
  return ((await res.json()) as { user_id: string; username: string; is_admin: boolean; disabled: boolean; created_at: string; storage_access: string }[]).map((r) => ({
    userId: r.user_id,
    username: r.username,
    isAdmin: r.is_admin,
    disabled: r.disabled,
    createdAt: Date.parse(r.created_at) || 0,
    storageAccess: r.storage_access === "read" || r.storage_access === "edit" ? r.storage_access : "none",
  }));
}

/** Admin only: chooses what an account may do with the shared IP Storage. */
export async function setProfileStorage(userId: string, access: StorageAccess): Promise<void> {
  const { token } = await freshToken();
  await ok(await call(`/rest/v1/profiles?user_id=eq.${userId}`, { method: "PATCH", token, headers: { Prefer: "return=minimal" }, body: JSON.stringify({ storage_access: access }) }));
}

/** Admin only: sets is_admin and/or disabled on any account, including your own. */
export async function setProfileFlags(userId: string, patch: { isAdmin?: boolean; disabled?: boolean }): Promise<void> {
  const { token } = await freshToken();
  const body: Record<string, boolean> = {};
  if (patch.isAdmin !== undefined) body.is_admin = patch.isAdmin;
  if (patch.disabled !== undefined) body.disabled = patch.disabled;
  await ok(
    await call(`/rest/v1/profiles?user_id=eq.${userId}`, {
      method: "PATCH",
      token,
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(body),
    })
  );
}

// ---- global filters: admin-published filters every signed-in account gets, on by default ----

interface GlobalFilterRow {
  id: string;
  name: string;
  body: string;
  enabled: boolean;
  crown?: boolean;
}

/** True only for the account(s) marked `is_admin` in the `profiles` table. */
export async function isAdmin(): Promise<boolean> {
  const { token } = await freshToken();
  const res = await ok(await call("/rest/v1/profiles?select=is_admin&limit=1", { token }));
  const rows = (await res.json()) as { is_admin: boolean }[];
  return rows[0]?.is_admin === true;
}

/**
 * Signs the account out if an admin disabled it after this computer last signed in (a fresh sign-in is
 * already refused at login). The database itself refuses every other read and write from a disabled
 * account regardless of this check; this just turns that into a clear message instead of silent errors.
 */
export async function signOutIfDisabled(): Promise<boolean> {
  const { token } = await freshToken();
  const res = await ok(await call("/rest/v1/profiles?select=disabled&limit=1", { token }));
  const rows = (await res.json()) as { disabled: boolean }[];
  if (rows[0]?.disabled === true) {
    await signOut();
    return true;
  }
  return false;
}

/** The published filters, as runtime `Filter`s with each user's own on/off choice already applied. */
export async function getGlobalFilters(): Promise<{ filters: Filter[]; admin: boolean }> {
  const { token } = await freshToken();
  const [rowsRes, overridesRes, admin] = await Promise.all([
    ok(await call("/rest/v1/global_filters?deleted=eq.false&select=id,name,body,enabled,crown&order=position.asc,created_at.asc&limit=200", { token })),
    ok(await call("/rest/v1/global_filter_overrides?select=filter_id,enabled&limit=1000", { token })),
    isAdmin(),
  ]);
  const rows = (await rowsRes.json()) as GlobalFilterRow[];
  const overrides = new Map((await overridesRes.json() as { filter_id: string; enabled: boolean }[]).map((o) => [o.filter_id, o.enabled]));
  const filters = rows.map((r) => filterFromGlobal(r.id, r.name, overrides.get(r.id) ?? true, r.body, true, r.crown === true));
  return { filters, admin };
}

/** Turns one global filter on or off for the signed-in account only. Nobody else is affected. */
export async function setGlobalOverride(filterId: string, enabled: boolean): Promise<void> {
  const { token, session } = await freshToken();
  await ok(
    await call("/rest/v1/global_filter_overrides?on_conflict=user_id,filter_id", {
      method: "POST",
      token,
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ user_id: session.userId, filter_id: filterId, enabled }),
    })
  );
  window.dispatchEvent(new Event(GLOBAL_FILTERS_SYNCED));
}

/** Admin only (enforced by the database): publishes a new global filter at the end of the order, on for everyone. */
export async function publishGlobalFilter(f: Filter): Promise<void> {
  const { token } = await freshToken();
  const last = await ok(await call("/rest/v1/global_filters?select=position&order=position.desc&limit=1", { token }));
  const next = (((await last.json()) as { position: number }[])[0]?.position ?? 0) + 1;
  await ok(
    await call("/rest/v1/global_filters", {
      method: "POST",
      token,
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ name: f.name, body: bodyForGlobal(f), enabled: true, position: next }),
    })
  );
  window.dispatchEvent(new Event(GLOBAL_FILTERS_SYNCED));
}

/** Admin only: edits a global filter's shared definition and/or its default on/off state. */
export async function editGlobalFilter(id: string, f: Filter): Promise<void> {
  const { token } = await freshToken();
  await ok(
    await call(`/rest/v1/global_filters?id=eq.${id}`, {
      method: "PATCH",
      token,
      headers: { Prefer: "return=minimal" },
      // Only the shared definition; on/off is each account's own choice and the order is set separately.
      body: JSON.stringify({ name: f.name, body: bodyForGlobal(f) }),
    })
  );
  window.dispatchEvent(new Event(GLOBAL_FILTERS_SYNCED));
}

/** Admin only: marks whether addresses matched by this global filter get the crown icon, for every account. */
export async function setGlobalCrown(id: string, crown: boolean): Promise<void> {
  const { token } = await freshToken();
  await ok(await call(`/rest/v1/global_filters?id=eq.${id}`, { method: "PATCH", token, headers: { Prefer: "return=minimal" }, body: JSON.stringify({ crown }) }));
  window.dispatchEvent(new Event(GLOBAL_FILTERS_SYNCED));
}

/** Admin only: saves the shared order of the global filters (first id = highest priority). */
export async function setGlobalOrder(ids: string[]): Promise<void> {
  const { token } = await freshToken();
  await Promise.all(
    ids.map(async (id, i) =>
      ok(await call(`/rest/v1/global_filters?id=eq.${id}`, { method: "PATCH", token, headers: { Prefer: "return=minimal" }, body: JSON.stringify({ position: i + 1 }) }))
    )
  );
  window.dispatchEvent(new Event(GLOBAL_FILTERS_SYNCED));
}

/** Admin only: retires a global filter. It disappears for everyone; personal overrides for it are left alone. */
export async function retireGlobalFilter(id: string): Promise<void> {
  const { token } = await freshToken();
  await ok(await call(`/rest/v1/global_filters?id=eq.${id}`, { method: "PATCH", token, headers: { Prefer: "return=minimal" }, body: JSON.stringify({ deleted: true }) }));
  window.dispatchEvent(new Event(GLOBAL_FILTERS_SYNCED));
}
