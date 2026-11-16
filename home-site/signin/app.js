// EqNetwork sign-in: authenticates with the same account the desktop app uses,
// then hands off to the dashboard at /account.
(() => {
  "use strict";

  const CLOUD_URL = "https://bswzptrmeeobbnthjioz.supabase.co";
  const CLOUD_KEY = "sb_publishable_efMWSpsdDD8crieaCVSlow_PGXONxdi";
  const SESSION_KEY = "eqnetwork-account-session";

  const $ = (id) => document.getElementById(id);

  function saveSession(s) {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    } catch {
      /* private window or storage blocked: the session just won't survive a reload */
    }
  }

  function loadSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || typeof s.accessToken !== "string" || typeof s.expiresAt !== "number") return null;
      if (s.expiresAt - Date.now() < 30_000) return null; // treat as expired a little early
      return s;
    } catch {
      return null;
    }
  }

  async function login(username, password) {
    const res = await fetch(`${CLOUD_URL}/functions/v1/account`, {
      method: "POST",
      headers: { apikey: CLOUD_KEY, Authorization: `Bearer ${CLOUD_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "login", username, password }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || out.error) throw new Error(out.error || "Wrong username or password.");
    return {
      accessToken: out.access_token,
      username: out.username || username,
      expiresAt: Date.now() + (out.expires_in ?? 3600) * 1000,
    };
  }

  function wireLogin() {
    $("login-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const username = $("login-username").value.trim();
      const password = $("login-password").value;
      const btn = $("login-submit");
      const err = $("login-error");
      err.hidden = true;
      btn.disabled = true;
      btn.textContent = "Signing in…";
      try {
        const session = await login(username, password);
        if (!session.accessToken) throw new Error("Confirm your email first, then sign in again.");
        saveSession(session);
        window.location.href = "/account";
      } catch (ex) {
        err.textContent = ex instanceof Error ? ex.message : String(ex);
        err.hidden = false;
        btn.disabled = false;
        btn.textContent = "Sign in";
      }
    });
  }

  function init() {
    if (loadSession()) {
      window.location.href = "/account";
      return;
    }
    wireLogin();
  }

  init();
})();
