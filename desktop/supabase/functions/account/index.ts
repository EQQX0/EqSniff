// Account helper for EqNetwork: sign up with a username, and sign in with a username.
// The email stays private: the app sends a username and password, this function finds the email and
// signs in on the app's behalf. Deployed with JWT checking off, because the caller is not signed in yet.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-user-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const USERNAME = /^[A-Za-z0-9_.-]{3,24}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const WRONG = "Wrong username or password.";

const admin = (path: string, init: RequestInit = {}) =>
  fetch(`${URL_}${path}`, {
    ...init,
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...(init.headers as Record<string, string>) },
  });

/** The profile row for a username, matched without regard to case. */
async function findProfile(username: string): Promise<{ user_id: string; username: string; disabled: boolean } | null> {
  const pattern = username.replace(/[\\%_]/g, (c) => `\\${c}`);
  const res = await admin(`/rest/v1/profiles?select=user_id,username,disabled&username=ilike.${encodeURIComponent(pattern)}&limit=5`);
  if (!res.ok) return null;
  const rows = (await res.json()) as { user_id: string; username: string; disabled: boolean }[];
  return rows.find((r) => r.username.toLowerCase() === username.toLowerCase()) ?? null;
}

async function signUp(body: Record<string, unknown>) {
  const username = String(body.username ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!USERNAME.test(username)) return json({ error: "Usernames are 3 to 24 letters, numbers, dots, dashes or underscores." }, 400);
  if (!EMAIL.test(email)) return json({ error: "Enter a valid email address." }, 400);
  if (password.length < 8) return json({ error: "The password needs at least 8 characters." }, 400);
  if (await findProfile(username)) return json({ error: "That username is taken." }, 409);

  const res = await fetch(`${URL_}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) return json({ error: out.msg || out.message || out.error_description || "Could not create the account." }, res.status);
  const user = out.user ?? out;
  if (!user?.id || (Array.isArray(user.identities) && user.identities.length === 0)) {
    return json({ error: "That email already has an account. Sign in, or reset the password." }, 409);
  }
  const made = await admin("/rest/v1/profiles", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ user_id: user.id, username }),
  });
  if (!made.ok) return json({ error: "That username is taken." }, 409);
  if (!out.access_token) return json({ confirmEmail: true });
  return json({ ...out, username });
}

async function login(body: Record<string, unknown>) {
  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");
  if (!USERNAME.test(username) || !password) return json({ error: WRONG }, 401);
  const profile = await findProfile(username);
  if (!profile) return json({ error: WRONG }, 401);
  if (profile.disabled) return json({ error: "This account has been disabled." }, 403);
  const who = await admin(`/auth/v1/admin/users/${profile.user_id}`);
  const email = who.ok ? ((await who.json()) as { email?: string }).email : undefined;
  if (!email) return json({ error: WRONG }, 401);
  const res = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    const m = String(out.msg || out.error_description || out.message || "");
    return json({ error: /confirm/i.test(m) ? "Confirm your email first: open the message we sent you." : WRONG }, res.status === 400 ? 401 : res.status);
  }
  return json({ ...out, username: profile.username });
}

/** Changes the signed-in user's username. The caller proves who they are with their own access token. */
async function rename(req: Request, body: Record<string, unknown>) {
  const username = String(body.username ?? "").trim();
  if (!USERNAME.test(username)) return json({ error: "Usernames are 3 to 24 letters, numbers, dots, dashes or underscores." }, 400);
  const token = (req.headers.get("x-user-token") ?? "").trim();
  if (!token) return json({ error: "You are not signed in." }, 401);
  const me = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
  if (!me.ok) return json({ error: "Your sign-in has expired. Sign in again." }, 401);
  const userId = ((await me.json()) as { id?: string }).id;
  if (!userId) return json({ error: "You are not signed in." }, 401);
  const taken = await findProfile(username);
  if (taken && taken.user_id !== userId) return json({ error: "That username is taken." }, 409);
  const saved = await admin("/rest/v1/profiles?on_conflict=user_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ user_id: userId, username }),
  });
  if (!saved.ok) return json({ error: "That username is taken." }, 409);
  // anything this user shared keeps showing the current name
  await admin(`/rest/v1/shared_items?owner_id=eq.${userId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ owner_name: username }) });
  return json({ username });
}

