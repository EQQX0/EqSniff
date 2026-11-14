import { useState } from "react";
import { api, type LimitStatus } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";

interface Props {
  status: LimitStatus;
  onStatus: (s: LimitStatus) => void;
}

export function TrafficView({ status, onStatus }: Props) {
  const [kbps, setKbps] = useState("5000");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const n = Number(kbps);
  const invalid = !/^\d+$/.test(kbps) || n < 64 || n > 1_000_000;

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      onStatus(await api.trafficLimit(n));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);
    setError(null);
    try {
      onStatus(await api.trafficStop());
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-text">Traffic control</h1>
        <p className="mt-1 text-sm text-muted">
          Cap how fast this computer sends data, to test how your own apps and games behave on a slow connection. It affects only this
          computer. It cannot touch any other device.
        </p>
      </div>

      <Card className="flex flex-col gap-4">
        <p className="text-sm text-text" aria-live="polite">
          {status.active ? `Limit is on: ${status.kbps?.toLocaleString()} kbps outgoing.` : "No limit is set."}
        </p>
        <Input
          label="Outgoing speed limit (kbps)"
          hint="1,000 kbps is about 1 Mbit per second. Allowed: 64 to 1,000,000."
          inputMode="numeric"
          value={kbps}
          error={kbps !== "" && invalid ? "Enter a whole number from 64 to 1,000,000." : undefined}
          onChange={(e) => setKbps(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <Button onClick={apply} loading={busy} disabled={invalid}>
            {status.active ? "Change limit" : "Apply limit"}
          </Button>
          <Button variant="danger" onClick={stop} loading={busy} disabled={!status.active}>
            Stop limiting
          </Button>
        </div>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </Card>

      <Card>
        <h2 className="text-base font-semibold text-text">Good to know</h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-muted">
          <li>Windows needs the app to run as administrator for this.</li>
          <li>Emergency stop: press Ctrl+Shift+X anywhere in the app, or use the red bar at the top while a limit is on.</li>
          <li>The limit is removed when you close the app. If the app ever crashes, open it again and press Stop limiting.</li>
          <li>It limits outgoing data only. Downloads are not slowed.</li>
          <li>It covers IPv4 traffic. IPv6 traffic is not limited.</li>
        </ul>
      </Card>
    </div>
  );
}
