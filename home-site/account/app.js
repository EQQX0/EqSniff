// EqNetwork Account dashboard: view-only. Signs in with the same account the desktop app uses,
// then shows IP Storage, filters and basic account info. Nothing here writes anything back.
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

  function clearSession() {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* nothing to clear */
    }
  }

  async function call(path, token, init = {}) {
    const res = await fetch(`${CLOUD_URL}${path}`, {
      ...init,
      headers: {
        apikey: CLOUD_KEY,
        Authorization: `Bearer ${token ?? CLOUD_KEY}`,
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || body.msg || body.message || `The server answered with status ${res.status}.`);
    }
    return res;
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

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  const splitList = (t) => String(t || "").split(",").map((x) => x.trim()).filter(Boolean);

  /** Short plain-language summary of a filter, mirroring the app's own `describe()`. */
  function describeFilter(f) {
    const side = f.direction === "from" ? "source " : f.direction === "to" ? "destination " : "";
    const parts = [
      f.protocol && f.protocol !== "any" && f.protocol,
      f.port && `${side}port ${f.port}`,
      f.address && `${side}address ${splitList(f.address).join(", ")}`,
      f.countries && `country ${splitList(f.countries).map((c) => c.toUpperCase()).join(", ")}`,
      f.isps && `ISP ${splitList(f.isps).join(", ")}`,
      f.minBytes && `${f.minBytes}+ bytes`,
      f.maxBytes && `up to ${f.maxBytes} bytes`,
      f.hex && `contains ${splitList(f.hex).join(" or ")}`,
    ].filter(Boolean);
    return parts.length ? parts.join(" · ") : "Matches everything";
  }

  function renderIps(entries) {
    const wrap = $("ips-table-wrap");
    const live = entries.filter((e) => !e.deleted);
    if (live.length === 0) {
      wrap.innerHTML = '<p class="empty">No saved addresses yet. Add one in the app’s IP Storage page.</p>';
      return;
    }
    const rows = live
      .map(
        (e) => `
      <tr>
        <td data-label="Address" class="mono">${escapeHtml(e.address)}</td>
        <td data-label="Label">${escapeHtml(e.label) || '<span style="opacity:.6">No label</span>'}</td>
        <td data-label="Updated">${fmtDate(e.updated_at)}</td>
      </tr>`
      )
      .join("");
    wrap.innerHTML = `
      <table>
        <thead><tr><th>Address</th><th>Label</th><th>Updated</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  function renderFilters(filters) {
    const wrap = $("filters-table-wrap");
    if (!filters || filters.length === 0) {
      wrap.innerHTML = '<p class="empty">No filters saved yet. Create one in the app’s Filters page.</p>';
      return;
    }
    const rows = filters
      .map(
        (f) => `
      <tr>
        <td data-label="Name">${escapeHtml(f.name) || '<span style="opacity:.6">Untitled</span>'}</td>
        <td data-label="Status"><span class="pill ${f.enabled ? "on" : "off"}">${f.enabled ? "On" : "Off"}</span></td>
        <td data-label="Mode"><span class="pill ${f.mode === "hide" ? "hide" : "show"}">${f.mode === "hide" ? "Hide" : "Show"}</span></td>
        <td data-label="Matches">${escapeHtml(describeFilter(f))}</td>
      </tr>`
      )
      .join("");
    wrap.innerHTML = `
      <table>
        <thead><tr><th>Name</th><th>Status</th><th>Mode</th><th>Matches</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  function maskEmail(email) {
    const at = String(email || "").indexOf("@");
    if (at <= 1) return email || "";
    return `${email.slice(0, 2)}…${email.slice(at)}`;
  }

  function renderAccount(profile) {
    const el = $("account-info");
    el.innerHTML = `
      <table>
        <tbody>
          <tr><td data-label="Field">Username</td><td data-label="Value">${escapeHtml(profile.username || "")}</td></tr>
          <tr><td data-label="Field">Account created</td><td data-label="Value">${fmtDate(profile.created_at)}</td></tr>
          <tr><td data-label="Field">Role</td><td data-label="Value">${profile.is_admin ? '<span class="pill on">Admin</span>' : "Standard"}</td></tr>
        </tbody>
      </table>`;
  }

  function showLogin(message) {
    $("login-screen").hidden = false;
    $("app-shell").hidden = true;
    const err = $("login-error");
    if (message) {
      err.textContent = message;
      err.hidden = false;
    } else {
      err.hidden = true;
    }
  }

  function showApp() {
    $("login-screen").hidden = true;
    $("app-shell").hidden = false;
  }

  function setTab(name) {
    const tabs = { ips: $("tab-ips"), filters: $("tab-filters"), account: $("tab-account") };
    const panels = { ips: $("panel-ips"), filters: $("panel-filters"), account: $("panel-account") };
    for (const key of Object.keys(tabs)) {
      const active = key === name;
      tabs[key].setAttribute("aria-selected", String(active));
      panels[key].hidden = !active;
    }
  }

  async function loadDashboard(session) {
    $("who-username").textContent = session.username;
    $("loading").hidden = false;
    $("content").hidden = true;
    $("data-error").hidden = true;
    try {
      const [profileRes, ipsRes, filtersRes] = await Promise.all([
        call("/rest/v1/profiles?select=username,is_admin,created_at&limit=1", session.accessToken),
        call("/rest/v1/ip_entries?select=address,label,updated_at,deleted&deleted=eq.false&order=updated_at.desc&limit=1000", session.accessToken),
        call("/rest/v1/sync_items?kind=eq.filters&name=eq.all&deleted=eq.false&select=body&limit=1", session.accessToken),
      ]);
      const [profileRows, ips, filterRows] = await Promise.all([profileRes.json(), ipsRes.json(), filtersRes.json()]);
      const profile = profileRows[0] || { username: session.username, is_admin: false, created_at: null };
      $("who-admin").hidden = !profile.is_admin;

      let filters = [];
      if (filterRows[0]?.body) {
        try {
          const parsed = JSON.parse(filterRows[0].body);
          if (Array.isArray(parsed)) filters = parsed;
        } catch {
          /* leave filters empty if the saved body is damaged */
        }
      }

      renderAccount(profile);
      renderIps(ips);
      renderFilters(filters);

      $("loading").hidden = true;
      $("content").hidden = false;
    } catch (e) {
      $("loading").hidden = true;
      const err = $("data-error");
      err.textContent = e instanceof Error ? e.message : String(e);
      err.hidden = false;
    }
  }

  function wireTabs() {
    $("tab-ips").addEventListener("click", () => setTab("ips"));
    $("tab-filters").addEventListener("click", () => setTab("filters"));
    $("tab-account").addEventListener("click", () => setTab("account"));
  }

  function wireSignOut() {
    $("sign-out").addEventListener("click", () => {
      clearSession();
      showLogin();
      $("login-form").reset();
    });
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
        showApp();
        setTab("ips");
        await loadDashboard(session);
      } catch (ex) {
        err.textContent = ex instanceof Error ? ex.message : String(ex);
        err.hidden = false;
      } finally {
        btn.disabled = false;
        btn.textContent = "Sign in";
      }
    });
  }

  function init() {
    wireLogin();
    wireSignOut();
    wireTabs();
    const existing = loadSession();
    if (existing) {
      showApp();
      setTab("ips");
      loadDashboard(existing);
    } else {
      showLogin();
    }
  }

  init();
})();
