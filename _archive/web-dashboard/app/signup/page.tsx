"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signUp, type AuthState } from "@/app/auth/actions";
import { AuthShell, FormStatus } from "@/components/AuthShell";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

export default function SignupPage() {
  const [state, action, pending] = useActionState(signUp, {} as AuthState);
  return (
    <AuthShell title="Create account" subtitle="You will confirm your email before signing in.">
      <form action={action} className="mt-6 space-y-4">
        <Input label="Email" type="email" name="email" required autoComplete="email" />
        <Input
          label="Password"
          type="password"
          name="password"
          required
          minLength={8}
          autoComplete="new-password"
          hint="At least 8 characters."
        />
        <FormStatus error={state.error} message={state.message} />
        <Button type="submit" className="w-full" loading={pending}>
          Create account
        </Button>
      </form>
      <p className="mt-4 text-sm text-muted">
        Already registered?{" "}
        <Link href="/login" className="underline hover:text-text">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
