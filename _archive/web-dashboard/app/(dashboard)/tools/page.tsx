// S18 — GeoIP lookup. The Gamertag Resolver (S19) is intentionally not
// built here — see replica/recon.md "Out of scope" and features.csv.
"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { NetworkIcon } from "@/components/ui/icons";

export default function ToolsPage() {
  const [result, setResult] = useState<null | { ip: string; country: string; city: string; isp: string }>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleLookup(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ip = new FormData(e.currentTarget).get("ip") as string;
    const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!ipv4.test(ip)) {
      setError("Enter a valid IPv4 address, e.g. 1.1.1.1.");
      setResult(null);
      return;
    }
    setError(null);
    setLoading(true);
    // Fake lookup — a real build calls a general-purpose public GeoIP API
    // with your own key, per architecture.md. Not the original's proprietary DB.
    setTimeout(() => {
      setLoading(false);
      setResult({ ip, country: "Unknown (demo data)", city: "Unknown (demo data)", isp: "Unknown (demo data)" });
    }, 500);
  }

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-text">Tools</h1>
        <p className="mt-1 text-sm text-muted">Look up geolocation for an IP address you've captured.</p>
      </div>

      <Card>
        <form onSubmit={handleLookup} className="flex items-end gap-3">
          <div className="flex-1">
            <Input label="IP address" name="ip" placeholder="1.1.1.1" error={error ?? undefined} />
          </div>
          <Button type="submit" loading={loading}>
            Look up
          </Button>
        </form>
      </Card>

      {result ? (
        <Card>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-muted">IP</dt>
              <dd className="font-medium text-text">{result.ip}</dd>
            </div>
            <div>
              <dt className="text-muted">Country</dt>
              <dd className="font-medium text-text">{result.country}</dd>
            </div>
            <div>
              <dt className="text-muted">City</dt>
              <dd className="font-medium text-text">{result.city}</dd>
            </div>
            <div>
              <dt className="text-muted">ISP</dt>
              <dd className="font-medium text-text">{result.isp}</dd>
            </div>
          </dl>
        </Card>
      ) : (
        <EmptyState
          icon={<NetworkIcon className="h-6 w-6" />}
          title="No lookup yet"
          body="Enter an IP address and click Look up to see its geolocation."
        />
      )}
    </div>
  );
}
