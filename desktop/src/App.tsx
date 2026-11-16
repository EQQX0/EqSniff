import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type PacketRow, type ScanHost, type UpdateInfo } from "@/lib/api";
import { FILTERS_SYNCED, GLOBAL_FILTERS_SYNCED, editGlobalFilter, getGlobalFilters, loadSession, publishGlobalFilter, retireGlobalFilter, setGlobalOverride, startAutoSync } from "@/lib/cloud";
import { isLocalAddress } from "@/lib/export";
import { DevicesView, type Seen } from "@/views/DevicesView";
import { IpStorageView } from "@/views/IpStorageView";
import { HelpView } from "@/views/HelpView";
import { blankFilter, fromStored, newId, type Filter } from "@/lib/filters";
import { FiltersView } from "@/views/FiltersView";
import { CaptureView } from "@/views/CaptureView";
import { VpnView } from "@/views/VpnView";
import { HotspotView } from "@/views/HotspotView";
import { SettingsView } from "@/views/SettingsView";
import { UpdateNow } from "@/components/UpdateNow";
import { TopNav } from "@/components/TopNav";

const NAV = [
  { id: "capture", label: "Capture" },
  { id: "filters", label: "Filters" },
  { id: "devices", label: "Devices" },
  { id: "ip-storage", label: "IP Storage" },
  { id: "vpn", label: "VPN" },
  { id: "hotspot", label: "Hotspot" },
] as const;

const NAV_END = [
  { id: "help", label: "Help" },
  { id: "settings", label: "Settings" },
] as const;

type ViewId = (typeof NAV)[number]["id"] | (typeof NAV_END)[number]["id"];

export default function App() {
  const [view, setView] = useState<ViewId>("capture");
  const [filters, setFilters] = useState<Filter[]>([]);
  const [globalFilters, setGlobalFilters] = useState<Filter[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [scanHosts, setScanHosts] = useState<ScanHost[]>([]);

  const [seen, setSeen] = useState<Record<string, Seen>>({});
  const [update, setUpdate] = useState<UpdateInfo | null>(null);

  // One check at start-up. If the user turned checking off, this makes no request.
  useEffect(() => {
    api.checkUpdate().then(setUpdate).catch(() => {});
  }, []);

  // A sync that changed the saved filter list: show the new list.
  useEffect(() => {
    const reload = () =>
      api
        .getFilters()
        .then((raw) => {
          latest.current = fromStored(raw);
          setFilters(latest.current);
        })
        .catch(() => {});
    window.addEventListener(FILTERS_SYNCED, reload);
    return () => window.removeEventListener(FILTERS_SYNCED, reload);
  }, []);

  // Optional account sync. Does nothing unless the user signed in and turned it on.
  useEffect(() => startAutoSync(), []);

  // The filters an admin published for every signed-in account, and whether this account is the admin.
  // Empty and false while signed out; a sync refreshes this list the same way it refreshes your own filters.
  useEffect(() => {
    const reload = () =>
      loadSession()
        .then((s) => (s ? getGlobalFilters() : null))
        .then((r) => {
          setGlobalFilters(r?.filters ?? []);
          setIsAdmin(r?.admin ?? false);
        })
        .catch(() => {
          setGlobalFilters([]);
          setIsAdmin(false);
        });
    reload();
    window.addEventListener(GLOBAL_FILTERS_SYNCED, reload);
    return () => window.removeEventListener(GLOBAL_FILTERS_SYNCED, reload);
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

  // Right-click "Hide ISP" in Capture: a Hide filter for that ISP, switched on. Made once, then reused.
  // The filter box is comma-separated, so "Cloudflare, Inc." is saved as "Cloudflare" (a part of the name is enough).
  const hideIsp = useCallback(
    async (isp: string) => {
      const name = `Hide ISP: ${isp}`;
      const list = latest.current;
      const have = list.find((f) => f.name === name);
      const next = have
        ? list.map((f) => (f.id === have.id ? { ...f, enabled: true } : f))
        : [...list, { ...blankFilter(newId()), name: name.slice(0, 80), mode: "hide" as const, isps: isp.split(",")[0].trim().slice(0, 120), enabled: true }];
      await saveFilters(next);
    },
    [saveFilters]
  );

  const toggleGlobalFilter = useCallback((f: Filter) => setGlobalOverride(f.globalId!, !f.enabled), []);
  const publishGlobal = useCallback((f: Filter) => publishGlobalFilter(f), []);
  const editGlobal = useCallback((id: string, f: Filter) => editGlobalFilter(id, f), []);
  const retireGlobal = useCallback((id: string) => retireGlobalFilter(id), []);

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

  // A page that was hidden restarts its entrance animation when it is shown again.
  const pane = (id: ViewId, fill = "") => (view === id ? `view-enter page ${fill}` : "hidden");

  return (
    <div className="relative flex h-screen flex-col">
      <div className="ember-bg" aria-hidden="true">
        <span className="ember-orb a" />
        <span className="ember-orb b" />
      </div>
      <header className="relative z-10 px-6 pt-4">
        {update?.status === "available" && (
          <div
            role="status"
            className="glass glass-blur anim-drop mb-3 flex items-center justify-between gap-3 rounded-pill py-2 pl-5 pr-2 text-sm text-text"
          >
            <span>{update.message} {update.canInstall ? "The app downloads it, checks it and opens the installer." : "Details are in Settings."}</span>
            {update.canInstall ? <UpdateNow /> : <button
              type="button"
              onClick={() => setView("settings")}
              className="rounded-pill bg-[linear-gradient(135deg,#c43e52,#a82f42)] px-4 py-1.5 font-semibold text-on-accent transition-transform duration-base ease-brand hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
            >
              Open Settings
            </button>}
          </div>
        )}
        <TopNav items={NAV} trailing={NAV_END} active={view} onSelect={(id) => setView(id as ViewId)} />
      </header>
      <main className="relative z-10 min-h-0 flex-1 overflow-auto px-6 pb-6 pt-6">
        <div className="mx-auto h-full w-full max-w-[1400px]">
          {/* Every view stays mounted so a running capture keeps its table while Settings is open. */}
          <div className={pane("capture", "h-full")}>
            <CaptureView filters={filters} globalFilters={globalFilters} onToggle={toggleFilter} onHideIsp={hideIsp} onSeen={onSeen} />
          </div>
          <div className={pane("filters")}>
            <FiltersView
              filters={filters}
              onChange={saveFilters}
              globalFilters={globalFilters}
              isAdmin={isAdmin}
              onToggleGlobal={toggleGlobalFilter}
              onPublishGlobal={publishGlobal}
              onEditGlobal={editGlobal}
              onRetireGlobal={retireGlobal}
            />
          </div>
          <div className={pane("devices")}>
            <DevicesView seen={devices} onWatch={watchDevice} onHosts={setScanHosts} />
          </div>
          <div className={pane("ip-storage")}>
            <IpStorageView />
          </div>
          <div className={pane("vpn", "h-full")}>{view === "vpn" && <VpnView />}</div>
          <div className={pane("hotspot")}>{view === "hotspot" && <HotspotView />}</div>
          <div className={pane("help")}>
            <HelpView />
          </div>
          <div className={pane("settings")}>
            <SettingsView update={update} onUpdate={setUpdate} />
          </div>
        </div>
      </main>
    </div>
  );
}
