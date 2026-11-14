import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { NetworkIcon } from "@/components/ui/icons";

export interface Seen {
  ip: string;
  packets: number;
  bytes: number;
  last: number;
  /** Filled in by the network scan. */
  mac?: string | null;
  ports?: string;
}

interface Props {
  seen: Seen[];
  /** Show only this device's packets on the Capture page. */
  onWatch: (ip: string) => void;
  onScan: () => void;
}

export function DevicesView({ seen, onWatch, onScan }: Props) {
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getStore("labels")
      .then((v) => v && typeof v === "object" && setLabels(v as Record<string, string>))
      .catch((e) => setError(String(e)));
  }, []);

  async function rename(ip: string, value: string) {
    const next = { ...labels };
    if (value.trim() === "") delete next[ip];
    else next[ip] = value.trim().slice(0, 40);
    setLabels(next);
    try {
      await api.saveStore("labels", next);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  const byAddress = (ip: string) => ip.split(".").reduce((n, p) => n * 256 + Number(p), 0) || 0;
  const sorted = [...seen].sort((a, b) => b.last - a.last || byAddress(a.ip) - byAddress(b.ip));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-text">Devices</h1>
        <p className="mt-1 text-sm text-muted">
          Devices on your own network, from two sources: traffic seen in a capture, and the Network scan. Capture only listens. Names you give
          stay on this computer.
        </p>
        <p className="mt-1 text-sm text-muted">
          “Watch” shows only the packets to or from that device on the Capture page. This computer sees a device's traffic only when it is
          sent to or from this computer, or when the network shares it with everyone. The app does not intercept anything.
        </p>
      </div>
      <div>
        <Button variant="secondary" onClick={onScan}>Scan my network</Button>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Card className="p-0">
        {sorted.length === 0 ? (
          <EmptyState
            icon={<NetworkIcon className="h-6 w-6" />}
            title="No devices yet"
            body="Start a capture on the Capture page, or run the Network scan. Local devices appear here."
          />
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-muted">
              <tr className="border-b border-border">
                <th scope="col" className="px-3 py-2 font-semibold">Address</th>
                <th scope="col" className="px-3 py-2 font-semibold">Your name for it</th>
                <th scope="col" className="px-3 py-2 font-semibold">MAC</th>
                <th scope="col" className="px-3 py-2 font-semibold">Open ports</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Packets</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Bytes</th>
                <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((d) => (
                <tr key={d.ip} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-mono text-xs text-text">{d.ip}</td>
                  <td className="px-3 py-1.5">
                    <input
                      aria-label={`Name for ${d.ip}`}
                      defaultValue={labels[d.ip] ?? ""}
                      key={`${d.ip}-${labels[d.ip] ?? ""}`}
                      maxLength={40}
                      placeholder="Add a name"
                      onBlur={(e) => e.target.value.trim() !== (labels[d.ip] ?? "") && rename(d.ip, e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                      className="h-9 w-full max-w-xs rounded-md border border-border-input bg-surface px-2 text-sm text-text placeholder:text-muted
                        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-muted">{d.mac ?? ""}</td>
                  <td className="px-3 py-2 text-xs text-muted">{d.ports ?? ""}</td>
                  <td className="px-3 py-2 text-right text-muted">{d.packets.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right text-muted">{d.bytes.toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-right">
                    <Button size="sm" variant="secondary" onClick={() => onWatch(d.ip)} aria-label={`Watch traffic to and from ${d.ip}`}>
                      Watch
                    </Button>
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
