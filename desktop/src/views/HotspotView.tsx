import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  type HotspotDevice,
  type HotspotStatus,
  type SharingAdapter,
  type SharingStatus,
} from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { NetworkIcon, EyeIcon, EyeOffIcon } from "@/components/ui/icons";

const FIELD =
  "h-11 w-full rounded-md border border-border-input bg-bg px-3 text-sm text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50";

export function HotspotView() {
  const [hs, setHs] = useState<HotspotStatus | null>(null);
  const [sharing, setSharing] = useState<SharingStatus | null>(null);
  const [adapters, setAdapters] = useState<SharingAdapter[]>([]);
  const [devices, setDevices] = useState<HotspotDevice[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [ssid, setSsid] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [pub, setPub] = useState("");
  const [priv, setPriv] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const seeded = useRef(false);

  const privIp = useMemo(() => {
    if (sharing?.on) return null; // Windows gives the private side its own fixed address
    return adapters.find((a) => a.name === priv)?.ipv4 ?? null;
  }, [adapters, priv, sharing]);

  const refresh = useCallback(async () => {
    const [h, s, a] = await Promise.allSettled([api.hotspotStatus(), api.sharingStatus(), api.sharingAdapters()]);
    if (h.status === "fulfilled") {
      setHs(h.value);
      if (!seeded.current) {
        seeded.current = true;
        setSsid(h.value.ssid);
      }
    } else setError(String(h.reason));
    if (s.status === "fulfilled") {
      setSharing(s.value);
      if (s.value.public) setPub(s.value.public);
      if (s.value.private) setPriv(s.value.private);
    } else setError(String(s.reason));
    if (a.status === "fulfilled") setAdapters(a.value);
    setLoaded(true);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 6000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    let live = true;
    const load = () =>
      api
        .hotspotDevices(privIp)
        .then((d) => live && setDevices(d))
        .catch(() => live && setDevices([]));
    load();
    const id = setInterval(load, 6000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [privIp]);

  async function waitJob() {
    for (;;) {
      await new Promise((r) => setTimeout(r, 500));
      const j = await api.hotspotJob();
      if (!j.running) {
        if (j.error) throw j.error;
        return;
      }
    }
  }

  async function run(label: string, work: () => Promise<unknown>, done?: string) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      await work();
      if (done) setNotice(done);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
      refresh();
    }
  }

  const save = () =>
    run("save", async () => {
      await api.hotspotSave(ssid,password || null);
      setPassword("");
      setShowPw(false);
    }, "Saved.");

  const on = hs?.state === "on";
  const noWifi = hs != null && !hs.wifiAvailable;
  const canStart = !!hs && hs.wifiAvailable && hs.hasPassword && !!hs.ssid && !busy;

  const visible = useMemo(
    () => adapters.filter((a) => showAll || (a.connected && !a.isVirtual) || a.name === pub || a.name === priv),
    [adapters, showAll, pub, priv]
  );

  const sharingBusy = busy === "apply" || busy === "reset";
  const canApply = !!pub && !!priv && pub !== priv && !sharing?.on && !busy;

  function options(exclude: string) {
    return visible.map((a) => (
      <option key={a.name} value={a.name} disabled={a.name === exclude}>
        {a.name} ({a.description}){a.connected ? "" : " - not connected"}
      </option>
    ));
  }

  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-text">Hotspot</h1>
        <p className="mt-1 text-sm text-muted">
          Share this PC's internet with your own console or devices, using a Windows hotspot or by sharing one network
          adapter through another. Windows does the sharing; the app switches it on and off.
        </p>
      </div>

      <div role="status" aria-live="polite" className="min-h-0">
        {notice && <p className="rounded-md border border-success px-3 py-2 text-sm text-success">{notice}</p>}
      </div>
      {error && (
        <p role="alert" className="rounded-md border border-danger px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
        <Card aria-labelledby="hs-title" className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="hs-title" className="mr-auto text-base font-semibold text-text">
              Hotspot
            </h2>
            <span aria-live="polite" className="flex flex-wrap gap-2">
              <Badge tone={on ? "success" : "neutral"}>{!loaded ? "Checking" : on ? "ON" : "OFF"}</Badge>
              <Badge tone="neutral">{hs?.ssid ? hs.ssid : "No name saved"}</Badge>
              <Badge tone="neutral">
                {hs?.clients ?? 0} {hs?.clients === 1 ? "client" : "clients"}
              </Badge>
            </span>
          </div>

          {noWifi && (
            <p role="note" className="rounded-md border border-border bg-bg px-3 py-2 text-sm text-text">
              {hs?.message}
            </p>
          )}
          {!noWifi && hs?.message && <p className="text-xs text-muted">{hs.message}</p>}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="hs-ssid" className="text-sm font-medium text-text">
              Hotspot name (SSID)
            </label>
            <input
              id="hs-ssid"
              className={FIELD}
              value={ssid}
              maxLength={32}
              autoComplete="off"
              spellCheck={false}
              disabled={on || !!busy}
              onChange={(e) => setSsid(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="hs-pass" className="text-sm font-medium text-text">
              Password (WPA2)
            </label>
            <div className="relative">
              <input
                id="hs-pass"
                className={`${FIELD} pr-12`}
                type={showPw ? "text" : "password"}
                value={password}
                maxLength={63}
                autoComplete="new-password"
                spellCheck={false}
                placeholder={hs?.hasPassword ? "Saved. Type to change it." : "8 to 63 characters"}
                aria-describedby="hs-pass-hint"
                disabled={on || !!busy}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                aria-pressed={showPw}
                aria-label={showPw ? "Hide password" : "Show password"}
                className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-md text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {showPw ? <EyeOffIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
              </button>
            </div>
            <p id="hs-pass-hint" className="text-xs text-muted">
              The eye shows only what you typed just now. A saved password stays hidden.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" className="min-h-11" loading={busy === "save"} disabled={on || (!!busy && busy !== "save")} onClick={save}>
              Save
            </Button>
            {on ? (
              <Button
                variant="danger"
                className="min-h-11"
                loading={busy === "stop"}
                disabled={!!busy && busy !== "stop"}
                onClick={() => run("stop", async () => { await api.hotspotStop(); await waitJob(); }, "Hotspot stopped.")}
              >
                Stop Hotspot
              </Button>
            ) : (
              <Button
                className="min-h-11"
                loading={busy === "start"}
                disabled={!canStart && busy !== "start"}
                onClick={() => run("start", async () => { await api.hotspotStart(); await waitJob(); }, "Hotspot started.")}
              >
                Start Hotspot
              </Button>
            )}
          </div>
          {!noWifi && !hs?.hasPassword && loaded && (
            <p className="text-xs text-muted">Save a name and a password first, then start the hotspot.</p>
          )}
        </Card>

        <Card aria-labelledby="sh-title" className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="sh-title" className="mr-auto text-base font-semibold text-text">
              Sharing / Bridge
            </h2>
            <span aria-live="polite">
              <Badge tone={sharing?.on ? "success" : "neutral"}>{!loaded ? "Checking" : sharing?.on ? "ON" : "OFF"}</Badge>
            </span>
          </div>

          {sharing?.on && !sharing.byApp && (
            <p role="alert" className="rounded-md border border-danger bg-danger/15 px-3 py-2 text-sm text-text">
              Internet sharing is already on and was not set up here. Turn it off in Windows (network adapter
              properties, Sharing tab), or press Reset, before you change adapters.
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="sh-pub" className="text-sm font-medium text-text">
              Public adapter (internet source)
            </label>
            <select id="sh-pub" className={FIELD} value={pub} disabled={!!sharing?.on || !!busy} onChange={(e) => setPub(e.target.value)}>
              <option value="">Choose an adapter</option>
              {options(priv)}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="sh-priv" className="text-sm font-medium text-text">
              Private adapter (to console or device)
            </label>
            <select id="sh-priv" className={FIELD} value={priv} disabled={!!sharing?.on || !!busy} onChange={(e) => setPriv(e.target.value)}>
              <option value="">Choose an adapter</option>
              {options(pub)}
            </select>
          </div>

          <label className="flex min-h-11 items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              className="h-5 w-5 accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
            />
            Show all adapters (including disconnected and virtual)
          </label>

          <div className="flex flex-wrap gap-2" aria-live="polite">
            {pub && <Badge tone="accent">{pub} · public</Badge>}
            {priv && <Badge tone="accent">{priv} · private</Badge>}
            {!pub && !priv && <Badge tone="neutral">No adapters chosen</Badge>}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              className="min-h-11"
              loading={busy === "apply"}
              disabled={!canApply && busy !== "apply"}
              onClick={() => run("apply", async () => { await api.sharingApply(pub, priv); await waitJob(); }, "Sharing is on.")}
            >
              Share internet
            </Button>
            <Button
              variant="secondary"
              className="min-h-11"
              loading={busy === "reset"}
              disabled={!!busy && busy !== "reset"}
              onClick={() => run("reset", async () => { await api.sharingReset(); await waitJob(); }, "Sharing reset.")}
            >
              Reset
            </Button>
            <Button
              variant="danger"
              className="min-h-11"
              disabled={!sharing?.on || !!busy}
              onClick={() => run("reset", async () => { await api.sharingReset(); await waitJob(); }, "Sharing is off.")}
            >
              Disable Sharing
            </Button>
          </div>
          {sharingBusy && (
            <p className="text-xs text-muted">Waiting for Windows. Press Yes on the permission prompt if it appears.</p>
          )}
        </Card>
      </div>

      <Card aria-labelledby="dev-title" className="space-y-3">
        <h2 id="dev-title" className="text-base font-semibold text-text">
          Connected devices
        </h2>
        {devices.length === 0 ? (
          <EmptyState
            icon={<NetworkIcon className="h-6 w-6" />}
            title="No connected devices detected yet."
            body="Devices appear here after they join the hotspot or the shared cable and send some traffic."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted">
                <tr>
                  <th scope="col" className="py-2 pr-4 font-medium">Name</th>
                  <th scope="col" className="py-2 pr-4 font-medium">IP</th>
                  <th scope="col" className="py-2 font-medium">MAC</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {devices.map((d) => (
                  <tr key={d.mac + d.ip}>
                    <td className="py-2 pr-4 text-text">{d.name}</td>
                    <td className="py-2 pr-4 font-mono text-text">{d.ip}</td>
                    <td className="py-2 font-mono text-text">{d.mac}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
