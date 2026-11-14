// S25 — Xbox add-on upsell shell. Kept per features.csv as "Xbox account
// link (gamertag display only, no messages/party actions)". Party Chat,
// the Gamertag Resolver, and full account sync are NOT listed as unlocks
// here — see replica/recon.md skip list (Xbox Toolkit).
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { LockIcon } from "@/components/ui/icons";

const UNLOCKS = [
  { title: "Gamertag display", body: "Show your linked Xbox gamertag in the dashboard." },
  { title: "Auto-filter by game", body: "Switch packet filters automatically as you change games." },
  { title: "Connection status", body: "See whether your Xbox integration token is still valid." },
];

export default function XboxPage() {
  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-text">Xbox integration</h1>
        <p className="mt-1 text-sm text-muted">Link your Xbox account for gamertag display and auto-filtering.</p>
      </div>

      <Card className="space-y-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-pill bg-bg text-muted">
            <LockIcon className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold text-text">Subscription required</p>
            <p className="text-xs text-muted">An active Xbox add-on is required to unlock this.</p>
          </div>
        </div>
        <Button>Visit store</Button>
      </Card>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-text">What you get</h2>
        {UNLOCKS.map((u) => (
          <Card key={u.title}>
            <p className="text-sm font-medium text-text">{u.title}</p>
            <p className="mt-1 text-xs text-muted">{u.body}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
