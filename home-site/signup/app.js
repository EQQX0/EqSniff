// EqNetwork account creation: calls the same account edge function the app
// and /signin use, then hands off to the dashboard at /account.
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
      if (s.expiresAt - Date.now() < 30_000) return null;
      return s;
    } catch {
      return null;
    }
  }

  async function signUp(username, email, password) {
    const res = await fetch(`${CLOUD_URL}/functions/v1/account`, {
      method: "POST",
      headers: { apikey: CLOUD_KEY, Authorization: `Bearer ${CLOUD_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "signup", username, email, password }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || out.error) throw new Error(out.error || "Couldn't create that account.");
    if (!out.access_token) return { confirmEmail: true };
    return {
      session: {
        accessToken: out.access_token,
        username: out.username || username,
        expiresAt: Date.now() + (out.expires_in ?? 3600) * 1000,
      },
    };
  }

  function wireSignup() {
    $("signup-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const username = $("signup-username").value.trim();
      const email = $("signup-email").value.trim();
      const password = $("signup-password").value;
      const btn = $("signup-submit");
      const err = $("signup-error");
      const notice = $("signup-notice");
      err.hidden = true;
      notice.hidden = true;
      btn.disabled = true;
      btn.textContent = "Creating account…";
      try {
        const result = await signUp(username, email, password);
        if (result.confirmEmail) {
          notice.textContent = "Check your email to confirm your account, then sign in.";
          notice.hidden = false;
          btn.disabled = false;
          btn.textContent = "Create account";
          return;
        }
        saveSession(result.session);
        window.location.href = "/account";
      } catch (ex) {
        err.textContent = ex instanceof Error ? ex.message : String(ex);
        err.hidden = false;
        btn.disabled = false;
        btn.textContent = "Create account";
      }
    });
  }

  function init() {
    if (loadSession()) {
      window.location.href = "/account";
      return;
    }
    wireSignup();
  }

  init();
})();
