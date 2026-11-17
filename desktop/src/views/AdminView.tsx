import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { toast } from "@/components/ui/Toast";
import { Switch } from "@/components/ui/Switch";
import { addHiddenIp, adminRemoveShared, CloudError, listHiddenIps, removeHiddenIp, type HiddenIp, listProfiles, listShared, setProfileFlags, setProfileStorage, type AdminProfile, type SharedItem } from "@/lib/cloud";

const when = (t: number) => (t ? new Date(t).toLocaleDateString() : "unknown");

function sharedSummary(s: SharedItem): string {
  if (s.kind !== "ip") return s.name;
  try {
    const parsed = JSON.parse(s.body) as unknown;
    const count = Array.isArray(parsed) ? parsed.length : 1;
    return `IP Storage (${count} address${count === 1 ? "" : "es"})`;
  } catch {
    return s.name;
  }
}

/** Admin only: every signed-up account, and everything anyone has shared. Hidden from the nav for anyone else. */
export function AdminView() {
  const [profiles, setProfiles] = useState<AdminProfile[]>([]);
  const [shared, setShared] = useState<SharedItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [hidden, setHidden] = useState<HiddenIp[]>([]);
  const [hideAddr, setHideAddr] = useState("");
  const [hideNote, setHideNote] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [p, s, h] = await Promise.all([listProfiles(), listShared(), listHiddenIps()]);
      setHidden(h);
      setProfiles(p);
      setShared(s);
    } catch (e) {
      setError(e instanceof CloudError ? e.message : String(e));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function act(key: string, task: () => Promise<void>, done?: string) {
    setBusy(key);
    setError(null);
    try {
      await task();
      await refresh();
      if (done) toast(done);
    } catch (e) {
      setError(e instanceof CloudError ? e.message : String(e));
      toast(e instanceof CloudError ? e.message : String(e), { kind: "error" });
    } finally {
      setBusy(null);
    }
  }

  const toggleDisabled = (p: AdminProfile) => act(`d:${p.userId}`, () => setProfileFlags(p.userId, { disabled: !p.disabled }), `${p.disabled ? "Enabled" : "Disabled"} ${p.username || "the account"}`);
  const toggleAdmin = (p: AdminProfile) => act(`a:${p.userId}`, () => setProfileFlags(p.userId, { isAdmin: !p.isAdmin }), p.isAdmin ? `${p.username || "Account"} is no longer an admin` : `${p.username || "Account"} is now an admin`);
  const setStorage = (p: AdminProfile, access: AdminProfile["storageAccess"]) => act(`s:${p.userId}`, () => setProfileStorage(p.userId, access), `Shared IP Storage for ${p.username || "the account"}: ${access === "none" ? "none" : access === "read" ? "read only" : "add and edit"}`);
  const removeShared = (s: SharedItem) => act(`r:${s.id}`, () => adminRemoveShared(s.id), "Removed from the shared library");

  const addHidden = () => {
    const address = hideAddr.trim();
    if (!/^[0-9a-fA-F:.]{2,45}$/.test(address) || !/[.:]/.test(address)) {
      toast("Enter a valid IPv4 or IPv6 address.", { kind: "error" });
      return;
    }
    void act("h:add", () => addHiddenIp(address, hideNote.trim().slice(0, 80)), `${address} is now always hidden for every account`).then(() => {
      setHideAddr("");
      setHideNote("");
    });
  };
  const unhide = (h: HiddenIp) => act(`h:${h.address}`, () => removeHiddenIp(h.address), `${h.address} is no longer hidden`);

  return (
    <div className="space-y-6">
      <Card className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-text">Accounts</h2>
          <p className="mt-1 text-xs text-muted">
            Every signed-up account. Disabling one blocks it everywhere: it can&apos;t sign in again, and the database refuses its
            reads and writes on any computer it&apos;s already signed in on.
          </p>
        </div>

        {error && (
          <p role="alert" className="rounded-md border border-danger px-3 py-2 text-xs text-danger">
            {error}
          </p>
        )}

        {!loaded ? (
          <p className="text-xs text-muted">Loading…</p>
        ) : profiles.length === 0 ? (
          <p className="text-xs text-muted">No accounts found.</p>
        ) : (
          <ul className="space-y-2">
            {profiles.map((p) => (
              <li key={p.userId} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm text-text">
                <span className="truncate">
                  <span className="font-semibold">{p.username}</span>
                  <span className="text-xs text-muted"> · joined {when(p.createdAt)}</span>
                  {p.disabled && <span className="text-xs text-danger"> · disabled</span>}
                </span>
                <div className="flex items-center gap-4">
                  {!p.isAdmin && (
                    <label className="flex items-center gap-2 text-xs text-muted" title="What this account can do with your shared IP Storage. Accounts without access keep their IP Storage on their own computer only.">
                      Shared IP Storage
                      <select
                        value={p.storageAccess}
                        disabled={busy === `s:${p.userId}`}
                        onChange={(e) => void setStorage(p, e.target.value as AdminProfile["storageAccess"])}
                        aria-label={`Shared IP Storage access for ${p.username}`}
                        className="h-8 rounded-md border border-border-input bg-white/[0.06] px-2 text-xs text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
                      >
                        <option value="none">None</option>
                        <option value="read">Read only</option>
                        <option value="edit">Add and edit</option>
                      </select>
                    </label>
                  )}
                  <label className="flex items-center gap-2 text-xs text-muted">
                    Admin
                    <Switch label={`Admin: ${p.username}`} checked={p.isAdmin} disabled={busy === `a:${p.userId}`} onChange={() => toggleAdmin(p)} />
                  </label>
                  <Button size="sm" variant={p.disabled ? "secondary" : "danger"} loading={busy === `d:${p.userId}`} onClick={() => toggleDisabled(p)}>
                    {p.disabled ? "Enable" : "Disable"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-text">Always hidden IPs</h2>
          <p className="mt-1 text-xs text-muted">These addresses are never saved to IP Storage and never appear in Capture (IP lists, traffic or exports) on any account. Adding one also removes it from IP Storage on every computer at its next sync.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-48"><Input label="IP address" value={hideAddr} onChange={(e) => setHideAddr(e.target.value)} placeholder="82.6.13.150" onKeyDown={(e) => e.key === "Enter" && addHidden()} /></div>
          <div className="w-56"><Input label="Note (optional)" value={hideNote} onChange={(e) => setHideNote(e.target.value)} maxLength={80} onKeyDown={(e) => e.key === "Enter" && addHidden()} /></div>
          <Button size="sm" loading={busy === "h:add"} onClick={addHidden}>Hide it</Button>
        </div>
        {hidden.length === 0 ? (
          <p className="text-xs text-muted">No address is hidden.</p>
        ) : (
          <ul className="space-y-2">
            {hidden.map((h) => (
              <li key={h.address} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm text-text">
                <span className="truncate"><span className="font-mono">{h.address}</span>{h.note && <span className="text-xs text-muted"> · {h.note}</span>}</span>
                <Button size="sm" variant="secondary" loading={busy === `h:${h.address}`} onClick={() => unhide(h)}>Stop hiding</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-text">Everything shared</h2>
          <p className="mt-1 text-xs text-muted">Every tunnel and IP Storage list anyone has shared. Removing one here takes it out of the shared library, even if you&apos;re not the owner (copies people already added stay with them).</p>
        </div>

        {shared.length === 0 ? (
          <p className="text-xs text-muted">Nobody has shared anything.</p>
        ) : (
          <ul className="space-y-2">
            {shared.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm text-text">
                <span className="truncate">
                  <span className="text-xs text-muted">{s.kind === "tunnel" ? "Tunnel" : s.kind === "ip" ? "IP" : "Filter"} · </span>
                  {sharedSummary(s)}
                  <span className="text-xs text-muted"> by {s.ownerName || "unknown"}</span>
                </span>
                <Button size="sm" variant="danger" loading={busy === `r:${s.id}`} onClick={() => removeShared(s)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
