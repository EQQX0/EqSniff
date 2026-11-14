// S02 — sign in, with the two-factor step when the account has a verified authenticator.
"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signIn, verifyTwoFactor, type AuthState } from "@/app/auth/actions";
import { AuthShell, FormStatus } from "@/components/AuthShell";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

const initial: AuthState = {};

export default function LoginPage() {
  const [signInState, signInAction, signingIn] = useActionState(signIn, initial);
  const [twoFaState, twoFaAction, verifying] = useActionState(verifyTwoFactor, initial);
  const factorId = twoFaState.factorId ?? signInState.factorId;

  if (factorId) {
    return (
      <AuthShell title="Two-factor code" subtitle="Enter the 6-digit code from your authenticator app.">
        <form action={twoFaAction} className="mt-6 space-y-4">
          <input type="hidden" name="factorId" value={factorId} />
          <Input
            label="Code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
            autoFocus
          />
          <FormStatus error={twoFaState.error} />
          <Button type="submit" className="w-full" loading={verifying}>
            Verify and sign in
          </Button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Sign in" subtitle="Access your network toolkit account.">
      <form action={signInAction} className="mt-6 space-y-4">
        <Input label="Email" type="email" name="email" required autoComplete="email" />
        <Input label="Password" type="password" name="password" required autoComplete="current-password" />
        <FormStatus error={signInState.error} />
        <Button type="submit" className="w-full" loading={signingIn}>
          Sign in
        </Button>
      </form>
      <div className="mt-4 flex justify-between text-sm">
        <Link href="/forgot-password" className="text-muted underline hover:text-text">
          Forgot password?
        </Link>
        <Link href="/signup" className="text-muted underline hover:text-text">
          Create account
        </Link>
      </div>
    </AuthShell>
  );
}
