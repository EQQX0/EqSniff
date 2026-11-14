"use client";

import Link from "next/link";
import { useActionState } from "react";
import { requestPasswordReset, type AuthState } from "@/app/auth/actions";
import { AuthShell, FormStatus } from "@/components/AuthShell";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

export default function ForgotPasswordPage() {
  const [state, action, pending] = useActionState(requestPasswordReset, {} as AuthState);
  return (
    <AuthShell title="Reset password" subtitle="We will email you a link to choose a new one.">
      <form action={action} className="mt-6 space-y-4">
        <Input label="Email" type="email" name="email" required autoComplete="email" />
        <FormStatus error={state.error} message={state.message} />
        <Button type="submit" className="w-full" loading={pending}>
          Send reset link
        </Button>
      </form>
      <p className="mt-4 text-sm">
        <Link href="/login" className="text-muted underline hover:text-text">
          Back to sign in
        </Link>
      </p>
    </AuthShell>
  );
}
