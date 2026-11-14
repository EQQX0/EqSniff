"use client";

import { ReactNode, useEffect, useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import { BellIcon } from "@/components/ui/icons";

/** Sidebar is persistent from md up; below that it is an off-canvas drawer. */
export function DashboardShell({ email, children }: { email: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="flex min-h-screen">
      <div
        className={`fixed inset-y-0 left-0 z-40 transform transition-transform duration-base ease-brand
          md:static md:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        <Sidebar email={email} onNavigate={() => setOpen(false)} />
      </div>
      {open && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <div className="min-w-0 flex-1">
        <header className="flex h-14 items-center justify-between border-b border-border px-4 md:justify-end md:px-6">
          <button
            type="button"
            aria-label="Open menu"
            aria-expanded={open}
            onClick={() => setOpen(true)}
            className="rounded-md p-2 text-muted hover:bg-surface hover:text-text md:hidden
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
              <path d="M3.5 5.5h13M3.5 10h13M3.5 14.5h13" />
            </svg>
          </button>
          <button
            type="button"
            aria-label="Notifications"
            className="rounded-md p-2 text-muted hover:bg-surface hover:text-text
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <BellIcon className="h-5 w-5" />
          </button>
        </header>
        <main className="p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
