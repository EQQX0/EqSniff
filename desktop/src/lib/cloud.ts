import { api } from "@/lib/api";
import { IP_STORE, announceChange, isEntryArray, loadDeleted, newEntryId, onEdited, type IpEntry } from "@/lib/ipstore";
import { IP_DELETED } from "@/lib/ipstore";
import { mergeSync, type RemoteEntry } from "@/lib/ipmerge";

/**
 * Optional account for syncing IP Storage between computers. Off until the user signs in and turns it on.
 * Only the address and label of each saved entry leave this computer. The password is never saved here.
 * The key below is the project's public (publishable) key: it can do nothing the row rules do not allow.
 */
export const CLOUD_URL = "https://bswzptrmeeobbnthjioz.supabase.co";
const CLOUD_KEY = "sb_publishable_efMWSpsdDD8crieaCVSlow_PGXONxdi";
const SESSION_STORE = "cloud-session";

export interface CloudSession {
  email: string;
  accessToken: string;
  refreshToken: string;
  /** Milliseconds since 1970 when the access token stops working. */
  expiresAt: number;
  /** The user's choice: keep IP Storage in step automatically. */
  enabled: boolean;
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

export async function loadSession(): Promise<CloudSession | null> {
  const v = (await api.getStore(SESSION_STORE)) as Partial<CloudSession> | null;
  if (!v || typeof v !== "object" || typeof v.refreshToken !== "string" || typeof v.email !== "string") return null;
  return {
    email: v.email,
    accessToken: v.accessToken ?? "",
    refreshToken: v.refreshToken,
    expiresAt: v.expiresAt ?? 0,
    enabled: !!v.enabled,
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

function toSession(r: TokenReply, email: string, keep?: Pick<CloudSession, "enabled" | "lastSync">): CloudSession {
  return {
    email: r.user?.email ?? email,
    accessToken: r.access_token ?? "",
    refreshToken: r.refresh_token ?? "",
    expiresAt: Date.now() + (r.expires_in ?? 3600) * 1000,
    enabled: keep?.enabled ?? false,
    lastSync: keep?.lastSync ?? null,
  };
}

export type SignUpResult = { session: CloudSession } | { confirmEmail: true };

export async function signUp(email: string, password: string): Promise<SignUpResult> {
  const res = await call("/auth/v1/signup", { method: "POST", body: JSON.stringify({ email, password }) });
  if (!res.ok) return fail(res);
  const j = (await res.json()) as TokenReply;
  if (!j.access_token) return { confirmEmail: true }; // the project asks new accounts to confirm their email first
  const s = toSession(j, email);
  await saveSession(s);
  return { session: s };
}

export async function signIn(email: string, password: string): Promise<CloudSession> {
  const res = await call("/auth/v1/token?grant_type=password", { method: "POST", body: JSON.stringify({ email, password }) });
  if (!res.ok) return fail(res);
  const s = toSession((await res.json()) as TokenReply, email);
  await saveSession(s);
  return s;
}

export async function signOut(): Promise<void> {
  const s = await loadSession();
  if (s?.accessToken) await call("/auth/v1/logout", { method: "POST", token: s.accessToken }).catch(() => {});
  await saveSession(null);
}

export async function setEnabled(enabled: boolean): Promise<CloudSession | null> {
  const s = await loadSession();
  if (!s) return null;
  const next = { ...s, enabled };
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
}

let running: Promise<SyncReport> | null = null;

/** Merges this computer's IP Storage with the account's copy. Safe to call at any time; overlapping calls share one run. */
export function syncNow(): Promise<SyncReport> {
  if (!running) running = doSync().finally(() => (running = null));
  return running;
}

async function doSync(): Promise<SyncReport> {
  const { token, session } = await freshToken();

  const list = await call("/rest/v1/ip_entries?select=address,label,updated_at&limit=10000", { token });
  if (!list.ok) return fail(list);
  const remote: RemoteEntry[] = ((await list.json()) as { address: string; label: string; updated_at: string }[]).map((r) => ({
    address: r.address,
    label: r.label,
    updatedAt: Date.parse(r.updated_at) || 0,
  }));

  const stored = await api.getStore(IP_STORE);
  const local: IpEntry[] = isEntryArray(stored) ? stored : [];
  const result = mergeSync(local, await loadDeleted(), remote, newEntryId);

  if (result.push.length) {
    const up = await call("/rest/v1/ip_entries?on_conflict=user_id,address", {
      method: "POST",
      token,
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(result.push),
    });
    if (!up.ok) return fail(up);
  }
  for (const address of result.remove) {
    const del = await call(`/rest/v1/ip_entries?address=eq.${encodeURIComponent(address)}`, { method: "DELETE", token });
    if (!del.ok) return fail(del);
  }

  if (result.changedLocal) {
    await api.saveStore(IP_STORE, result.entries); // written directly: a sync is not a user edit and must not trigger another sync
    announceChange();
  }
  await api.saveStore(IP_DELETED, {}); // every deletion has now reached the cloud
  await saveSession({ ...session, lastSync: Date.now() });

  const added = result.entries.filter((e) => !local.some((l) => l.address === e.address)).length;
  return { added, sent: result.push.length, removed: result.remove.length };
}

/**
 * Starts the background sync: once now (if the user turned it on), then a few seconds after each edit.
 * Does nothing at all when the user is signed out or has not turned sync on.
 */
export function startAutoSync(onResult?: (r: SyncReport | CloudError) => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = async () => {
    try {
      const s = await loadSession();
      if (!s?.enabled) return;
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
