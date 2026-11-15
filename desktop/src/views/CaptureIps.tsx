import { useMemo, useRef, useState } from "react";
import type { Country, PacketRow } from "@/lib/api";
import { Flag } from "@/views/CaptureView";
import { isLocalAddress } from "@/lib/export";
import { NAME_MAX } from "@/lib/ipstore";

export interface IpSummary {
  address: string;
  packets: number;
  bytes: number;
  last: number;
  /** Packets that passed the filters when they arrived. */
  passed: number;
  /** Packets sent to this computer by the address, and sent back to it. A player talks both ways, a scanner mostly does not. */
  inbound: number;
  outbound: number;
  /** Service ports (below 49152) seen on either end of packets with this address. Games use these; clients use random high ports. */
  ports: Set<number>;
}

/** Every address seen since the capture started. It is not cut at the table's row limit, so busy traffic never pushes a server out. */
export type IpBook = Map<string, IpSummary>;

/** Adds packets to the book. `passes` says whether a packet gets through the filters switched on right now. */
export function absorb(book: IpBook, rows: PacketRow[], farOf: (r: PacketRow) => string, passes: (r: PacketRow) => boolean, limit = 50000) {
  for (const r of rows) {
    const a = farOf(r);
    let hit = book.get(a);
    if (!hit) {
      if (book.size >= limit) continue;
      hit = { address: a, packets: 0, bytes: 0, last: r.time, passed: 0, inbound: 0, outbound: 0, ports: new Set() };
      book.set(a, hit);
    }
    hit.packets++;
    hit.bytes += r.length;
    if (isLocalAddress(r.src)) hit.outbound++;
    else hit.inbound++;
    if (r.time > hit.last) hit.last = r.time;
    if (passes(r)) hit.passed++;
    for (const pt of [r.srcPort, r.dstPort]) if (pt !== null && pt < 49152 && hit.ports.size < 40) hit.ports.add(pt);
  }
}

/** An address counts as an active connection once it has sent and received at least this many packets. */
export const ACTIVE_EACH_WAY = 5;

/** An address is online while its last packet is newer than this many seconds. */
export const ONLINE_WITHIN = 15;

/** The book as a list, newest first. `onlyFiltered` keeps the addresses that had at least one packet through the filters. */
export function listBook(book: IpBook, onlyFiltered: boolean, serverPort: number | null = null): IpSummary[] {
  let all = [...book.values()];
  // Only real connections from the internet: not local addresses, and not scanners that never really talk back.
  all = all.filter((i) => !isLocalAddress(i.address));
  if (serverPort !== null) all = all.filter((i) => i.ports.has(serverPort));
  all = all.filter((i) => i.inbound >= ACTIVE_EACH_WAY && i.outbound >= ACTIVE_EACH_WAY);
  return (onlyFiltered ? all.filter((i) => i.passed > 0) : all).sort((x, y) => y.packets - x.packets);
}

interface Props {
  items: IpSummary[];
  names: Record<string, string>;
  geo: Record<string, Country>;
  /** Addresses the filters hide. Only passed for the All Traffic list. */
  hidden?: Set<string>;
  onSave: (address: string, value: string) => void;
  /** Reads Minecraft server logs and labels each address with the players who used it. */
  onImportLog?: (files: File[]) => void;
  /** Only addresses that talked to this port on this computer. Empty means all. */
  port: string;
  onPort: (v: string) => void;
  /** Forgets every captured address (saved labels stay). */
  onClear: () => void;
  /** The moment to judge online against, in seconds: now while capturing, the newest packet in a saved file. */
  now: number;
}

