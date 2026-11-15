import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { api } from "@/lib/api";
import { CloudError, FILTERS_SYNCED, listShared, shareItem, unshareItem, type CloudSession, type SharedItem } from "@/lib/cloud";
import { fromStored, newId, type Filter } from "@/lib/filters";
import { loadEntries, newEntryId, saveEntries, type IpEntry } from "@/lib/ipstore";

type Kind = "tunnel" | "filter" | "ip";

/** A tunnel name that is free on this computer: the shared name, then the owner's name added, then a number. */
function freeName(want: string, owner: string, taken: Set<string>): string {
  const clean = (s: string) => s.replace(/[^A-Za-z0-9_=+.-]/g, "-");
  const tries = [clean(want), clean(`${want}-${owner}`)].map((s) => s.slice(0, 32));
  for (const t of tries) if (t && !taken.has(t)) return t;
  for (let i = 2; i < 100; i++) {
    const t = `${tries[0].slice(0, 28)}-${i}`;
    if (!taken.has(t)) return t;
  }
  return `${tries[0].slice(0, 24)}-${Date.now() % 100000}`;
}

/**
 * Tunnels, filters and IP addresses you choose to share are visible to every signed-in account, which can add a copy to its own list.
 * Nothing is shared unless chosen. A shared tunnel includes its private key: share a config meant for others to use.
 */
