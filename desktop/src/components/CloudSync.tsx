import { FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { CloudError, GLOBAL_FILTERS_SYNCED, loadSession, renameUser, signOut, syncNow, type CloudSession } from "@/lib/cloud";
import { SharedLibrary } from "@/components/SharedLibrary";
import { BackupCard } from "@/components/BackupCard";

const when = (t: number | null) => (t ? new Date(t).toLocaleString() : "not yet");
const USERNAME = /^[A-Za-z0-9_.-]{3,24}$/;
const USERNAME_HINT = "3 to 24 letters, numbers, dots, dashes or underscores. Usernames are unique.";

/**
 * Settings card for the account you're signed in as. Signing in itself happens before the app
 * opens at all (see AuthGate) — this is just account management: rename, sync now, sign out.
 */
export function CloudSync() {
  const [session, setSession] = useState<CloudSession | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    loadSession().then(setSession).catch(() => {});
  }, []);

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await task();
    } catch (err) {
      setError(err instanceof CloudError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const syncAgain = () =>
    run(async () => {
      const r = await syncNow();
      setNote([`Synced. ${r.added} added here, ${r.sent} sent, ${r.removed} removed from the account.`, ...r.notes].join(" "));
      setSession(await loadSession());
    });

  const rename = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      if (!USERNAME.test(newName.trim())) throw new CloudError(`Username: ${USERNAME_HINT}`);
      setSession(await renameUser(newName.trim()));
      setNewName("");
      setNote("Username changed.");
    });
  };

  const leave = () =>
    run(async () => {
      await signOut();
      setSession(null);
      window.dispatchEvent(new Event(GLOBAL_FILTERS_SYNCED));
    });

  if (!session) return null; // AuthGate keeps this unreachable without a signed-in, approved account

  return (
    <>
      <Card className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-text">Account</h2>
          <p className="mt-1 text-xs text-muted">
            IP Storage, filters and VPN tunnels stay the same on every computer you sign in on. Everything is private to your
            account unless you share a tunnel, filter or IP address below. A VPN tunnel contains its private key, so only sign
            in on computers you trust.
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

        <div className="space-y-4">
          <p className="text-xs text-muted">
            Signed in as <span className="font-semibold text-text">{session.username || session.email}</span>
            {session.username && <span> · {session.email}</span>}
          </p>
          <p className="text-xs text-muted">Last sync: {when(session.lastSync)}</p>
          <form className="flex flex-wrap items-end gap-3" onSubmit={rename}>
            <div className="min-w-[12rem] flex-1">
              <Input
                label="Change username"
                value={newName}
                maxLength={24}
                placeholder={session.username}
                autoComplete="off"
                onChange={(e) => setNewName(e.target.value)}
                hint={USERNAME_HINT}
              />
            </div>
            <Button type="submit" size="sm" variant="secondary" loading={busy} disabled={!newName.trim()}>
              Save username
            </Button>
          </form>
          <div className="flex flex-wrap gap-3">
            <Button size="sm" variant="secondary" onClick={syncAgain} loading={busy}>
              Sync now
            </Button>
            <Button size="sm" variant="secondary" onClick={leave}>
              Sign out
            </Button>
          </div>
        </div>
      </Card>
      <SharedLibrary session={session} />
      <BackupCard />
    </>
  );
}