/** The addresses seen in a capture, each with an editable label saved in IP Storage. */
export function IpList({ items, names, geo, hidden, onSave, onImportLog, port, onPort, onClear, now }: Props) {
  const logInput = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? items.filter((i) => i.address.toLowerCase().includes(q) || (names[i.address] ?? "").toLowerCase().includes(q)) : items;
    // players who are online come first; each group keeps its order
    const on = (i: IpSummary) => now - i.last <= ONLINE_WITHIN;
    return [...list.filter(on), ...list.filter((i) => !on(i))];
  }, [items, names, query, now]);
  const onlineCount = useMemo(() => items.filter((i) => now - i.last <= ONLINE_WITHIN).length, [items, now]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border p-3">
        <span className="mr-3 inline-flex items-center gap-3 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#3ddc84]" aria-hidden="true" />{onlineCount} online</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#ff4d4d]" aria-hidden="true" />{items.length - onlineCount} offline</span>
        </span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search addresses or labels"
          aria-label="Search addresses or labels"
          className="h-8 w-full max-w-xs rounded-pill border border-border bg-white/[0.06] px-3 text-xs text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
        />
        <label className="ml-3 inline-flex items-center gap-2 text-xs text-muted">
          Server port
          <input
            value={port}
            inputMode="numeric"
            maxLength={5}
            onChange={(e) => onPort(e.target.value.replace(/\D/g, ""))}
            placeholder="all"
            aria-label="Only show addresses that used this server port"
            title="Type the port your game server uses, for example 25565. Only addresses that sent or received on that port are listed, which leaves your players."
            className="h-8 w-20 rounded-pill border border-border bg-white/[0.06] px-3 text-xs text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
          />
        </label>
        <button
          type="button"
          onClick={onClear}
          disabled={items.length === 0}
          title="Forget every captured address and packet so far. Labels saved in IP Storage are kept."
          className="ml-3 h-8 rounded-pill border border-border px-3 text-xs text-text hover:bg-white/[0.08] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
        >
          Clear
        </button>
        {onImportLog && (
          <>
            <button
              type="button"
              onClick={() => logInput.current?.click()}
              title="Pick your Minecraft server's logs\latest.log. Each player's name is saved as the label of the address they joined from."
              className="ml-3 h-8 rounded-pill border border-border px-3 text-xs text-text hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
            >
              Label from Minecraft log
            </button>
            <input
              ref={logInput}
              type="file"
              accept=".log,.txt,text/plain"
              multiple
              className="hidden"
              aria-label="Choose Minecraft server log files"
              onChange={(e) => {
                onImportLog(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
          </>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {shown.length === 0 ? (
          <p className="p-6 text-sm text-muted">{items.length === 0 ? port ? `No address has talked to port ${port} yet.` : "No addresses yet. Start a capture or open a file." : "Nothing matches that search."}</p>
        ) : (
          <table className="w-full table-fixed text-left text-xs">
            <thead className="sticky top-0 bg-[linear-gradient(180deg,#4a1621,#33101a)] text-text">
              <tr>
                <th className="w-[26%] px-3 py-2 font-semibold">Label</th>
                <th className="w-[22%] px-3 py-2 font-semibold">IP address</th>
                <th className="w-[20%] px-3 py-2 font-semibold">Country</th>
                <th className="w-[10%] px-3 py-2 text-right font-semibold" title="Packets in / out">In / out</th>
                <th className="w-[12%] px-3 py-2 text-right font-semibold">Bytes</th>
                <th className="w-[10%] px-3 py-2 font-semibold">{hidden ? "Filter" : ""}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((i) => {
                const label = names[i.address];
                const hit = geo[i.address];
                const online = now - i.last <= ONLINE_WITHIN;
                return (
                  <tr key={i.address} className="border-b border-border last:border-0 hover:bg-white/[0.05]">
                    <td className="px-3 py-1.5">
                     <div className="flex items-center gap-2">
                      <span
                        role="img"
                        aria-label={online ? "Online" : "Offline"}
                        title={online ? `Online: packets in the last ${ONLINE_WITHIN} seconds` : "Offline: no packets lately"}
                        className={`h-2.5 w-2.5 shrink-0 rounded-full ${online ? "bg-[#3ddc84] shadow-[0_0_6px_#3ddc84]" : "bg-[#ff4d4d]"}`}
                      />
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
                     </div>
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
                    <td className="px-3 py-1.5 text-right font-mono text-muted">{i.inbound.toLocaleString()} / {i.outbound.toLocaleString()}</td>
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
