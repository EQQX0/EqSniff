import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { NetworkIcon } from "@/components/ui/icons";

export interface Seen {
  ip: string;
  packets: number;
  bytes: number;
  last: number;
}

export function DevicesView({ seen }: { seen: Seen[] }) {
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

  const sorted = [...seen].sort((a, b) => b.last - a.last);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-text">Devices</h1>
        <p className="mt-1 text-sm text-muted">
          Devices on your own network that showed up in a capture. The app only listens. It never scans or contacts them. Names you give
          stay on this computer.
        </p>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Card className="p-0">
        {sorted.length === 0 ? (
          <EmptyState
            icon={<NetworkIcon className="h-6 w-6" />}
            title="No devices seen yet"
            body="Start a capture on the Capture page. Local devices appear here as they send or receive traffic."
          />
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-muted">
              <tr className="border-b border-border">
                <th scope="col" className="px-3 py-2 font-semibold">Address</th>
                <th scope="col" className="px-3 py-2 font-semibold">Your name for it</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Packets</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Bytes</th>
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
                  <td className="px-3 py-2 text-right text-muted">{d.packets.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right text-muted">{d.bytes.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
