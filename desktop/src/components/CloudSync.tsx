import { FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Switch } from "@/components/ui/Switch";
import { CloudError, loadSession, setEnabled, signIn, signOut, signUp, syncNow, type CloudSession } from "@/lib/cloud";

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

  async function toggle(on: boolean) {
    setError(null);
    try {
      setSession(await setEnabled(on));
      if (on) await runSync();
    } catch (err) {
      fail(err);
    }
  }

  async function runSync() {
    setBusy("sync");
    setError(null);
    try {
      const r = await syncNow();
      setNote(`Synced. ${r.added} added here, ${r.sent} sent, ${r.removed} removed from the cloud.`);
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
      setSession(null);
    } catch (err) {
      fail(err);
    }
  }

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-text">Sync IP Storage (optional)</h2>
        <p className="mt-1 text-xs text-muted">
          Keep your saved addresses and labels the same on every computer you sign in on. Only each address and its label are
          sent, nothing else from this app, and only while you are signed in with sync turned on. Skip this and the app never
          connects for it. Do not save anything secret in a label.
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
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-medium text-text">Sync IP Storage</h3>
              <p className="mt-0.5 text-xs text-muted">Last sync: {when(session.lastSync)}</p>
            </div>
            <Switch label="Sync IP Storage" checked={session.enabled} onChange={toggle} />
          </div>
          <div className="flex flex-wrap gap-3">
            <Button size="sm" variant="secondary" onClick={runSync} loading={busy === "sync"} disabled={!session.enabled}>
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
