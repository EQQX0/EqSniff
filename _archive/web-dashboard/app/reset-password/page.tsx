"use client";

import { useActionState } from "react";
import { updatePassword, type AuthState } from "@/app/auth/actions";
import { AuthShell, FormStatus } from "@/components/AuthShell";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

// Reached from the emailed link via /auth/callback, which signs the user in first.
export default function ResetPasswordPage() {
  const [state, action, pending] = useActionState(updatePassword, {} as AuthState);
  return (
    <AuthShell title="Choose a new password" subtitle="You will be signed in once it is saved.">
      <form action={action} className="mt-6 space-y-4">
        <Input
          label="New password"
          type="password"
          name="password"
          required
          minLength={8}
          autoComplete="new-password"
          hint="At least 8 characters."
        />
        <FormStatus error={state.error} />
        <Button type="submit" className="w-full" loading={pending}>
          Save password
        </Button>
      </form>
    </AuthShell>
  );
}
