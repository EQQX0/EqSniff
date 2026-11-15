import { useEffect, useState } from "react";
import { api, type ScanHost, type ScanPoll } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";

/** Network scan controls. Found devices land in the Devices table next to it. */
export function ScanPanel({ onHosts }: { onHosts?: (hosts: ScanHost[]) => void }) {
  const [network, setNetwork] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [poll, setPoll] = useState<ScanPoll | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    const id = window.setInterval(async () => {
      try {
        const p = await api.scanPoll();
        if (cancelled) return;
        setPoll(p);
        if (!p.running) {
          setRunning(false);
          onHosts?.(p.hosts);
        }
      } catch (e) {
        if (!cancelled) {
          setError(String(e));
          setRunning(false);
        }
      }
    }, 400);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [running, onHosts]);

  async function start() {
    setError(null);
    setPoll(null);
    try {
      setNetwork(await api.scanStart(""));
      setRunning(true);
    } catch (e) {
      setError(String(e));
    }
  }

  const done = poll && !running;

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-[16rem] flex-1">
          <h2 className="text-base font-semibold text-text">Scan my network</h2>
          <p className="mt-0.5 text-sm text-muted">Finds every device on the network this computer is connected to.</p>
        </div>
        {running ? (
          <Button variant="danger" onClick={() => api.scanCancel()}>
            Stop scan
          </Button>
        ) : (
          <Button onClick={start}>Start scan</Button>
        )}
      </div>
      <p className="text-xs text-muted">
        Checks 22 common ports on each device with ordinary connections, like a browser. Scans only the network this computer is on, up to 256
        addresses; a full scan takes up to about a minute.
      </p>
      {network && <p className="text-xs text-muted">Network: {network}</p>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {poll && poll.total > 0 && (
        <ProgressBar value={Math.min(poll.scanned, poll.total)} max={poll.total} label={running ? "Addresses checked" : "Scan finished"} />
      )}
      {done && (
        <p role="status" className="text-sm text-text">
          {poll.hosts.length === 0
            ? "No devices answered. Devices that block all connections and have not talked to this computer will not show up."
            : `Found ${poll.hosts.length} device${poll.hosts.length === 1 ? "" : "s"}. They are in the table below.`}
        </p>
      )}
    </Card>
  );
}
