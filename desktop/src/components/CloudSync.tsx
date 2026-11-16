import { FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { CloudError, GLOBAL_FILTERS_SYNCED, loadSession, renameUser, resetPassword, signIn, signOut, signOutIfDisabled, signUp, syncNow, type CloudSession } from "@/lib/cloud";
import { SharedLibrary } from "@/components/SharedLibrary";
import { BackupCard } from "@/components/BackupCard";

const when = (t: number | null) => (t ? new Date(t).toLocaleString() : "not yet");
const USERNAME = /^[A-Za-z0-9_.-]{3,24}$/;
const USERNAME_HINT = "3 to 24 letters, numbers, dots, dashes or underscores. Usernames are unique.";

type Mode = "signin" | "create" | "reset";

/** Settings card: an optional account that keeps IP Storage, filters and VPN tunnels the same on every computer. */
export function CloudSync() {
  const [session, setSession] = useState<CloudSession | null>(null);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<Mode>("signin");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    loadSession()
      .then(async (s) => {
        if (s && (await signOutIfDisabled().catch(() => false))) {
          setSession(null);
          setError("This account has been disabled.");
          window.dispatchEvent(new Event(GLOBAL_FILTERS_SYNCED));
          return;
        }
        setSession(s);
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  const fail = (e: unknown) => setError(e instanceof CloudError ? e.message : String(e));
  const go = (m: Mode) => {
    setMode(m);
    setError(null);
    setNote(null);
    setPassword("");
    setConfirm("");
  };

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await task();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      if (mode === "signin") {
        if (!username.trim() || !password) throw new CloudError("Enter your username and password.");
        setSession(await signIn(username.trim(), password));
        setPassword("");
        window.dispatchEvent(new Event(GLOBAL_FILTERS_SYNCED));
      } else if (mode === "create") {
        if (!USERNAME.test(username.trim())) throw new CloudError(`Username: ${USERNAME_HINT}`);
        if (!email.includes("@")) throw new CloudError("Enter a valid email address.");
        if (password.length < 8) throw new CloudError("The password needs at least 8 characters.");
        if (password !== confirm) throw new CloudError("The two passwords do not match.");
        const r = await signUp(username.trim(), email.trim(), password);
        setPassword("");
        setConfirm("");
        if ("session" in r) {
          setSession(r.session);
          window.dispatchEvent(new Event(GLOBAL_FILTERS_SYNCED));
        } else {
          setNote("Account created. Open the email we sent you and confirm the address, then sign in with your username.");
          setMode("signin");
        }
      } else {
        if (!email.includes("@")) throw new CloudError("Enter the email address of your account.");
        await resetPassword(email.trim());
        setNote("If that email has an account, a reset link is on its way. Open it, choose a new password, then sign in here.");
        setMode("signin");
      }
    });
  };

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

  return (
    <>
      <Card className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-text">Account sync (optional)</h2>
          <p className="mt-1 text-xs text-muted">
            Sign in and IP Storage, filters and VPN tunnels stay the same on every computer you use. It is always on while you
            are signed in, and nothing is sent while you are signed out. Everything is private to your account unless you
            share a tunnel, filter or IP address below. Skip this and the app never connects for it. A VPN tunnel contains its private key,
            so only sign in on computers you trust.
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
        ) : (
          <form className="space-y-3" onSubmit={submit}>
            {mode !== "reset" && (
              <Input
                label="Username"
                autoComplete="username"
                value={username}
                maxLength={24}
                onChange={(e) => setUsername(e.target.value)}
                hint={mode === "create" ? USERNAME_HINT : undefined}
              />
            )}
            {mode !== "signin" && (
              <Input label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} hint={mode === "reset" ? "We send a reset link to this address." : "Used only to confirm the account and reset the password."} />
            )}
            {mode !== "reset" && (
              <Input
                label="Password"
                type="password"
                autoComplete={mode === "create" ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                hint={mode === "create" ? "At least 8 characters. The app does not save it." : undefined}
              />
            )}
            {mode === "create" && (
              <Input label="Confirm password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" size="sm" loading={busy}>
                {mode === "signin" ? "Sign in" : mode === "create" ? "Create account" : "Send reset email"}
              </Button>
              {mode === "signin" ? (
                <>
                  <Button type="button" size="sm" variant="ghost" onClick={() => go("create")}>
                    Create account
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => go("reset")}>
                    Forgot password?
                  </Button>
                </>
              ) : (
                <Button type="button" size="sm" variant="ghost" onClick={() => go("signin")}>
                  Back to sign in
                </Button>
              )}
            </div>
          </form>
        )}
      </Card>
      {session && <SharedLibrary session={session} />}
      <BackupCard />
    </>
  );
}
