"use client";

import { useState } from "react";
import { signOutEverywhere } from "@/app/auth/actions";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";

export function AccountActions() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const password = new FormData(e.currentTarget).get("password");
    setBusy(true);
    setError(null);
    const res = await fetch("/api/account", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.status === 204) {
      window.location.assign("/login");
      return;
    }
    setBusy(false);
    setError(res.status === 403 ? "That password is wrong." : "Could not delete the account. Nothing was removed.");
  }

  return (
    <>
      <Card className="space-y-3">
        <h2 className="text-sm font-semibold text-text">Sessions</h2>
        <p className="text-sm text-muted">Sign out on every device where you are signed in.</p>
        <form action={signOutEverywhere}>
          <Button type="submit" variant="secondary">
            Sign out everywhere
          </Button>
        </form>
      </Card>

      <Card className="space-y-3 border-danger">
        <h2 className="text-sm font-semibold text-text">Delete account</h2>
        <p className="text-sm text-muted">
          Removes your account, devices, filters and tickets, and cancels any subscription. Stripe keeps its own
          payment records. This cannot be undone.
        </p>
        <Button variant="danger" onClick={() => setOpen(true)}>
          Delete account
        </Button>
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="Delete your account">
        <form onSubmit={handleDelete} className="space-y-4">
          <p className="text-sm text-muted">Enter your password to confirm.</p>
          <Input
            label="Password"
            type="password"
            name="password"
            required
            autoFocus
            autoComplete="current-password"
            error={error ?? undefined}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" loading={busy}>
              Delete forever
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
