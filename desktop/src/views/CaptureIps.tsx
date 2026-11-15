import { useMemo, useState } from "react";
import type { Country, PacketRow } from "@/lib/api";
import { Flag } from "@/views/CaptureView";
import { NAME_MAX } from "@/lib/ipstore";

export interface IpSummary {
  address: string;
  packets: number;
  bytes: number;
  last: number;
}

/** One line per far-side address, newest first. */
export function summarize(rows: PacketRow[], farOf: (r: PacketRow) => string): IpSummary[] {
  const map = new Map<string, IpSummary>();
  for (const r of rows) {
    const a = farOf(r);
    const hit = map.get(a);
    if (hit) {
      hit.packets++;
      hit.bytes += r.length;
      if (r.time > hit.last) hit.last = r.time;
    } else map.set(a, { address: a, packets: 1, bytes: r.length, last: r.time });
  }
  return [...map.values()].sort((x, y) => y.last - x.last);
}

interface Props {
  items: IpSummary[];
  names: Record<string, string>;
  geo: Record<string, Country>;
  /** Addresses the filters hide. Only passed for the All Traffic list. */
  hidden?: Set<string>;
  onSave: (address: string, value: string) => void;
}

/** The addresses seen in a capture, each with an editable label saved in IP Storage. */
export function IpList({ items, names, geo, hidden, onSave }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter((i) => i.address.toLowerCase().includes(q) || (names[i.address] ?? "").toLowerCase().includes(q)) : items;
  }, [items, names, query]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border p-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search addresses or labels"
          aria-label="Search addresses or labels"
          className="h-8 w-full max-w-xs rounded-pill border border-border bg-white/[0.06] px-3 text-xs text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {shown.length === 0 ? (
          <p className="p-6 text-sm text-muted">{items.length === 0 ? "No addresses yet. Start a capture or open a file." : "Nothing matches that search."}</p>
        ) : (
          <table className="w-full table-fixed text-left text-xs">
            <thead className="sticky top-0 bg-[linear-gradient(180deg,#4a1621,#33101a)] text-text">
              <tr>
                <th className="w-[26%] px-3 py-2 font-semibold">Label</th>
                <th className="w-[22%] px-3 py-2 font-semibold">IP address</th>
                <th className="w-[20%] px-3 py-2 font-semibold">Country</th>
                <th className="w-[10%] px-3 py-2 text-right font-semibold">Packets</th>
                <th className="w-[12%] px-3 py-2 text-right font-semibold">Bytes</th>
                <th className="w-[10%] px-3 py-2 font-semibold">{hidden ? "Filter" : ""}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((i) => {
                const label = names[i.address];
                const hit = geo[i.address];
                return (
                  <tr key={i.address} className="border-b border-border last:border-0 hover:bg-white/[0.05]">
                    <td className="px-3 py-1.5">
                      {editing === i.address ? (
                        <input
                          autoFocus
                          defaultValue={label ?? ""}
                          maxLength={NAME_MAX}
                          aria-label={`Label for ${i.address}`}
                          placeholder="Type a label"
                          onFocus={(e) => e.currentTarget.select()}
                          onBlur={(e) => {
                            setEditing(null);
                            onSave(i.address, e.currentTarget.value);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.currentTarget.blur();
                            if (e.key === "Escape") {
                              e.currentTarget.value = label ?? "";
                              e.currentTarget.blur();
                            }
                          }}
                          className="h-7 w-full rounded-pill border border-accent-soft bg-white/[0.08] px-3 text-xs text-text focus-visible:outline-none"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => setEditing(i.address)}
                          aria-label={`${label ? "Change the label for" : "Add a label for"} ${i.address}`}
                          className={`max-w-full truncate rounded-pill px-2 py-0.5 text-left hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft ${label ? "font-semibold text-text" : "text-muted/70"}`}
                        >
                          {label ?? "+ Add label"}
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-text">{i.address}</td>
                    <td className="px-3 py-1.5 text-text">
                      {hit && (
                        <span className="inline-flex items-center gap-2">
                          <Flag code={hit.code} />
                          <span className="truncate">{hit.name}</span>
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-muted">{i.packets.toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-muted">{i.bytes.toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-muted">{hidden?.has(i.address) ? "Hidden" : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
