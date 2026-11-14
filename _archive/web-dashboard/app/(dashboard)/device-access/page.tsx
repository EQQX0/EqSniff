import { getDeviceSeats } from "@/lib/data";
import { DeviceAccessClient } from "./DeviceAccessClient";

export default async function DeviceAccessPage() {
  const seats = await getDeviceSeats();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-text">Device access</h1>
        <p className="mt-1 text-sm text-muted">Manage which device runs the app and recover access if something goes wrong.</p>
      </div>
      <DeviceAccessClient initialSeats={seats} />
    </div>
  );
}
