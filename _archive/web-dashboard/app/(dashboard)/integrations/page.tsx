// S13 — PSN / Xbox account linking for auto-filter. OAuth only; see
// architecture.md's /api/integrations routes.
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { getLinkedAccounts } from "@/lib/data";

const PLATFORM_LABEL = { psn: "PlayStation Network", xbox: "Xbox Live" } as const;

export default async function IntegrationsPage() {
  const accounts = await getLinkedAccounts();
  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-text">Linked accounts</h1>
        <p className="mt-1 text-sm text-muted">
          Link your platform account so filters can switch automatically when you change games.
        </p>
      </div>

      <div className="space-y-4">
        {accounts.map((a) => (
          <Card key={a.id} className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-text">{PLATFORM_LABEL[a.platform]}</p>
              <p className="mt-1 text-xs text-muted">
                {a.status === "linked" && a.displayName}
                {a.status === "not_linked" && "Not linked"}
                {a.status === "token_expired" && "Connection expired — reconnect to keep auto-filter working"}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {a.status === "linked" && <Badge tone="success">Linked</Badge>}
              {a.status === "token_expired" && <Badge tone="danger-soft">Expired</Badge>}
              <Button variant={a.status === "linked" ? "secondary" : "primary"} size="sm">
                {a.status === "linked" ? "Unlink" : "Connect"}
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
