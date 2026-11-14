"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Modal } from "@/components/ui/Modal";
import type { DeviceSeat } from "@/lib/data";

// S24 — device/license seat management.
export function DeviceAccessClient({ initialSeats }: { initialSeats: DeviceSeat[] }) {
  const [seats, setSeats] = useState(initialSeats);
  const [selected, setSelected] = useState<string | null>(seats.find((s) => s.isActive)?.id ?? null);
  const [resetOpen, setResetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const router = useRouter();

  const active = seats.find((s) => s.isActive);
  const switchesUsed = active?.switchesUsedThisPeriod ?? 0;
  const switchLimit = active?.switchLimit ?? 3;
  const atLimit = switchesUsed >= switchLimit;

  async function post(url: string, body: unknown) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, error: (json.error as string | undefined) ?? "Something went wrong." };
  }

  async function handleSwitch() {
    if (!selected || atLimit) return;
    setBusy(true);
    setError(null);
    const r = await post("/api/device-seats/switch", { seat_id: selected });
    setBusy(false);
    if (!r.ok) return setError(r.status === 409 ? "You have used all of this month's switches." : r.error);
    router.refresh();
  }

  async function handleReset(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const password = new FormData(e.currentTarget).get("password") as string;
    setBusy(true);
    setResetError(null);
    const r = await post("/api/device-seats/reset", { password });
    setBusy(false);
    if (!r.ok) {
      return setResetError(
        r.status === 403 ? "That password is wrong." : r.status === 409 ? "No switches left this month." : r.error,
      );
    }
    setResetOpen(false);
    router.refresh();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-text">Switch device</h2>
          <p className="mt-1 text-sm text-muted">Pick a device to make active. Uses one of your monthly switches.</p>
        </div>

        <div role="radiogroup" aria-label="Device" className="space-y-2">
          {seats.map((s) => (
            <label
              key={s.id}
              className="flex cursor-pointer items-center justify-between rounded-md border border-border-input p-3 has-[:checked]:border-accent has-[:checked]:ring-2 has-[:checked]:ring-accent"
            >
              <input
                type="radio"
                name="seat"
                value={s.id}
                checked={selected === s.id}
                onChange={() => setSelected(s.id)}
                className="sr-only"
              />
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text">{s.deviceName}</span>
                  {s.isActive && <Badge tone="accent">Active</Badge>}
                </div>
                <p className="text-xs text-muted">{s.isActive ? "Currently active" : `Last used ${s.lastUsedAt}`}</p>
              </div>
            </label>
          ))}
        </div>

        <ProgressBar value={switchesUsed} max={switchLimit} label="Monthly switches used" />

        <Button
          className="w-full"
          disabled={!selected || selected === active?.id || atLimit}
          loading={busy && !resetOpen}
          onClick={handleSwitch}
        >
          Switch to selected device
        </Button>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </Card>

      <Card className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-text">Reset active device</h2>
          <p className="mt-1 text-sm text-muted">Sign out of the software and release your active device.</p>
        </div>
        <p className="text-sm text-muted">
          Resetting signs you out and immediately uses one monthly switch. Your next successful sign-in
          automatically becomes active, without using another switch.
        </p>
        <Button variant="danger" onClick={() => setResetOpen(true)}>
          Reset active device
        </Button>
      </Card>

      <Modal open={resetOpen} onClose={() => setResetOpen(false)} title="Confirm reset">
        <form
          className="space-y-4"
          onSubmit={handleReset}
        >
          <p className="text-sm text-muted">
            This signs you out of {active?.deviceName ?? "the active device"} and uses one monthly switch. This can&apos;t be undone.
          </p>
          <Input label="Confirm your password" type="password" name="password" required autoFocus error={resetError ?? undefined} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setResetOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" loading={busy && resetOpen}>
              Reset active device
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
