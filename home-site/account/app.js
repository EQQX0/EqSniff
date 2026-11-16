// EqNetwork Account dashboard. Signing in happens on /signin; this page only reads the
// session it left behind. Shows IP Storage, filters and account info; admins also get an
// Admin tab to manage other accounts, mirroring the desktop app's own admin panel.
(() => {
  "use strict";

  const CLOUD_URL = "https://bswzptrmeeobbnthjioz.supabase.co";
  const CLOUD_KEY = "sb_publishable_efMWSpsdDD8crieaCVSlow_PGXONxdi";
  const SESSION_KEY = "eqnetwork-account-session";

  const $ = (id) => document.getElementById(id);

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

  function setTab(name) {
    const tabs = { ips: $("tab-ips"), filters: $("tab-filters"), account: $("tab-account"), admin: $("tab-admin") };
    const panels = { ips: $("panel-ips"), filters: $("panel-filters"), account: $("panel-account"), admin: $("panel-admin") };
    for (const key of Object.keys(tabs)) {
      const active = key === name;
      tabs[key].setAttribute("aria-selected", String(active));
      panels[key].hidden = !active;
    }
  }

  function renderAdminTable(profiles, token) {
    const wrap = $("admin-table-wrap");
    if (!profiles.length) {
      wrap.innerHTML = '<p class="empty">No accounts found.</p>';
      return;
    }
    const rows = profiles
      .map(
        (p) => `
      <tr data-user-id="${escapeHtml(p.user_id)}">
        <td data-label="Username">${escapeHtml(p.username)}</td>
        <td data-label="Created">${fmtDate(p.created_at)}</td>
        <td data-label="Admin"><button class="btn secondary admin-toggle" type="button" data-field="is_admin" data-value="${!p.is_admin}">${p.is_admin ? "Revoke admin" : "Make admin"}</button></td>
        <td data-label="Access"><button class="btn secondary admin-toggle" type="button" data-field="disabled" data-value="${!p.disabled}">${p.disabled ? "Enable" : "Disable"}</button></td>
      </tr>`
      )
      .join("");
    wrap.innerHTML = `
      <table>
        <thead><tr><th>Username</th><th>Created</th><th>Admin</th><th>Access</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;

    wrap.querySelectorAll(".admin-toggle").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const row = btn.closest("tr");
        const userId = row.getAttribute("data-user-id");
        const field = btn.getAttribute("data-field");
        const value = btn.getAttribute("data-value") === "true";
        const label = field === "is_admin" ? (value ? "make this account an admin" : "revoke admin from this account") : value ? "disable this account" : "re-enable this account";
        if (!window.confirm(`Are you sure you want to ${label}?`)) return;
        btn.disabled = true;
        try {
          await call(`/rest/v1/profiles?user_id=eq.${userId}`, token, {
            method: "PATCH",
            headers: { Prefer: "return=minimal" },
            body: JSON.stringify({ [field]: value }),
          });
          await loadAdmin(token);
        } catch (e) {
          window.alert(e instanceof Error ? e.message : String(e));
          btn.disabled = false;
        }
      });
    });
  }

  async function loadAdmin(token) {
    const wrap = $("admin-table-wrap");
    wrap.innerHTML = '<p class="empty">Loading accounts…</p>';
    try {
      const res = await call("/rest/v1/profiles?select=user_id,username,is_admin,disabled,created_at&order=created_at.asc&limit=1000", token);
      renderAdminTable(await res.json(), token);
    } catch (e) {
      wrap.innerHTML = `<p class="error-text">${escapeHtml(e instanceof Error ? e.message : String(e))}</p>`;
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
      $("tab-admin").hidden = !profile.is_admin;
      if (profile.is_admin) loadAdmin(session.accessToken);

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
    $("tab-admin").addEventListener("click", () => setTab("admin"));
  }

  function wireSignOut() {
    $("sign-out").addEventListener("click", () => {
      clearSession();
      window.location.href = "/signin";
    });
  }

  function init() {
    const session = loadSession();
    if (!session) {
      window.location.href = "/signin";
      return;
    }
    $("app-shell").hidden = false;
    wireSignOut();
    wireTabs();
    setTab("ips");
    loadDashboard(session);
  }

  init();
})();
