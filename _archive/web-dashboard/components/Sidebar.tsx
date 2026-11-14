"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_MAIN, NAV_SHOP, NAV_SUPPORT, type NavItem } from "@/lib/nav";
import { LockIcon } from "@/components/ui/icons";
import { signOut } from "@/app/auth/actions";

function NavLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = pathname === item.href;
  return (
    <Link
      href={item.locked ? "#" : item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      aria-disabled={item.locked || undefined}
      className={`flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors duration-fast
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent
        ${active ? "border-l-2 border-accent bg-surface text-text" : "text-muted hover:bg-surface hover:text-text"}
        ${item.locked ? "opacity-50" : ""}`}
    >
      <span>{item.label}</span>
      {item.locked && <LockIcon className="h-4 w-4" />}
    </Link>
  );
}

function Group({ title, items, onNavigate }: { title?: string; items: NavItem[]; onNavigate?: () => void }) {
  return (
    <div className="space-y-1">
      {title && <p className="px-3 text-xs font-semibold uppercase tracking-wide text-muted">{title}</p>}
      {items.map((item) => (
        <NavLink key={item.href} item={item} onNavigate={onNavigate} />
      ))}
    </div>
  );
}

export function Sidebar({ email, onNavigate }: { email: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="flex h-full min-h-screen w-60 flex-col gap-6 overflow-y-auto border-r border-border bg-bg p-4">
      <Link href="/dashboard" onClick={onNavigate} className="px-2 text-base font-bold text-text">
        Network Toolkit
      </Link>
      <Group title="Navigation" items={NAV_MAIN} onNavigate={onNavigate} />
      <Group title="Shop" items={NAV_SHOP} onNavigate={onNavigate} />
      <Group title="Support & Settings" items={NAV_SUPPORT} onNavigate={onNavigate} />
      <div className="mt-auto space-y-2 rounded-md border border-border bg-surface p-2">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-pill bg-accent text-on-accent text-sm font-semibold"
          >
            {email.charAt(0).toUpperCase() || "?"}
          </span>
          <p className="min-w-0 truncate text-xs font-medium text-text" title={email}>
            {email}
          </p>
        </div>
        <form action={signOut}>
          <button
            type="submit"
            className="w-full rounded-md px-2 py-1.5 text-left text-xs font-medium text-muted hover:bg-border hover:text-text
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Sign out
          </button>
        </form>
      </div>
    </nav>
  );
}
