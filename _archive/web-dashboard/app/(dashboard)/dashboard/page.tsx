// S03 — Dashboard home.
import Link from "next/link";
import { Card, NestedRow } from "@/components/ui/Card";
import { NetworkIcon, FilterIcon, BellIcon } from "@/components/ui/icons";
import { getProfile } from "@/lib/data";

const QUICK_ACTIONS = [
  { href: "/filters", title: "Packet filters", subtitle: "Manage your network filters", icon: FilterIcon },
  { href: "/downloads", title: "Downloads", subtitle: "Get the latest version", icon: NetworkIcon },
  { href: "/store", title: "Store", subtitle: "Browse available products", icon: NetworkIcon },
  { href: "/support", title: "Support", subtitle: "Get help from our team", icon: BellIcon },
];

const UPDATES = [
  { title: "Welcome to your dashboard", body: "This is where you'll manage filters, devices, and billing.", age: "today" },
  { title: "Two-factor authentication is on", body: "Your account is protected with an authenticator app.", age: "today" },
];

export default async function DashboardHomePage() {
  const profile = await getProfile();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-text">Welcome back, {profile.displayName}</h1>
        <p className="mt-1 text-sm text-muted">
          Scan your own network, manage filters, and keep an eye on your account.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="text-sm font-semibold text-text">Quick actions</h2>
          <div className="mt-4 space-y-2">
            {QUICK_ACTIONS.map(({ href, title, subtitle, icon: Icon }) => (
              <Link key={href} href={href} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-md">
                <NestedRow className="flex items-center gap-3 transition-colors duration-fast hover:bg-surface">
                  <Icon className="h-5 w-5 text-muted" />
                  <div>
                    <p className="text-sm font-medium text-text">{title}</p>
                    <p className="text-xs text-muted">{subtitle}</p>
                  </div>
                </NestedRow>
              </Link>
            ))}
          </div>
        </Card>

        <Card>
          <h2 className="text-sm font-semibold text-text">Latest updates</h2>
          <div className="mt-4 space-y-2">
            {UPDATES.map((u) => (
              <NestedRow key={u.title}>
                <p className="text-sm font-medium text-text">{u.title}</p>
                <p className="mt-0.5 text-xs text-muted">{u.body}</p>
                <p className="mt-1 text-xs text-muted">{u.age}</p>
              </NestedRow>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
