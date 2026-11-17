import { toast } from "@/components/ui/Toast";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { api } from "@/lib/api";
import { CloudError, findUserByUsername, listShared, shareItem, unshareItem, type CloudSession, type SharedItem } from "@/lib/cloud";
import { Input } from "@/components/ui/Input";

type Kind = "tunnel";

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
 * Tunnels and IP addresses you choose to share are visible to every signed-in account, which can add a copy to its own list.
 * Nothing is shared unless chosen. A shared tunnel includes its private key: share a config meant for others to use.
 */
export function SharedLibrary({ session }: { session: CloudSession }) {
  const [shared, setShared] = useState<SharedItem[]>([]);
  const [tunnels, setTunnels] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Who the Share buttons send to: nobody typed = every account, otherwise just that one account.
  const [target, setTarget] = useState("");
  const [recipient, setRecipient] = useState<{ userId: string; username: string } | null>(null);
  const [names, setNames] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem("eq-share-names") ?? "{}") as Record<string, string>;
    } catch {
      return {};
    }
  });

  const refresh = useCallback(async () => {
    try {
      const [list, mine] = await Promise.all([listShared(), api.vpnSyncList()]);
      setShared(list);
      setTunnels(mine.map((t) => t.name));
    } catch (e) {
      setError(e instanceof CloudError ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const rid = recipient?.userId ?? null;
  const isShared = (kind: Kind, name: string) =>
    shared.some((s) => s.ownerId === session.userId && s.kind === kind && s.name === name && s.recipientId === rid);
  const toWhom = recipient ? recipient.username : "every account";
  // The Share buttons wait until a typed username has been looked up.
  const targetPending = target.trim() !== "" && recipient?.username.toLowerCase() !== target.trim().toLowerCase();

  async function lookUp() {
    const t = target.trim();
    setError(null);
    if (t === "") {
      setRecipient(null);
      return;
    }
    try {
      const found = await findUserByUsername(t);
      if (!found) throw new CloudError(`No account is named “${t}”.`);
      if (found.userId === session.userId) throw new CloudError("That is your own account.");
      setRecipient(found);
      setTarget(found.username);
      const next = { ...names, [found.userId]: found.username };
      setNames(next);
      try {
        localStorage.setItem("eq-share-names", JSON.stringify(next));
      } catch {
        /* the name label is only a convenience */
      }
    } catch (e) {
      setRecipient(null);
      setError(e instanceof CloudError ? e.message : String(e));
    }
  }

  async function act(key: string, task: () => Promise<string | void>, done: string) {
    setBusy(key);
    setError(null);
    setNote(null);
    try {
      const result = await task();
      setNote(result ?? done);
      toast(result ?? done);
      await refresh();
    } catch (e) {
      setError(e instanceof CloudError ? e.message : String(e));
      toast(e instanceof CloudError ? e.message : String(e), { kind: "error" });
    } finally {
      setBusy(null);
    }
  }

  const toggleTunnel = (name: string) =>
    act(
      `t:${name}`,
      async () => (isShared("tunnel", name) ? unshareItem("tunnel", name, rid) : shareItem("tunnel", name, await api.vpnSyncRead(name), rid)),
      isShared("tunnel", name) ? `Stopped sharing ${name} with ${toWhom}.` : `${name} is now shared with ${toWhom}.`
    );

  const add = (item: SharedItem) =>
    act(
      `a:${item.id}`,
      async () => {
        if (item.kind === "tunnel") {
          const here = new Set((await api.vpnSyncList()).map((t) => t.name));
          await api.vpnSyncWrite(freeName(item.name, item.ownerName, here), item.body);
        } else {
          throw new CloudError("Filters are no longer shared. Ask an admin to publish it as a global filter.");
        }
      },
      `Added ${item.name} to your VPN tunnels.`
    );

  // Filters are not shared any more (an admin can publish one as a global filter instead), so none are listed.
  const others = shared.filter((s) => s.ownerId !== session.userId && s.kind === "tunnel");
  const forMe = others.filter((s) => s.recipientId === session.userId);
  const forEveryone = others.filter((s) => s.recipientId === null);
  const mine = shared.filter((s) => s.ownerId === session.userId && s.recipientId !== null);

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-text">Share with other accounts</h2>
        <p className="mt-1 text-xs text-muted">
          Choose a tunnel to share with every signed-in account, or type one username to share with only that account. They can add their own copy. Stop sharing
          at any time (copies people already made stay with them). A shared tunnel includes its
          private key, so share a config you made for other people to use. Filters and IP Storage are not shared here: an admin can publish a filter as a global filter and can give accounts access to the shared IP Storage. Nothing is shared unless you press Share.
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

      <div className="space-y-1.5">
        <div className="flex items-end gap-2">
          <Input
            label="Share with"
            hideLabel
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            onBlur={() => void lookUp()}
            onKeyDown={(e) => {
              if (e.key === "Enter") void lookUp();
            }}
            placeholder="Leave empty for every account, or type one username"
            maxLength={24}
            autoComplete="off"
            className="max-w-sm"
          />
          <span className="pb-3 text-xs text-muted">{targetPending ? "Press Enter to check the name" : `Buttons below share with ${toWhom}`}</span>
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Yours</h3>
        {tunnels.length === 0 ? (
          <p className="text-xs text-muted">Nothing to share yet. Add a tunnel first.</p>
        ) : (
          <ul className="space-y-2">
            {tunnels.map((n) => (
              <li key={`t:${n}`} className="flex items-center justify-between gap-3 text-sm text-text">
                <span className="truncate">
                  <span className="text-xs text-muted">Tunnel · </span>
                  {n}
                </span>
                <Button size="sm" variant="secondary" disabled={targetPending} loading={busy === `t:${n}`} onClick={() => toggleTunnel(n)}>
                  {isShared("tunnel", n) ? "Stop sharing" : "Share"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {mine.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Shared with one account</h3>
          <ul className="space-y-2">
            {mine.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 text-sm text-text">
                <span className="truncate">
                  <span className="text-xs text-muted">Tunnel · </span>
                  {s.name}
                  <span className="text-xs text-muted"> with {names[s.recipientId!] ?? "one account"}</span>
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={busy === `u:${s.id}`}
                  onClick={() => act(`u:${s.id}`, () => unshareItem(s.kind, s.name, s.recipientId), `Stopped sharing ${s.name}.`)}
                >
                  Stop sharing
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {forMe.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Shared with you</h3>
          <ul className="space-y-2">
            {forMe.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 text-sm text-text">
                <span className="truncate">
                  <span className="text-xs text-muted">Tunnel · </span>
                  {s.name}
                  <span className="text-xs text-muted"> from {s.ownerName || "unknown"}</span>
                </span>
                <Button size="sm" variant="secondary" loading={busy === `a:${s.id}`} onClick={() => add(s)}>
                  Add to mine
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Shared by other accounts</h3>
        {forEveryone.length === 0 ? (
          <p className="text-xs text-muted">Nobody has shared anything yet.</p>
        ) : (
          <ul className="space-y-2">
            {forEveryone.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 text-sm text-text">
                <span className="truncate">
                  <span className="text-xs text-muted">Tunnel · </span>
                  {s.name}
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
