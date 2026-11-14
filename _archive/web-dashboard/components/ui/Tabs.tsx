"use client";

import { ReactNode, useState } from "react";

interface Tab {
  id: string;
  label: ReactNode;
  panel: ReactNode;
}

export function Tabs({ tabs, defaultTab }: { tabs: Tab[]; defaultTab?: string }) {
  const [active, setActive] = useState(defaultTab ?? tabs[0]?.id);
  return (
    <div>
      <div role="tablist" className="inline-flex gap-1 rounded-md border border-border bg-bg p-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={active === tab.id}
            onClick={() => setActive(tab.id)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-fast
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent
              ${active === tab.id ? "bg-surface text-text" : "text-muted hover:text-text"}`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div key={tab.id} role="tabpanel" hidden={active !== tab.id} className="mt-5">
          {tab.panel}
        </div>
      ))}
    </div>
  );
}
