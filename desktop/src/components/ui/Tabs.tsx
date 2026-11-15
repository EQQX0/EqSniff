
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
      <div role="tablist" className="glass inline-flex gap-1 rounded-pill p-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={active === tab.id}
            onClick={() => setActive(tab.id)}
            className={`rounded-pill px-4 py-1.5 text-sm font-medium transition-all duration-base ease-brand
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft
              ${active === tab.id ? "bg-[linear-gradient(135deg,#c43e52,#a82f42)] text-on-accent shadow-[0_6px_18px_rgba(168,47,66,0.4)]" : "text-muted hover:bg-white/10 hover:text-text"}`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div key={tab.id} role="tabpanel" hidden={active !== tab.id} className="anim-fade mt-5">
          {tab.panel}
        </div>
      ))}
    </div>
  );
}
