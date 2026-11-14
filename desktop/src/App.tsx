import { useCallback, useEffect, useState } from "react";
import { api, type LimitStatus, type PacketRow } from "@/lib/api";
import { isLocalAddress } from "@/lib/export";
import { DevicesView, type Seen } from "@/views/DevicesView";
import { TrafficView } from "@/views/TrafficView";
import { HelpView } from "@/views/HelpView";
import { fromStored, type Filter } from "@/lib/filters";
import { FiltersView } from "@/views/FiltersView";
import { CaptureView } from "@/views/CaptureView";
import { SettingsView } from "@/views/SettingsView";

const NAV = [
  { id: "capture", label: "Capture" },
  { id: "filters", label: "Filters" },
  { id: "devices", label: "Devices" },
  { id: "traffic", label: "Traffic control" },
  { id: "help", label: "Help" },
  { id: "settings", label: "Settings" },
] as const;

type ViewId = (typeof NAV)[number]["id"];

export default function App() {
  const [view, setView] = useState<ViewId>("capture");
  const [filters, setFilters] = useState<Filter[]>([]);
  const [activeId, setActiveId] = useState("");

  const [seen, setSeen] = useState<Record<string, Seen>>({});
  const [limit, setLimit] = useState<LimitStatus>({ active: false, kbps: null });

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
    api.trafficStatus().then(setLimit).catch(() => {});
  }, []);

  // Emergency stop for the speed limit: Ctrl+Shift+X from anywhere in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "x") {
        e.preventDefault();
        api.trafficStop().then(setLimit).catch(() => {});
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    api.getFilters().then((raw) => setFilters(fromStored(raw))).catch(() => {});
  }, []);

  const saveFilters = useCallback(async (next: Filter[]) => {
    await api.saveFilters(next);
    setFilters(next);
    setActiveId((id) => (next.some((f) => f.id === id) ? id : ""));
  }, []);

  return (
    <div className="flex h-screen flex-col">
      {limit.active && (
        <div role="alert" className="flex items-center justify-between gap-3 bg-danger px-4 py-2 text-sm font-medium text-on-accent">
          <span>Speed limit is on: {limit.kbps?.toLocaleString()} kbps outgoing.</span>
          <button
            type="button"
            onClick={() => api.trafficStop().then(setLimit).catch(() => {})}
            className="rounded-md border border-on-accent px-3 py-1 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-accent"
          >
            Stop now (Ctrl+Shift+X)
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
          <CaptureView filters={filters} activeId={activeId} onActiveId={setActiveId} onSeen={onSeen} />
        </div>
        <div className={view === "filters" ? "" : "hidden"}>
          <FiltersView
            filters={filters}
            onChange={saveFilters}
            onUse={(id) => {
              setActiveId(id);
              setView("capture");
            }}
          />
        </div>
        <div className={view === "devices" ? "" : "hidden"}>
          <DevicesView seen={Object.values(seen)} />
        </div>
        <div className={view === "traffic" ? "" : "hidden"}>
          <TrafficView status={limit} onStatus={setLimit} />
        </div>
        <div className={view === "help" ? "" : "hidden"}>
          <HelpView />
        </div>
        <div className={view === "settings" ? "" : "hidden"}>
          <SettingsView />
        </div>
      </main>
      </div>
    </div>
  );
}
