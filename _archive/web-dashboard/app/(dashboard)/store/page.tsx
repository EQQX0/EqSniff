// S16 — Store / checkout entry. Real checkout is a Stripe Checkout
// redirect per architecture.md's /api/checkout — this is the plan picker.
import { Card } from "@/components/ui/Card";
import { RedirectButton } from "@/components/RedirectButton";
import { getLicenses } from "@/lib/data";

const PLANS = [
  {
    id: "base",
    name: "Network Toolkit",
    price: "$19.99",
    cadence: "one-time",
    features: ["Live packet capture", "Custom + built-in filters", "Device discovery on your network", "Export to CSV/JSON/TXT"],
  },
  {
    id: "traffic_control",
    name: "Traffic Control",
    price: "$5.99",
    cadence: "per month",
    features: ["Drop, lag, throttle, reorder, duplicate — on your own device traffic", "Live stats", "Emergency stop"],
  },
];

export default async function StorePage() {
  const owned = new Set((await getLicenses()).filter((l) => l.status !== "canceled").map((l) => l.product));
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-text">Store</h1>
        <p className="mt-1 text-sm text-muted">Pick what you need. No hidden fees.</p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        {PLANS.map((p) => (
          <Card key={p.id} className="flex flex-col">
            <h2 className="text-base font-semibold text-text">{p.name}</h2>
            <p className="mt-2 text-2xl font-bold text-text">
              {p.price} <span className="text-sm font-normal text-muted">{p.cadence}</span>
            </p>
            <ul className="mt-4 flex-1 space-y-2 text-sm text-muted">
              {p.features.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            {owned.has(p.id as "base" | "traffic_control") ? (
              <p className="mt-6 text-sm font-medium text-success">You own this</p>
            ) : (
              <RedirectButton className="mt-6" endpoint="/api/checkout" body={{ product: p.id }}>
                Purchase
              </RedirectButton>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