/** Resolves the caller's user id from their access token, or null if the token is invalid. */
async function callerId(token: string): Promise<string | null> {
  const me = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
  if (!me.ok) return null;
  const out = (await me.json()) as { id?: string };
  return out.id ?? null;
}

/** True if the given account's profile has is_admin set. */
async function isAdmin(userId: string): Promise<boolean> {
  const res = await admin(`/rest/v1/profiles?select=is_admin&user_id=eq.${userId}&limit=1`);
  if (!res.ok) return false;
  const rows = (await res.json()) as { is_admin: boolean }[];
  return rows[0]?.is_admin === true;
}

/** Verifies the request's x-user-token belongs to a signed-in admin. Returns the admin's own user id, or an error Response to return as-is. */
async function requireAdmin(req: Request): Promise<{ adminId: string } | Response> {
  const token = (req.headers.get("x-user-token") ?? "").trim();
  if (!token) return json({ error: "You are not signed in." }, 401);
  const adminId = await callerId(token);
  if (!adminId) return json({ error: "Your sign-in has expired. Sign in again." }, 401);
  if (!(await isAdmin(adminId))) return json({ error: "Admins only." }, 403);
  return { adminId };
}

/** Admin: bans or unbans an account at the Auth level (blocks sign-in outright), mirrored onto the profile's "disabled" flag the app already shows and checks. */
async function adminSetBanned(req: Request, body: Record<string, unknown>) {
  const check = await requireAdmin(req);
  if (check instanceof Response) return check;
  const userId = String(body.userId ?? "");
  const banned = Boolean(body.banned);
  if (!userId) return json({ error: "Missing account." }, 400);
  const res = await admin(`/auth/v1/admin/users/${userId}`, {
    method: "PUT",
    body: JSON.stringify({ ban_duration: banned ? "876000h" : "none" }),
  });
  if (!res.ok) return json({ error: "Could not update that account." }, res.status);
  await admin(`/rest/v1/profiles?user_id=eq.${userId}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ disabled: banned }),
  });
  return json({ ok: true });
}

/** Admin: permanently deletes an account. The profile row and its saved data cascade with it. */
async function adminDeleteUser(req: Request, body: Record<string, unknown>) {
  const check = await requireAdmin(req);
  if (check instanceof Response) return check;
  const userId = String(body.userId ?? "");
  if (!userId) return json({ error: "Missing account." }, 400);
  if (userId === check.adminId) return json({ error: "You can't delete your own account here." }, 400);
  const res = await admin(`/auth/v1/admin/users/${userId}`, { method: "DELETE" });
  if (!res.ok) return json({ error: "Could not delete that account." }, res.status);
  return json({ ok: true });
}

/** Admin: sets another account's password directly, for when they're locked out. */
async function adminSetPassword(req: Request, body: Record<string, unknown>) {
  const check = await requireAdmin(req);
  if (check instanceof Response) return check;
  const userId = String(body.userId ?? "");
  const password = String(body.password ?? "");
  if (!userId) return json({ error: "Missing account." }, 400);
  if (password.length < 8) return json({ error: "The password needs at least 8 characters." }, 400);
  const res = await admin(`/auth/v1/admin/users/${userId}`, {
    method: "PUT",
    body: JSON.stringify({ password }),
  });
  if (!res.ok) return json({ error: "Could not set that account's password." }, res.status);
  return json({ ok: true });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "Not found." }, 404);
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Bad request." }, 400);
  }
  if (body.action === "signup") return signUp(body);
  if (body.action === "login") return login(body);
  if (body.action === "rename") return rename(req, body);
  if (body.action === "adminSetBanned") return adminSetBanned(req, body);
  if (body.action === "adminDeleteUser") return adminDeleteUser(req, body);
  if (body.action === "adminSetPassword") return adminSetPassword(req, body);
  return json({ error: "Not found." }, 404);
});
