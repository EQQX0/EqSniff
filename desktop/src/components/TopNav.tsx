import { useLayoutEffect, useRef, useState } from "react";
import logo from "@/assets/logo.svg";

export interface NavItem {
  id: string;
  label: string;
}

/** Floating glass bar: logo on the left, one sliding pill that follows the active page. */
export function TopNav({
  items,
  trailing,
  active,
  onSelect,
}: {
  items: readonly NavItem[];
  trailing: readonly NavItem[];
  active: string;
  onSelect: (id: string) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);

  useLayoutEffect(() => {
    const box = track.current;
    function place() {
      const el = box?.querySelector<HTMLElement>(`[data-nav="${active}"]`);
      if (!el) return;
      setPill((p) => (p && p.x === el.offsetLeft && p.w === el.offsetWidth ? p : { x: el.offsetLeft, w: el.offsetWidth }));
    }
    place();
    box?.querySelector<HTMLElement>(`[data-nav="${active}"]`)?.scrollIntoView({ inline: "nearest", block: "nearest" });
    const ro = new ResizeObserver(place);
    if (box) ro.observe(box);
    return () => ro.disconnect();
  }, [active]);

  function button(item: NavItem) {
    const on = item.id === active;
    return (
      <button
        key={item.id}
        type="button"
        data-nav={item.id}
        onClick={() => onSelect(item.id)}
        aria-current={on ? "page" : undefined}
        className={`relative z-10 shrink-0 whitespace-nowrap rounded-pill px-3 py-2 text-sm font-medium transition-colors duration-base ease-brand
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-soft
          ${on ? "text-on-accent" : "text-muted hover:text-text"}`}
      >
        {item.label}
      </button>
    );
  }

  return (
    <nav aria-label="Main" className="glass glass-blur anim-drop flex items-center gap-3 rounded-pill py-2 pl-3 pr-2">
      <div className="flex shrink-0 items-center gap-2.5 pr-1">
        <img src={logo} alt="" width={34} height={34} className="h-[34px] w-[34px] rounded-pill" />
        <span className="hidden whitespace-nowrap text-sm font-bold tracking-tight text-text xl:inline">EqNetwork</span>
      </div>
      <div ref={track} className="no-scrollbar relative flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
        {pill && (
          <span
            aria-hidden="true"
            className="absolute bottom-0 left-0 top-0 rounded-pill bg-[linear-gradient(135deg,#c43e52,#a82f42)] 
              transition-[transform,width] duration-slow ease-brand"
            style={{ transform: `translateX(${pill.x}px)`, width: pill.w }}
          />
        )}
        {items.map(button)}
        <span className="min-w-4 flex-1" aria-hidden="true" />
        {trailing.map(button)}
      </div>
    </nav>
  );
}
