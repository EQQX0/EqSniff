// S27 — Billing & invoices. Invoice list is read live from Stripe once
// replica-backend runs; no invoices table in our own schema (see
// architecture.md). Amounts are stored in cents, formatted here.
import { StatTile } from "@/components/ui/StatTile";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { RedirectButton } from "@/components/RedirectButton";
import { getInvoices } from "@/lib/data";

function money(cents: number) {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default async function BillingPage() {
  const invoices = await getInvoices();
  const totalPaid = invoices.reduce((sum, i) => sum + i.paid, 0);
  const outstanding = invoices.reduce((sum, i) => sum + (i.total - i.paid), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-text">Billing &amp; invoices</h1>
          <p className="mt-1 text-sm text-muted">View your billing history.</p>
        </div>
        <RedirectButton variant="secondary" endpoint="/api/billing/portal" className="w-44">
          Manage billing
        </RedirectButton>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Total invoices" value={invoices.length} />
        <StatTile label="Total paid" value={money(totalPaid)} />
        <StatTile label="Outstanding" value={money(outstanding)} />
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[28rem] text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
              <th scope="col" className="pb-2 font-semibold">Invoice</th>
              <th scope="col" className="pb-2 font-semibold">Status</th>
              <th scope="col" className="pb-2 font-semibold">Total</th>
              <th scope="col" className="pb-2 font-semibold">Due</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((i) => (
              <tr key={i.id} className="border-b border-border last:border-0">
                <td className="py-2 font-medium text-text">{i.productLabel}</td>
                <td className="py-2">
                  <Badge tone={i.status === "paid" ? "success" : "neutral"}>{i.status}</Badge>
                </td>
                <td className="py-2 text-muted">{money(i.total)}</td>
                <td className="py-2 text-muted">{i.dueDate}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
