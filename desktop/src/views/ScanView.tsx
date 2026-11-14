import { useEffect, useState } from "react";
import { api, type ScanPoll } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { NetworkIcon } from "@/components/ui/icons";
import { ProgressBar } from "@/components/ui/ProgressBar";

export function ScanView() {
  const [target, setTarget] = useState("");
  const [owns, setOwns] = useState(false);
  const [network, setNetwork] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [poll, setPoll] = useState<ScanPoll | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [labels, setLabels] = useState<Record<string, string>>({});

  useEffect(() => {
    api.getStore("labels").then((v) => v && typeof v === "object" && setLabels(v as Record<string, string>)).catch(() => {});
  }, [running]);

  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    const id = window.setInterval(async () => {
      try {
        const p = await api.scanPoll();
        if (cancelled) return;
        setPoll(p);
        if (!p.running) setRunning(false);
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
  }, [running]);

  async function start() {
    setError(null);
    setPoll(null);
    try {
      setNetwork(await api.scanStart(target.trim()));
      setRunning(true);
    } catch (e) {
      setError(String(e));
    }
  }

  const done = poll && !running;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-text">Network scan</h1>
        <p className="mt-1 text-sm text-muted">
          Finds the devices on your own network and the common ports each one has open. It opens ordinary connections, the way a
          browser does, to a fixed list of 22 common ports. It can only scan the network this computer is on, up to 256 addresses.
        </p>
      </div>

      <Card className="flex flex-col gap-4">
        <Input
          label="Scan only (optional)"
          hint="Leave empty to scan the whole network. Or enter one address (192.168.0.10) or a small range (192.168.0.0/28)."
          value={target}
          disabled={running}
          onChange={(e) => setTarget(e.target.value)}
        />
        <label className="flex items-start gap-2 text-sm text-text">
          <input
            type="checkbox"
            checked={owns}
            disabled={running}
            onChange={(e) => setOwns(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
          />
          <span>I own or manage this network, or I have permission to scan it.</span>
        </label>
        <div className="flex flex-wrap gap-2">
          {running ? (
            <Button variant="danger" onClick={() => api.scanCancel()}>
              Stop scan
            </Button>
          ) : (
            <Button onClick={start} disabled={!owns}>
              Start scan
            </Button>
          )}
        </div>
        {network && <p className="text-xs text-muted">Network: {network}</p>}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        {poll && poll.total > 0 && (
          <ProgressBar value={Math.min(poll.scanned, poll.total)} max={poll.total} label={running ? "Addresses checked" : "Scan finished"} />
        )}
      </Card>

      <Card className="p-0">
        {!poll || poll.hosts.length === 0 ? (
          <EmptyState
            icon={<NetworkIcon className="h-6 w-6" />}
            title={done ? "No devices answered" : running ? "Scanning…" : "No scan yet"}
            body={
              done
                ? "Nothing responded. Devices that block all connections and have not talked to this computer will not show up."
                : "Confirm the box above, then press Start scan. A full scan takes up to about a minute."
            }
          />
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-muted">
              <tr className="border-b border-border">
                <th scope="col" className="px-3 py-2 font-semibold">Address</th>
                <th scope="col" className="px-3 py-2 font-semibold">Your name</th>
                <th scope="col" className="px-3 py-2 font-semibold">MAC</th>
                <th scope="col" className="px-3 py-2 font-semibold">Open ports</th>
              </tr>
            </thead>
            <tbody>
              {poll.hosts.map((h) => (
                <tr key={h.ip} className="border-b border-border align-top last:border-0">
                  <td className="px-3 py-2 font-mono text-xs text-text">{h.ip}</td>
                  <td className="px-3 py-2 text-text">{labels[h.ip] ?? ""}</td>
                  <td className="px-3 py-2 font-mono text-xs text-muted">{h.mac ?? ""}</td>
                  <td className="px-3 py-2 text-xs text-muted">
                    {h.ports.length === 0 ? "none found" : h.ports.map((p) => `${p.port} (${p.service})`).join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
