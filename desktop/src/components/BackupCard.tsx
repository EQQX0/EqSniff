import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { buildBackup, restoreBackup } from "@/lib/backup";
import { download } from "@/lib/export";

/** Export or import everything in one file: IP Storage, filters and VPN tunnels. Works signed in or out. */
export function BackupCard() {
  const pick = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(task: () => Promise<string>) {
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ ok: true, text: await task() });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  const exportAll = () =>
    run(async () => {
      const { text, summary } = await buildBackup();
      download(`eqnetwork-backup-${new Date().toISOString().slice(0, 10)}.json`, text, "application/json");
      return `Exported ${summary.ips} IP address${summary.ips === 1 ? "" : "es"}, ${summary.filters} filter${summary.filters === 1 ? "" : "s"} and ${summary.tunnels} tunnel${summary.tunnels === 1 ? "" : "s"}.`;
    });

  const importAll = (file: File | undefined) =>
    run(async () => {
      if (!file) return "No file chosen.";
      const { added, skipped, notes } = await restoreBackup(await file.text());
      if (pick.current) pick.current.value = "";
      return [`Imported ${added.ips} IP address${added.ips === 1 ? "" : "es"}, ${added.filters} filter${added.filters === 1 ? "" : "s"} (switched off) and ${added.tunnels} tunnel${added.tunnels === 1 ? "" : "s"}.`, skipped ? `${skipped} already here, left as they are.` : "", ...notes].filter(Boolean).join(" ");
    });

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-text">Export and import everything</h2>
        <p className="mt-1 text-xs text-muted">
          Save your IP Storage, filters and VPN tunnels in one file, or add the contents of a file made this way. Importing never
          overwrites what you already have, and imported filters start switched off. The file holds tunnel private keys in plain
          text, so keep it somewhere private. If you are signed in, imported items sync to your account.
        </p>
      </div>
      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={`rounded-md border px-3 py-2 text-xs ${msg.ok ? "border-border bg-black/25 text-text" : "border-danger text-danger"}`}>
          {msg.text}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button size="sm" variant="secondary" onClick={exportAll} loading={busy}>
          Export everything
        </Button>
        <Button size="sm" variant="secondary" onClick={() => pick.current?.click()} loading={busy}>
          Import file
        </Button>
        <input ref={pick} type="file" accept="application/json,.json" className="hidden" aria-label="Choose a backup file to import" onChange={(e) => importAll(e.target.files?.[0])} />
      </div>
    </Card>
  );
}
