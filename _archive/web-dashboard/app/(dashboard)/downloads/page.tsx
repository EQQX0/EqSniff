// S23 — Downloads. The desktop app itself (Tauri/Rust) is a separate build
// track not produced in this pass — see replica/build-log.md.
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

const PLATFORMS = ["Windows", "macOS", "Linux"] as const;

export default function DownloadsPage() {
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-text">Downloads</h1>
        <p className="mt-1 text-sm text-muted">Get the desktop app for your platform.</p>
      </div>

      <div className="flex gap-2">
        {PLATFORMS.map((p, i) => (
          <Button key={p} variant={i === 0 ? "secondary" : "ghost"} size="sm" disabled={i !== 0}>
            {p}
          </Button>
        ))}
      </div>

      <Card className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-base font-semibold text-text">Network Toolkit</p>
            <Badge tone="success">Owned</Badge>
          </div>
          <p className="mt-1 text-xs text-muted">Capture and analyze traffic on your own network.</p>
        </div>
        <Button>Download for Windows</Button>
      </Card>

      <Card>
        <h2 className="text-sm font-semibold text-text">Installation help</h2>
        <p className="mt-2 text-sm text-muted">
          Some antivirus software may flag the installer because it installs a packet-capture driver.
          That&apos;s expected for this kind of tool — check our support article if you&apos;re unsure.
        </p>
      </Card>
    </div>
  );
}
