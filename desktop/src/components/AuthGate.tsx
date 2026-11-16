import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { checkAccountStatus, CloudError, GLOBAL_FILTERS_SYNCED, loadSession, resetPassword, signIn, signUp } from "@/lib/cloud";

const USERNAME = /^[A-Za-z0-9_.-]{3,24}$/;
const USERNAME_HINT = "3 to 24 letters, numbers, dots, dashes or underscores. Usernames are unique.";
const RECHECK_MS = 2 * 60_000;

type Mode = "signin" | "create" | "reset";
type Status = "loading" | "signedOut" | "ok";

/**
 * Blocks the whole app behind a required, admin-approved account: nothing inside renders until
 * someone is signed in, and the account isn't disabled or switched to another device. Re-checks
 * periodically, so being disabled or kicked by another device mid-session also locks the screen.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [mode, setMode] = useState<Mode>("signin");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const checking = useRef(false);

  async function recheck() {
    if (checking.current) return;
    checking.current = true;
    try {
      const s = await loadSession();
      if (!s) {
        setStatus((prev) => (prev === "ok" ? "signedOut" : prev === "loading" ? "signedOut" : prev));
        return;
      }
      const result = await checkAccountStatus().catch(() => "ok" as const);
      if (result === "disabled") {
        setError("This account has been disabled.");
        setStatus("signedOut");
      } else if (result === "other-device") {
        setError("This account signed in on another device, so this computer was signed out.");
        setStatus("signedOut");
      } else {
        setStatus("ok");
      }
    } finally {
      checking.current = false;
    }
  }

  useEffect(() => {
    void recheck();
    const id = setInterval(recheck, RECHECK_MS);
    const onSync = () => void recheck();
    window.addEventListener(GLOBAL_FILTERS_SYNCED, onSync);
    return () => {
      clearInterval(id);
      window.removeEventListener(GLOBAL_FILTERS_SYNCED, onSync);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const go = (m: Mode) => {
    setMode(m);
    setError(null);
    setNote(null);
    setPassword("");
    setConfirm("");
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNote(null);
    void (async () => {
      try {
        if (mode === "signin") {
          if (!username.trim() || !password) throw new CloudError("Enter your username and password.");
          await signIn(username.trim(), password);
          setPassword("");
          window.dispatchEvent(new Event(GLOBAL_FILTERS_SYNCED));
          await recheck();
        } else if (mode === "create") {
          if (!USERNAME.test(username.trim())) throw new CloudError(`Username: ${USERNAME_HINT}`);
          if (!email.includes("@")) throw new CloudError("Enter a valid email address.");
          if (password.length < 8) throw new CloudError("The password needs at least 8 characters.");
          if (password !== confirm) throw new CloudError("The two passwords do not match.");
          await signUp(username.trim(), email.trim(), password);
          setPassword("");
          setConfirm("");
          setNote("Account created. An admin needs to enable it before you can sign in — try signing in once you've been told it's approved.");
          setMode("signin");
        } else {
          if (!email.includes("@")) throw new CloudError("Enter the email address of your account.");
          await resetPassword(email.trim());
          setNote("If that email has an account, a reset link is on its way. Open it, choose a new password, then sign in here.");
          setMode("signin");
        }
      } catch (err) {
        setError(err instanceof CloudError ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    })();
  };

  if (status === "ok") return <>{children}</>;
  if (status === "loading") return <div className="flex h-screen items-center justify-center bg-bg" aria-busy="true" />;

  return (
    <div className="flex h-screen items-center justify-center bg-bg px-4">
      <Card className="w-full max-w-md space-y-4">
        <div>
          <h1 className="text-lg font-semibold text-text">Sign in to EqNetwork</h1>
          <p className="mt-1 text-xs text-muted">
            An account is required to use the app. New accounts need an admin to enable them before they can sign in,
            and each account can be signed in on one device at a time.
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
            <Input
              label="Email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              hint={mode === "reset" ? "We send a reset link to this address." : "Used only to confirm the account and reset the password."}
            />
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
      </Card>
    </div>
  );
}
