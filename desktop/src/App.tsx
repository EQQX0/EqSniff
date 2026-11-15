import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type PacketRow, type ScanHost, type UpdateInfo } from "@/lib/api";
import { isLocalAddress } from "@/lib/export";
import { DevicesView, type Seen } from "@/views/DevicesView";
import { ScanView } from "@/views/ScanView";
import { HelpView } from "@/views/HelpView";
import { blankFilter, fromStored, newId, type Filter } from "@/lib/filters";
import { FiltersView } from "@/views/FiltersView";
import { CaptureView } from "@/views/CaptureView";
import { VpnView } from "@/views/VpnView";
import { HotspotView } from "@/views/HotspotView";
import { SettingsView } from "@/views/SettingsView";

const NAV = [
  { id: "capture", label: "Capture" },
  { id: "filters", label: "Filters" },
  { id: "devices", label: "Devices" },
  { id: "scan", label: "Network scan" },
  { id: "vpn", label: "VPN" },
  { id: "hotspot", label: "Hotspot" },
  { id: "help", label: "Help" },
  { id: "settings", label: "Settings" },
] as const;

type ViewId = (typeof NAV)[number]["id"];

export default function App() {
  const [view, setView] = useState<ViewId>("capture");
  const [filters, setFilters] = useState<Filter[]>([]);
  const [scanHosts, setScanHosts] = useState<ScanHost[]>([]);

  const [seen, setSeen] = useState<Record<string, Seen>>({});
  const [update, setUpdate] = useState<UpdateInfo | null>(null);

  // One check at start-up. If the user turned checking off, this makes no request.
  useEffect(() => {
    api.checkUpdate().then(setUpdate).catch(() => {});
  }, []);

  const onSeen = useCallback((rows: PacketRow[]) => {
    setSeen((prev) => {
      const next = { ...prev };
      for (const r of rows) {
        for (const ip of [r.src, r.dst]) {
          if (!isLocalAddress(ip) || ip === "127.0.0.1" || ip === "::1") continue;
          if (!next[ip] && Object.keys(next).length >= 500) continue; // cap new devices, keep counting known ones
          const d = next[ip] ?? { ip, packets: 0, bytes: 0, last: 0 };
          next[ip] = { ...d, packets: d.packets + 1, bytes: d.bytes + r.length, last: r.time };
        }
      }
      return next;
    });
  }, []);

  useEffect(() => {
    api
      .getFilters()
      .then((raw) => {
        latest.current = fromStored(raw);
        setFilters(latest.current);
      })
      .catch(() => {});
  }, []);

  // The newest list lives in a ref, so two quick clicks build on each other instead of the older one
  // overwriting the newer. Saves go to disk one after another, in click order.
  const latest = useRef<Filter[]>([]);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const saveFilters = useCallback(async (next: Filter[]) => {
    const before = latest.current;
    latest.current = next;
    setFilters(next);
    const write = queue.current.then(() => api.saveFilters(next));
    queue.current = write.catch(() => {});
    try {
      await write;
    } catch (e) {
      if (latest.current === next) {
        latest.current = before;
        setFilters(before);
      }
      throw e;
    }
  }, []);

  const toggleFilter = useCallback(
    (id: string) => {
      saveFilters(latest.current.map((f) => (f.id === id ? { ...f, enabled: !f.enabled } : f))).catch(() => {});
    },
    [saveFilters]
  );

  // Devices from captures, with anything the network scan found added on top.
  const devices = useMemo(() => {
    const merged: Record<string, Seen> = { ...seen };
    for (const h of scanHosts) {
      const ports = h.ports.map((p) => `${p.port} (${p.service})`).join(", ");
      merged[h.ip] = { ...(merged[h.ip] ?? { ip: h.ip, packets: 0, bytes: 0, last: 0 }), mac: h.mac, ports };
    }
    return Object.values(merged);
  }, [seen, scanHosts]);

  // Show only one device's packets: its own filter, switched on alone. Nothing is intercepted.
  const watchDevice = useCallback(
    (ip: string) => {
      const name = `Watching ${ip}`;
      const list = latest.current;
      const have = list.find((f) => f.name === name);
      const mine: Filter = have ?? { ...blankFilter(newId()), name, address: ip };
      const next = (have ? list : [...list, mine]).map((f) => ({ ...f, enabled: f.id === mine.id }));
      saveFilters(next).then(() => setView("capture")).catch(() => {});
    },
    [saveFilters]
  );

  const useAlone = useCallback(
    (id: string) => {
      saveFilters(latest.current.map((f) => ({ ...f, enabled: f.id === id })))
        .then(() => setView("capture"))
        .catch(() => {});
    },
    [saveFilters]
  );

  return (
    <div className="flex h-screen flex-col">
      {update?.status === "available" && (
        <div role="status" className="flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-2 text-sm text-text">
          <span>{update.message} Details are in Settings.</span>
          <button
            type="button"
            onClick={() => setView("settings")}
            className="rounded-md border border-border px-3 py-1 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Open Settings
          </button>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
      <nav aria-label="Main" className="flex w-52 shrink-0 flex-col gap-1 border-r border-border bg-bg p-4">
        <p className="mb-4 px-2 text-base font-bold text-text">Network Toolkit</p>
        {NAV.map((item) => {
          const active = item.id === view;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setView(item.id)}
              aria-current={active ? "page" : undefined}
              className={`rounded-md px-3 py-2 text-left text-sm font-medium transition-colors duration-fast
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent
                ${active ? "border-l-2 border-accent bg-surface text-text" : "text-muted hover:bg-surface hover:text-text"}`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
      <main className="min-w-0 flex-1 overflow-auto p-6">
        {/* Both views stay mounted so a running capture keeps its table while Settings is open. */}
        <div className={view === "capture" ? "h-full" : "hidden"}>
          <CaptureView filters={filters} onToggle={toggleFilter} onSeen={onSeen} />
        </div>
        <div className={view === "filters" ? "" : "hidden"}>
          <FiltersView
            filters={filters}
            onChange={saveFilters}
            onUse={useAlone}
          />
        </div>
        <div className={view === "devices" ? "" : "hidden"}>
          <DevicesView seen={devices} onWatch={watchDevice} onScan={() => setView("scan")} />
        </div>
        <div className={view === "scan" ? "" : "hidden"}>
          <ScanView onHosts={setScanHosts} />
        </div>
        <div className={view === "vpn" ? "h-full" : "hidden"}>
          {view === "vpn" && <VpnView />}
        </div>
        <div className={view === "hotspot" ? "" : "hidden"}>
          {view === "hotspot" && <HotspotView />}
        </div>
        <div className={view === "help" ? "" : "hidden"}>
          <HelpView />
        </div>
        <div className={view === "settings" ? "" : "hidden"}>
          <SettingsView update={update} onUpdate={setUpdate} />
        </div>
      </main>
      </div>
    </div>
  );
}