export function SharedLibrary({ session }: { session: CloudSession }) {
  const [shared, setShared] = useState<SharedItem[]>([]);
  const [tunnels, setTunnels] = useState<string[]>([]);
  const [filters, setFilters] = useState<Filter[]>([]);
  const [ips, setIps] = useState<IpEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [list, mine, raw, ipList] = await Promise.all([listShared(), api.vpnSyncList(), api.getFilters(), loadEntries()]);
      setIps(ipList);
      setShared(list);
      setTunnels(mine.map((t) => t.name));
      setFilters(fromStored(raw));
    } catch (e) {
      setError(e instanceof CloudError ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const isShared = (kind: Kind, name: string) => shared.some((s) => s.ownerId === session.userId && s.kind === kind && s.name === name);

  async function act(key: string, task: () => Promise<void>, done: string) {
    setBusy(key);
    setError(null);
    setNote(null);
    try {
      await task();
      setNote(done);
      await refresh();
    } catch (e) {
      setError(e instanceof CloudError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const toggleTunnel = (name: string) =>
    act(
      `t:${name}`,
      async () => (isShared("tunnel", name) ? unshareItem("tunnel", name) : shareItem("tunnel", name, await api.vpnSyncRead(name))),
      isShared("tunnel", name) ? `Stopped sharing ${name}.` : `${name} is now shared with every account.`
    );

  const toggleFilter = (f: Filter) =>
    act(
      `f:${f.name}`,
      async () => (isShared("filter", f.name) ? unshareItem("filter", f.name) : shareItem("filter", f.name, JSON.stringify({ ...f, enabled: false }))),
      isShared("filter", f.name) ? `Stopped sharing ${f.name}.` : `${f.name} is now shared with every account.`
    );

  const toggleIp = (e: IpEntry) =>
    act(
      `i:${e.address}`,
      async () => (isShared("ip", e.address) ? unshareItem("ip", e.address) : shareItem("ip", e.address, JSON.stringify({ address: e.address, note: e.note }))),
      isShared("ip", e.address) ? `Stopped sharing ${e.address}.` : `${e.address} and its label are now shared with every account.`
    );

  const add = (item: SharedItem) =>
    act(
      `a:${item.id}`,
      async () => {
        if (item.kind === "ip") {
          const got = JSON.parse(item.body) as { address?: string; note?: string };
          if (!got.address) throw new CloudError("That shared address is damaged.");
          const list = await loadEntries();
          if (list.some((e) => e.address === got.address)) throw new CloudError(`${got.address} is already in your IP Storage.`);
          await saveEntries([...list, { id: newEntryId(), address: got.address, note: String(got.note ?? "").slice(0, 500), createdAt: Date.now() }], list);
        } else if (item.kind === "tunnel") {
          const here = new Set((await api.vpnSyncList()).map((t) => t.name));
          await api.vpnSyncWrite(freeName(item.name, item.ownerName, here), item.body);
        } else {
          const parsed = fromStored([JSON.parse(item.body)])[0];
          if (!parsed) throw new CloudError("That shared filter is damaged.");
          const list = fromStored(await api.getFilters());
          await api.saveFilters([...list, { ...parsed, id: newId(), enabled: false }]);
          window.dispatchEvent(new Event(FILTERS_SYNCED));
        }
      },
      `Added ${item.name} to your ${item.kind === "tunnel" ? "VPN tunnels" : item.kind === "ip" ? "IP Storage" : "filters"}.${item.kind === "filter" ? " Filters are added switched off." : ""}`
    );

  const others = shared.filter((s) => s.ownerId !== session.userId);

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-text">Share with other accounts</h2>
        <p className="mt-1 text-xs text-muted">
          Choose a tunnel, filter or IP address to make it visible to every signed-in account, so they can add their own copy. Stop sharing
          at any time (copies people already made stay with them). A shared tunnel includes its
          private key, so share a config you made for other people to use. A shared IP shows its address and label to every
          signed-in account, so share only addresses you are happy to publish. Nothing is shared unless you press Share.
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-danger px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}
      {note && (
        <p role="status" className="rounded-md border border-border bg-black/25 px-3 py-2 text-xs text-text">
          {note}
        </p>
      )}

      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Yours</h3>
        {tunnels.length === 0 && filters.length === 0 && ips.length === 0 ? (
          <p className="text-xs text-muted">Nothing to share yet. Add a tunnel, filter or IP address first.</p>
        ) : (
          <ul className="space-y-2">
            {tunnels.map((n) => (
              <li key={`t:${n}`} className="flex items-center justify-between gap-3 text-sm text-text">
                <span className="truncate">
                  <span className="text-xs text-muted">Tunnel · </span>
                  {n}
                </span>
                <Button size="sm" variant="secondary" loading={busy === `t:${n}`} onClick={() => toggleTunnel(n)}>
                  {isShared("tunnel", n) ? "Stop sharing" : "Share"}
                </Button>
              </li>
            ))}
            {ips.map((e) => (
              <li key={`i:${e.address}`} className="flex items-center justify-between gap-3 text-sm text-text">
                <span className="truncate">
                  <span className="text-xs text-muted">IP · </span>
                  {e.address}
                  {e.note && <span className="text-xs text-muted"> ({e.note})</span>}
                </span>
                <Button size="sm" variant="secondary" loading={busy === `i:${e.address}`} onClick={() => toggleIp(e)}>
                  {isShared("ip", e.address) ? "Stop sharing" : "Share"}
                </Button>
              </li>
            ))}
            {filters.map((f) => (
              <li key={`f:${f.id}`} className="flex items-center justify-between gap-3 text-sm text-text">
                <span className="truncate">
                  <span className="text-xs text-muted">Filter · </span>
                  {f.name}
                </span>
                <Button size="sm" variant="secondary" loading={busy === `f:${f.name}`} onClick={() => toggleFilter(f)}>
                  {isShared("filter", f.name) ? "Stop sharing" : "Share"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Shared by other accounts</h3>
        {others.length === 0 ? (
          <p className="text-xs text-muted">Nobody has shared anything yet.</p>
        ) : (
          <ul className="space-y-2">
            {others.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 text-sm text-text">
                <span className="truncate">
                  <span className="text-xs text-muted">{s.kind === "tunnel" ? "Tunnel" : s.kind === "ip" ? "IP" : "Filter"} · </span>
                  {s.name}
                  {s.kind === "ip" && (() => { try { const n = (JSON.parse(s.body) as { note?: string }).note; return n ? <span className="text-xs text-muted"> ({n})</span> : null; } catch { return null; } })()}
                  <span className="text-xs text-muted"> by {s.ownerName || "unknown"}</span>
                </span>
                <Button size="sm" variant="secondary" loading={busy === `a:${s.id}`} onClick={() => add(s)}>
                  Add to mine
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
