import { useCallback, useEffect, useRef, useState } from "react";
import { api, type VpnStatus, type VpnTunnel } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

const NAME_OK = /^[A-Za-z0-9_=+.-]{1,32}$/;

function nameFromFile(file: string) {
  return file.replace(/\.conf$/i, "").replace(/[^A-Za-z0-9_=+.-]/g, "-").slice(0, 32);
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-3 py-1 text-sm">
      <dt className="text-right text-muted">{label}</dt>
      <dd className="min-w-0 break-all text-text">{children}</dd>
    </div>
  );
}

export function VpnView() {
  const [status, setStatus] = useState<VpnStatus | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"details" | "log">("details");
  const [log, setLog] = useState("");
  const [logError, setLogError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const editBox = useRef<HTMLTextAreaElement>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await api.vpnStatus();
      setStatus(s);
      setSelected((cur) => (cur && s.tunnels.some((t) => t.name === cur) ? cur : s.tunnels[0]?.name ?? null));
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  const tunnel: VpnTunnel | undefined = status?.tunnels.find((t) => t.name === selected);

  const loadLog = useCallback(async () => {
    if (!selected) return;
    try {
      setLog(await api.vpnLog(selected));
      setLogError(null);
    } catch (e) {
      setLogError(String(e));
    }
  }, [selected]);

  const showLog = tab === "log";
  const isActive = tunnel?.active ?? false;
  useEffect(() => {
    if (!showLog) return;
    loadLog();
    if (!isActive) return;
    const id = setInterval(loadLog, 3000);
    return () => clearInterval(id);
  }, [showLog, isActive, loadLog]);

  async function openEdit(name: string) {
    setEditError(null);
    try {
      setDraft(await api.vpnRead(name));
      setEditing(true);
    } catch (e) {
      setError(String(e));
    }
  }

  async function saveEdit(name: string) {
    setSaving(true);
    setEditError(null);
    try {
      await api.vpnUpdate(name, draft);
      setEditing(false);
      await refresh();
    } catch (e) {
      setEditError(String(e));
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (editing) editBox.current?.focus();
  }, [editing]);

  async function run(job: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await job();
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  // Starting or stopping waits for the Windows permission prompt, so the app starts it and checks back.
  async function switchTunnel(name: string, on: boolean) {
    await api.vpnSet(name, on);
    for (;;) {
      await new Promise((r) => setTimeout(r, 400));
      const j = await api.vpnJob();
      if (!j.running) {
        if (j.error) throw j.error;
        return;
      }
    }
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const name = nameFromFile(file.name);
    if (!NAME_OK.test(name)) {
      setError("Rename the file first. Tunnel names use letters, numbers and _ = + . - only.");
      return;
    }
    if (file.size > 16 * 1024) {
      setError("That file is too large to be a WireGuard tunnel.");
      return;
    }
    const text = await file.text();
    await run(async () => {
      await api.vpnImport(name, text);
      setSelected(name);
    });
  }

  return (
    <div className="flex h-full min-h-[28rem] flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-text">VPN</h1>
        <p className="mt-1 text-sm text-muted">
          Keep your WireGuard tunnels here and switch them on and off. The app has its own WireGuard engine, so you do not
          need to install anything else. Windows asks you to allow each start, because creating the network adapter needs
          administrator rights.
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-danger px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[14rem_1fr] gap-4 max-md:grid-cols-1">
        <section aria-label="Tunnels" className="flex min-h-0 flex-col rounded-lg border border-border bg-surface">
          <h2 className="border-b border-border px-4 py-3 text-sm font-semibold text-text">Tunnels</h2>
          <ul className="min-h-0 flex-1 overflow-auto p-2">
            {status?.tunnels.length === 0 && (
              <li className="px-2 py-3 text-xs text-muted">No tunnels yet. Add a WireGuard .conf file.</li>
            )}
            {status?.tunnels.map((t) => (
              <li key={t.name}>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(t.name);
                    setConfirmDelete(false);
                    setEditing(false);
                  }}
                  aria-current={t.name === selected ? "true" : undefined}
                  className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent
                    ${t.name === selected ? "bg-bg text-text" : "text-muted hover:bg-bg hover:text-text"}`}
                >
                  <span
                    aria-hidden="true"
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${t.active ? "bg-success" : "border border-muted"}`}
                  />
                  <span className="min-w-0 flex-1 truncate">{t.name}</span>
                  <span className="sr-only">{t.active ? "active" : "inactive"}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2 border-t border-border p-2">
            <input ref={picker} type="file" accept=".conf" className="hidden" onChange={onPick} aria-label="Choose a WireGuard .conf file" />
            <Button size="sm" variant="secondary" onClick={() => picker.current?.click()} disabled={busy}>
              Add tunnel
            </Button>
            {tunnel &&
              (confirmDelete ? (
                <Button
                  size="sm"
                  variant="danger"
                  disabled={busy || tunnel.active}
                  onClick={() =>
                    run(async () => {
                      await api.vpnDelete(tunnel.name);
                      setConfirmDelete(false);
                    })
                  }
                >
                  Delete {tunnel.name.length > 8 ? "it" : tunnel.name}?
                </Button>
              ) : (
                <Button size="sm" variant="ghost" disabled={busy || tunnel.active} onClick={() => setConfirmDelete(true)}>
                  Delete
                </Button>
              ))}
          </div>
        </section>

        <section aria-label="Tunnel details" className="min-h-0 overflow-auto rounded-lg border border-border bg-surface p-5">
          {!tunnel && <p className="text-sm text-muted">Pick a tunnel on the left, or add one.</p>}
          {tunnel && (
            <div role="tablist" aria-label="Tunnel sections" className="mb-4 flex gap-2">
              {(["details", "log"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  id={`vpn-tab-${t}`}
                  aria-selected={tab === t}
                  aria-controls={`vpn-panel-${t}`}
                  onClick={() => setTab(t)}
                  className={`rounded-md px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent
                    ${tab === t ? "bg-bg font-semibold text-text" : "text-muted hover:bg-bg hover:text-text"}`}
                >
                  {t === "details" ? "Details" : "Log"}
                </button>
              ))}
            </div>
          )}
          {tunnel && tab === "log" && (
            <div role="tabpanel" id="vpn-panel-log" aria-labelledby="vpn-tab-log" className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <Button size="sm" variant="secondary" onClick={loadLog}>
                  Refresh
                </Button>
                <p className="text-xs text-muted">
                  {tunnel.active ? "Updates every 3 seconds while the tunnel is active." : "Shows the last run of this tunnel."}
                </p>
              </div>
              {logError && (
                <p role="alert" className="text-sm text-danger">
                  {logError}
                </p>
              )}
              <pre
                tabIndex={0}
                aria-label={`Log for ${tunnel.name}`}
                className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-bg p-3 text-xs text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {log || "No log yet. It appears after the first time you activate this tunnel."}
              </pre>
            </div>
          )}
          {tunnel && tab === "details" && (
            <div role="tabpanel" id="vpn-panel-details" aria-labelledby="vpn-tab-details" className="space-y-5">
              <div>
                <h2 className="mb-2 text-sm font-semibold text-text">Interface: {tunnel.name}</h2>
                <dl>
                  <Row label="Status">
                    <span role="status">
                      <Badge tone={tunnel.active ? "success" : "neutral"}>{tunnel.active ? "Active" : "Inactive"}</Badge>
                    </span>
                  </Row>
                  <Row label="Public key">{tunnel.publicKey ?? "Not available"}</Row>
                  {tunnel.listenPort && <Row label="Listen port">{tunnel.listenPort}</Row>}
                  {tunnel.mtu && <Row label="MTU">{tunnel.mtu}</Row>}
                  <Row label="Addresses">{tunnel.addresses.join(", ")}</Row>
                  {tunnel.dns.length > 0 && <Row label="DNS servers">{tunnel.dns.join(", ")}</Row>}
                </dl>
                <div className="mt-3 pl-[9.75rem]">
                  <Button
                    size="sm"
                    variant={tunnel.active ? "secondary" : "primary"}
                    loading={busy}
                    onClick={() => run(() => switchTunnel(tunnel.name, !tunnel.active))}
                  >
                    {tunnel.active ? "Deactivate" : "Activate"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-2"
                    disabled={busy || tunnel.active}
                    onClick={() => openEdit(tunnel.name)}
                  >
                    Edit
                  </Button>
                  <label className="mt-3 flex items-start gap-2 text-sm text-text">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 shrink-0 accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      checked={tunnel.killswitch}
                      disabled={busy || tunnel.active}
                      onChange={(e) => run(() => api.vpnSetOption(tunnel.name, e.target.checked))}
                    />
                    <span>
                      Block traffic outside the VPN (kill switch)
                      <span className="block text-xs text-muted">
                        While the tunnel is active, everything that does not use it is blocked, except the VPN server and your
                        local network. If the tunnel drops, traffic stays blocked until you press Deactivate. Change this
                        while the tunnel is off.
                      </span>
                    </span>
                  </label>
                  {tunnel.fullTunnel && !tunnel.active && (
                    <p className="mt-2 text-xs text-muted">
                      This tunnel sends all of your internet traffic through the VPN while it is active.
                    </p>
                  )}
                </div>
              </div>

              {tunnel.peers.map((p, i) => (
                <div key={p.publicKey + i}>
                  <h2 className="mb-2 text-sm font-semibold text-text">Peer{tunnel.peers.length > 1 ? ` ${i + 1}` : ""}</h2>
                  <dl>
                    <Row label="Public key">{p.publicKey}</Row>
                    {p.hasPresharedKey && <Row label="Preshared key">Set (hidden)</Row>}
                    <Row label="Allowed IPs">{p.allowedIps.join(", ") || "none"}</Row>
                    {p.endpoint && <Row label="Endpoint">{p.endpoint}</Row>}
                    {p.keepalive != null && <Row label="Persistent keepalive">{p.keepalive}</Row>}
                  </dl>
                </div>
              ))}
              <p className="text-xs text-muted">
                The private key stays in the saved file on this computer and is never shown here.
              </p>
            </div>
          )}
        </section>
      </div>

      {editing && tunnel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="vpn-edit-title"
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(false);
            }}
            className="flex max-h-full w-full max-w-xl flex-col gap-3 overflow-auto rounded-lg border border-border bg-surface p-5"
          >
            <h2 id="vpn-edit-title" className="text-sm font-semibold text-text">
              Edit tunnel: {tunnel.name}
            </h2>
            <label htmlFor="vpn-edit-text" className="text-xs text-muted">
              WireGuard settings. The private key is hidden. Leave the line PrivateKey = &lt;unchanged&gt; to keep it.
            </label>
            <textarea
              id="vpn-edit-text"
              ref={editBox}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
              rows={16}
              disabled={tunnel.active || saving}
              className="min-h-[12rem] w-full rounded-md border border-border bg-bg p-3 font-mono text-xs text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
            {editError && (
              <p role="alert" className="text-sm text-danger">
                {editError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" loading={saving} disabled={tunnel.active} onClick={() => saveEdit(tunnel.name)}>
                Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
