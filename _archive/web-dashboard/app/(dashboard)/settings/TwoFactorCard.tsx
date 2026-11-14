"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";

interface Enrollment {
  factorId: string;
  qr: string;
  secret: string;
}

// Authenticator-app (TOTP) enrolment through Supabase Auth.
export function TwoFactorCard({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data, error: err } = await supabase.auth.mfa.enroll({ factorType: "totp" });
    setBusy(false);
    if (err || !data) return setError("Could not start setup. Try again.");
    setEnrollment({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  }

  async function confirm(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!enrollment) return;
    const code = String(new FormData(e.currentTarget).get("code") ?? "");
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: err } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrollment.factorId, code });
    setBusy(false);
    if (err) return setError("That code did not work. Try the next one.");
    setEnrollment(null);
    router.refresh();
  }

  async function cancel() {
    if (enrollment) await createClient().auth.mfa.unenroll({ factorId: enrollment.factorId });
    setEnrollment(null);
    setError(null);
  }

  async function disable() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data } = await supabase.auth.mfa.listFactors();
    const factor = data?.totp.find((f) => f.status === "verified");
    if (factor) {
      const { error: err } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
      if (err) {
        setBusy(false);
        return setError("Could not turn it off. Sign in again with your code, then retry.");
      }
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-text">Two-factor authentication</h2>
          <p className="mt-1 text-xs text-muted">Require a code from your authenticator app at sign in.</p>
        </div>
        {enabled ? <Badge tone="success">On</Badge> : <Badge tone="neutral">Off</Badge>}
      </div>

      {enrollment ? (
        <form onSubmit={confirm} className="space-y-4">
          {/* Supabase returns the QR as an SVG data URI */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enrollment.qr} alt="QR code for your authenticator app" className="h-40 w-40 rounded-md bg-white p-2" />
          <p className="text-xs text-muted">
            Cannot scan? Enter this key by hand: <code className="break-all text-text">{enrollment.secret}</code>
          </p>
          <Input label="6-digit code" name="code" inputMode="numeric" maxLength={6} required autoComplete="one-time-code" />
          <div className="flex gap-2">
            <Button type="submit" loading={busy}>
              Turn on
            </Button>
            <Button type="button" variant="ghost" onClick={cancel}>
              Cancel
            </Button>
          </div>
        </form>
      ) : enabled ? (
        <Button variant="secondary" loading={busy} onClick={disable}>
          Turn off
        </Button>
      ) : (
        <Button loading={busy} onClick={start}>
          Set up
        </Button>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </Card>
  );
}
