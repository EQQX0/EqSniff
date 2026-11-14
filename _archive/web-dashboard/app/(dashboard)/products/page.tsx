// S26 — My products / entitlements.
import { StatTile } from "@/components/ui/StatTile";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { getLicenses } from "@/lib/data";

const PRODUCT_LABEL = { base: "Network Toolkit", traffic_control: "Traffic Control" } as const;

export default async function ProductsPage() {
  const licenses = await getLicenses();
  const subscriptions = licenses.filter((l) => l.billingType === "subscription").length;
  const oneTime = licenses.filter((l) => l.billingType === "one_time").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-text">My products</h1>
        <p className="mt-1 text-sm text-muted">View and manage what you own.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Active products" value={licenses.filter((l) => l.status === "active").length} />
        <StatTile label="Subscriptions" value={subscriptions} />
        <StatTile label="One-time products" value={oneTime} />
      </div>

      <div className="space-y-3">
        {licenses.map((l) => (
          <Card key={l.id} className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-text">{PRODUCT_LABEL[l.product]}</p>
              <p className="text-xs text-muted">Activated {l.purchasedAt}</p>
            </div>
            <Badge tone={l.status === "active" ? "success" : "danger-soft"}>
              {l.status === "active" ? "Active" : l.status}
            </Badge>
          </Card>
        ))}
      </div>
    </div>
  );
}
