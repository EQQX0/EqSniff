import { api } from "@/lib/api";
import { IP_DELETED, IP_STORE, announceChange, isEntryArray, loadDeleted, newEntryId, onEdited, type IpEntry } from "@/lib/ipstore";
import { mergeSync, type RemoteEntry } from "@/lib/ipmerge";

/**
 * Optional account for syncing IP Storage, filters and VPN tunnels between computers. Off until the user signs in and turns
 * each part on. Everything stays private to the account (the database rules show a row only to its owner).
 * Tunnels are locked on this computer with a sync passphrase before upload, so the server never holds a readable private key.
 * The password and the passphrase are never saved. The key below is the project's public (publishable) key.
 */
export const CLOUD_URL = "https://bswzptrmeeobbnthjioz.supabase.co";
const CLOUD_KEY = "sb_publishable_efMWSpsdDD8crieaCVSlow_PGXONxdi";
const SESSION_STORE = "cloud-session";
const VPN_DELETED = "vpn-deleted";
export const FILTERS_SYNCED = "filters-synced";

export interface CloudSession {
  email: string;
  accessToken: string;
  refreshToken: string;
  /** Milliseconds since 1970 when the access token stops working. */
  expiresAt: number;
  /** Keep IP Storage in step. */
  enabled: boolean;
  /** Keep the filter list in step. */
  filters: boolean;
  /** Keep VPN tunnels in step (needs the sync passphrase). */
  tunnels: boolean;
  /** Fingerprint of the filter list as of the last sync, to tell which side changed. */
  filtersHash: string | null;
  lastSync: number | null;
}

export class CloudError extends Error {}

// The passphrase lives in memory only. After the app restarts it has to be entered again before tunnels sync.
let passphrase: string | null = null;
export const hasPassphrase = () => passphrase !== null;
export function setPassphrase(p: string | null) {
  passphrase = p;
}

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
    accessToken: v.accessToken ?? "",
    refreshToken: v.refreshToken,
    expiresAt: v.expiresAt ?? 0,
    enabled: !!v.enabled,
    filters: !!v.filters,
    tunnels: !!v.tunnels,
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
  user?: { email?: string };
}

function toSession(r: TokenReply, email: string, keep?: Partial<CloudSession>): CloudSession {
  return {
    email: r.user?.email ?? email,
    accessToken: r.access_token ?? "",
    refreshToken: r.refresh_token ?? "",
    expiresAt: Date.now() + (r.expires_in ?? 3600) * 1000,
    enabled: keep?.enabled ?? false,
    filters: keep?.filters ?? false,
    tunnels: keep?.tunnels ?? false,
    filtersHash: keep?.filtersHash ?? null,
    lastSync: keep?.lastSync ?? null,
  };
}

export type SignUpResult = { session: CloudSession } | { confirmEmail: true };

export async function signUp(email: string, password: string): Promise<SignUpResult> {
  const res = await ok(await call("/auth/v1/signup", { method: "POST", body: JSON.stringify({ email, password }) }));
  const j = (await res.json()) as TokenReply;
  if (!j.access_token) return { confirmEmail: true }; // the project asks new accounts to confirm their email first
  const s = toSession(j, email);
  await saveSession(s);
  return { session: s };
}

export async function signIn(email: string, password: string): Promise<CloudSession> {
  const res = await ok(await call("/auth/v1/token?grant_type=password", { method: "POST", body: JSON.stringify({ email, password }) }));
  const s = toSession((await res.json()) as TokenReply, email);
  await saveSession(s);
  return s;
}

export async function signOut(): Promise<void> {
  const s = await loadSession();
  if (s?.accessToken) await call("/auth/v1/logout", { method: "POST", token: s.accessToken }).catch(() => {});
  passphrase = null;
  await saveSession(null);
}

export type Parts = Pick<CloudSession, "enabled" | "filters" | "tunnels">;

export async function setParts(patch: Partial<Parts>): Promise<CloudSession | null> {
  const s = await loadSession();
  if (!s) return null;
  const next = { ...s, ...patch };
  await saveSession(next);
  return next;
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
  const next = toSession((await res.json()) as TokenReply, s.email, s);
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

async function syncIps(token: string, report: SyncReport) {
  const res = await ok(await call("/rest/v1/ip_entries?select=address,label,updated_at,deleted&limit=10000", { token }));
  const remote: RemoteEntry[] = ((await res.json()) as { address: string; label: string; updated_at: string; deleted: boolean }[]).map((r) => ({
    address: r.address,
    label: r.label,
    updatedAt: Date.parse(r.updated_at) || 0,
    deleted: r.deleted,
  }));

  const stored = await api.getStore(IP_STORE);
  const local: IpEntry[] = isEntryArray(stored) ? stored : [];
  const result = mergeSync(local, await loadDeleted(), remote, newEntryId);

  if (result.push.length) {
    await ok(
      await call("/rest/v1/ip_entries?on_conflict=user_id,address", {
        method: "POST",
        token,
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(result.push.map((p) => ({ ...p, deleted: false }))),
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

async function syncTunnels(token: string, pass: string, report: SyncReport) {
  const rows = await listItems(token, "tunnel");

  // Refuse early if this passphrase is not the one the account's tunnels were locked with.
  const sample = rows.find((r) => !r.deleted && r.body);
  if (sample) await api.vpnSyncCheck(sample.body, pass).catch(() => Promise.reject(new CloudError("Wrong sync passphrase for this account's tunnels.")));

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
  for (const p of result.push) up.push({ name: p.address, fingerprint: p.label, body: await api.vpnSyncSeal(p.address, pass) });
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
      await api.vpnSyncOpen(e.address, row.body, pass);
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

async function doSync(): Promise<SyncReport> {
  const { token, session } = await freshToken();
  const report: SyncReport = { added: 0, sent: 0, removed: 0, notes: [] };
  let filtersHash = session.filtersHash;

  if (session.enabled) await syncIps(token, report);
  if (session.filters) filtersHash = await syncFilters(token, session, report);
  if (session.tunnels) {
    if (passphrase) await syncTunnels(token, passphrase, report);
    else report.notes.push("Tunnels were not synced: enter the sync passphrase in Settings first.");
  }

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
  const run = async () => {
    try {
      const s = await loadSession();
      if (!s || !(s.enabled || s.filters || s.tunnels)) return;
      onResult?.(await syncNow());
    } catch (e) {
      onResult?.(e instanceof CloudError ? e : new CloudError(String(e)));
    }
  };
  const first = setTimeout(run, 1500);
  const off = onEdited(() => {
    clearTimeout(timer);
    timer = setTimeout(run, 3000);
  });
  return () => {
    clearTimeout(first);
    clearTimeout(timer);
    off();
  };
}
