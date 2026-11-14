import { useEffect, useState } from "react";
import { api, type Settings } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Switch } from "@/components/ui/Switch";

export function SettingsView() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [folder, setFolder] = useState("");
  const [error, setError] = useState<string | null>(null);

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
    } catch (e) {
      setSettings(previous);
      setError(String(e));
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

      <Card className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-text">Check for updates</h2>
          <p className="mt-1 text-xs text-muted">
            The only time this app uses the internet. Turn it off and it never connects. The update service is not
            connected in this build yet.
          </p>
        </div>
        {settings && (
          <Switch label="Check for updates" checked={settings.updateCheck} onChange={toggleUpdates} />
        )}
      </Card>

      <Card className="space-y-2">
        <h2 className="text-sm font-semibold text-text">Where your data lives</h2>
        <p className="text-xs text-muted">Settings, filters and labels are stored in this folder. Copy it to back up.</p>
        <code className="block break-all rounded-md bg-bg px-3 py-2 text-xs text-text">{folder || "…"}</code>
      </Card>
    </div>
  );
}
