import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Switch } from "@/components/ui/Switch";
import { adminRemoveShared, CloudError, listProfiles, listShared, setProfileFlags, type AdminProfile, type SharedItem } from "@/lib/cloud";

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

  const refresh = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([listProfiles(), listShared()]);
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

  async function act(key: string, task: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await task();
      await refresh();
    } catch (e) {
      setError(e instanceof CloudError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const toggleDisabled = (p: AdminProfile) => act(`d:${p.userId}`, () => setProfileFlags(p.userId, { disabled: !p.disabled }));
  const toggleAdmin = (p: AdminProfile) => act(`a:${p.userId}`, () => setProfileFlags(p.userId, { isAdmin: !p.isAdmin }));
  const removeShared = (s: SharedItem) => act(`r:${s.id}`, () => adminRemoveShared(s.id));

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
          <h2 className="text-sm font-semibold text-text">Everything shared</h2>
          <p className="mt-1 text-xs text-muted">Every tunnel, filter and IP Storage list anyone has shared with every account. Removing one here takes it out of the shared library, even if you&apos;re not the owner (copies people already added stay with them).</p>
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
