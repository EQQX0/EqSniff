// S20 — redesigned "IP Storage" screen. Labels only attach to a device your
// own network scan discovered (see Device below) — never a free-typed
// arbitrary IP. See replica/architecture.md "Rationale for what's not here."
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { NetworkIcon } from "@/components/ui/icons";
import { getDevices } from "@/lib/data";

export default async function DevicesPage() {
  const devices = await getDevices();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text">Devices</h1>
          <p className="mt-1 text-sm text-muted">
            Devices your own network scan has discovered. Label the ones you recognize.
          </p>
        </div>
        <Button variant="secondary">Scan network</Button>
      </div>

      <Card className="overflow-x-auto">
        {devices.length === 0 ? (
          <EmptyState
            icon={<NetworkIcon className="h-6 w-6" />}
            title="No devices discovered yet"
            body="Run the desktop app and scan your network to see devices here. You can only label devices your own scan finds — not an arbitrary IP."
            action={<Button variant="secondary">Open the desktop app</Button>}
          />
        ) : (
          <table className="w-full min-w-[28rem] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
                <th scope="col" className="pb-2 font-semibold">Device</th>
                <th scope="col" className="pb-2 font-semibold">IP</th>
                <th scope="col" className="pb-2 font-semibold">Vendor</th>
                <th scope="col" className="pb-2 font-semibold">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id} className="border-b border-border last:border-0">
                  <td className="py-2 font-medium text-text">{d.label ?? d.macAddress}</td>
                  <td className="py-2 text-muted">{d.lastIp}</td>
                  <td className="py-2 text-muted">{d.vendor}</td>
                  <td className="py-2 text-muted">{d.lastSeenAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
