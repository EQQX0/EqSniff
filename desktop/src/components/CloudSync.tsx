import { FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Switch } from "@/components/ui/Switch";
import { CloudError, hasPassphrase, loadSession, setParts, setPassphrase, signIn, signOut, signUp, syncNow, type CloudSession, type Parts } from "@/lib/cloud";

const PASS_MIN = 8;
const when = (t: number | null) => (t ? new Date(t).toLocaleString() : "not yet");

/** Settings card: sign in to an optional account and keep IP Storage in step between computers. */
export function CloudSync() {
  const [session, setSession] = useState<CloudSession | null>(null);
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"in" | "up" | "sync" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pass, setPass] = useState("");
  const [unlocked, setUnlocked] = useState(hasPassphrase());

  useEffect(() => {
    loadSession()
      .then(setSession)
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  const fail = (e: unknown) => setError(e instanceof CloudError ? e.message : String(e));
  const valid = email.includes("@") && password.length >= 6;

  async function submit(e: FormEvent, mode: "in" | "up") {
    e.preventDefault();
    if (!valid) {
      setError("Enter your email and a password of at least 6 characters.");
      return;
    }
    setBusy(mode);
    setError(null);
    setNote(null);
    try {
      if (mode === "in") {
        setSession(await signIn(email.trim(), password));
      } else {
        const r = await signUp(email.trim(), password);
        if ("session" in r) setSession(r.session);
        else setNote("Account created. Open the email we sent you, confirm the address, then come back and sign in.");
      }
      setPassword("");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  }

  async function toggle(part: keyof Parts, on: boolean) {
    setError(null);
    try {
      setSession(await setParts({ [part]: on }));
      if (on && (part !== "tunnels" || hasPassphrase())) await runSync();
    } catch (err) {
      fail(err);
    }
  }

  async function unlock(e: FormEvent) {
    e.preventDefault();
    if (pass.length < PASS_MIN) {
      setError(`The sync passphrase needs at least ${PASS_MIN} characters.`);
      return;
    }
    setPassphrase(pass);
    setPass("");
    setUnlocked(true);
    await runSync();
  }

  async function runSync() {
    setBusy("sync");
    setError(null);
    try {
      const r = await syncNow();
      setNote([`Synced. ${r.added} added here, ${r.sent} sent, ${r.removed} removed from the account.`, ...r.notes].join(" "));
      setSession(await loadSession());
    } catch (err) {
      fail(err);
      setSession(await loadSession());
    } finally {
      setBusy(null);
    }
  }

  async function leave() {
    setError(null);
    setNote(null);
    try {
      await signOut();
      setUnlocked(false);
      setSession(null);
    } catch (err) {
      fail(err);
    }
  }

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-text">Account sync (optional)</h2>
        <p className="mt-1 text-xs text-muted">
          Keep IP Storage, filters and VPN tunnels the same on every computer you sign in on. Everything is private to your
          account: no other user can see it. Only the parts you switch on are sent, and nothing at all while you are signed out. Skip
          this and the app never connects for it. Do not save anything secret in a label.
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

      {!ready ? null : session ? (
        <div className="space-y-3">
          <p className="text-xs text-muted">
            Signed in as <span className="font-semibold text-text">{session.email}</span>
          </p>
          <p className="text-xs text-muted">Last sync: {when(session.lastSync)}</p>
          <ul className="space-y-3">
            {(
              [
                ["enabled", "IP Storage", "Saved addresses and their labels."],
                ["filters", "Filters", "Your filter list, including which are on."],
                ["tunnels", "VPN tunnels", "Locked on this computer with your sync passphrase before upload, so the server cannot read the keys."],
              ] as [keyof Parts, string, string][]
            ).map(([part, title, text]) => (
              <li key={part} className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-sm font-medium text-text">{title}</h3>
                  <p className="mt-0.5 text-xs text-muted">{text}</p>
                </div>
                <Switch label={`Sync ${title}`} checked={session[part]} onChange={(on) => toggle(part, on)} />
              </li>
            ))}
          </ul>
          {session.tunnels && !unlocked && (
            <form className="space-y-2 rounded-md border border-border bg-black/25 p-3" onSubmit={unlock}>
              <Input
                label="Sync passphrase"
                type="password"
                autoComplete="off"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                hint="Use the same passphrase on every computer. It is kept only while the app is open, and if you forget it the synced tunnels cannot be recovered."
              />
              <Button type="submit" size="sm">
                Unlock tunnel sync
              </Button>
            </form>
          )}
          <div className="flex flex-wrap gap-3">
            <Button size="sm" variant="secondary" onClick={runSync} loading={busy === "sync"} disabled={!(session.enabled || session.filters || session.tunnels)}>
              Sync now
            </Button>
            <Button size="sm" variant="secondary" onClick={leave}>
              Sign out
            </Button>
          </div>
        </div>
      ) : (
        <form className="space-y-3" onSubmit={(e) => submit(e, "in")}>
          <Input label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Input
            label="Password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            hint="At least 6 characters. The app does not save it."
          />
          <div className="flex flex-wrap gap-3">
            <Button type="submit" size="sm" loading={busy === "in"}>
              Sign in
            </Button>
            <Button type="button" size="sm" variant="secondary" loading={busy === "up"} onClick={(e) => submit(e, "up")}>
              Create account
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
