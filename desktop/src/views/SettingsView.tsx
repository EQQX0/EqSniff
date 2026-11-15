import { useEffect, useState } from "react";
import { api, type Settings, type UpdateInfo } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Switch } from "@/components/ui/Switch";

interface Props {
  update: UpdateInfo | null;
  onUpdate: (u: UpdateInfo) => void;
}

export function SettingsView({ update, onUpdate }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [folder, setFolder] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    Promise.all([api.getSettings(), api.dataFolder()])
      .then(([s, f]) => {
        setSettings(s);
        setFolder(f);
      })
      .catch((e) => setError(String(e)));
  }, []);

  async function toggleUpdates(updateCheck: boolean) {
    if (!settings) return;
    const previous = settings;
    const next = { ...settings, updateCheck };
    setSettings(next);
    try {
      await api.setSettings(next);
      if (!updateCheck) onUpdate(await api.checkUpdate()); // reports "off", sends nothing
    } catch (e) {
      setSettings(previous);
      setError(String(e));
    }
  }

  async function checkNow() {
    setChecking(true);
    try {
      onUpdate(await api.checkUpdate());
    } catch (e) {
      setError(String(e));
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-text">Settings</h1>
        <p className="mt-1 text-sm text-muted">Everything is saved on this computer.</p>
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-danger px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <Card className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-text">Check for updates</h2>
            <p className="mt-1 text-xs text-muted">
              The only time this app uses the internet. It downloads one small version file and sends nothing about you. Turn
              it off and the app never connects.
            </p>
          </div>
          {settings && <Switch label="Check for updates" checked={settings.updateCheck} onChange={toggleUpdates} />}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" variant="secondary" onClick={checkNow} loading={checking} disabled={!settings?.updateCheck}>
            Check now
          </Button>
          <p role="status" className="text-xs text-muted">
            Version {update?.current ?? "…"}
            {update && ` · ${update.message}`}
          </p>
        </div>
        {update?.status === "available" && (
          <div className="rounded-md border border-border bg-black/25 px-3 py-2 text-xs text-text">
            {update.notes && <p>{update.notes}</p>}
            {update.url && <p className="mt-1 break-all">Download: {update.url}</p>}
          </div>
        )}
      </Card>

      <Card className="space-y-2">
        <h2 className="text-sm font-semibold text-text">Where your data lives</h2>
        <p className="text-xs text-muted">Settings, filters and labels are stored in this folder. Copy it to back up.</p>
        <code className="block break-all rounded-md bg-black/25 px-3 py-2 text-xs text-text">{folder || "…"}</code>
      </Card>

      <Card className="space-y-2">
        <h2 className="text-sm font-semibold text-text">Credits</h2>
        <p className="text-xs text-muted">
          Country lookup uses the DB-IP Lite country database, licensed CC BY 4.0. IP Geolocation by DB-IP (db-ip.com). It runs
          on this computer and shows the country only.
        </p>
      </Card>
    </div>
  );
}
