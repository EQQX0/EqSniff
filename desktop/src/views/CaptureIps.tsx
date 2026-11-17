import { toast } from "@/components/ui/Toast";
import { copyText } from "@/lib/export";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Country, IpDetails, PacketRow } from "@/lib/api";
import { Flag, ipKey } from "@/views/CaptureView";
import { isLocalAddress } from "@/lib/export";
import { NAME_MAX, ago, type IpEntry } from "@/lib/ipstore";
import { seedFromRow, type Filter } from "@/lib/filters";
import { CrownIcon } from "@/components/ui/icons";

export interface IpSummary {
  address: string;
  packets: number;
  bytes: number;
  last: number;
  /** When the first packet from this address arrived. */
  first: number;
  /** When this computer last sent it a real packet (not an ICMP error). A server that is off sends none. */
  lastOut: number;
  /** Packets that passed the filters when they arrived. */
  passed: number;
  /** Packets sent to this computer by the address, and sent back to it. A player talks both ways, a scanner mostly does not. */
  inbound: number;
  outbound: number;
  /** Service ports (below 49152) seen on either end of packets with this address. Games use these; clients use random high ports. */
  ports: Set<number>;
  /** The most recent port the address used on its end, when it is not a service port (a random high port, as in a peer-to-peer connection). */
  remotePort: number | null;
  /** TCP, UDP and so on, as seen in this address's packets. */
  protocols: Set<string>;
  /**
   * Packets/sec, weighted toward recent traffic and fading out old traffic (see `absorb`'s EMA_TAU).
   * Used instead of the all-time average so a host who stops hosting reads as quiet within seconds,
   * not only once their lifetime average finally drags down to match.
   */
  recentRate: number;
  /** The packet time `recentRate` was last updated against. */
  rateAt: number;
}

/** How many seconds of packet history `recentRate` effectively remembers; older traffic fades out past this. */
const EMA_TAU = 4;

/** Every address seen since the capture started. It is not cut at the table's row limit, so busy traffic never pushes a server out. */
export type IpBook = Map<string, IpSummary>;

/** Adds packets to the book. `passes` says whether a packet gets through the filters switched on right now. */
export function absorb(book: IpBook, rows: PacketRow[], farOf: (r: PacketRow) => string, passes: (r: PacketRow) => boolean, limit = 50000) {
  for (const r of rows) {
    // ICMP is ping and error traffic. A closed game port makes Windows answer every packet with an ICMP error,
    // which would look like a server talking back, so it never counts toward a connection.
    if (r.protocol.startsWith("ICMP")) continue;
    const a = farOf(r);
    let hit = book.get(a);
    if (!hit) {
      if (book.size >= limit) continue;
      hit = { address: a, packets: 0, bytes: 0, last: r.time, first: r.time, lastOut: 0, passed: 0, inbound: 0, outbound: 0, ports: new Set(), remotePort: null, protocols: new Set(), recentRate: 0, rateAt: r.time };
      book.set(a, hit);
    }
    hit.packets++;
    hit.bytes += r.length;
    if (isLocalAddress(r.src)) {
      hit.outbound++;
      if (r.time > hit.lastOut) hit.lastOut = r.time;
    } else hit.inbound++;
    if (r.time > hit.last) hit.last = r.time;
    if (passes(r)) hit.passed++;
    // EMA of packets/sec: each packet's own instantaneous rate (1 / gap since the last one) pulls the
    // average toward it, by an amount that grows with the gap, so a burst keeps the average near its
    // own pace instead of just nudging a years-old average a little.
    const gap = r.time - hit.rateAt;
    if (gap > 0) {
      const weight = 1 - Math.exp(-gap / EMA_TAU);
      hit.recentRate += weight * (1 / gap - hit.recentRate);
      hit.rateAt = r.time;
    }
    hit.protocols.add(r.protocol);
    const farPort = isLocalAddress(r.src) ? r.dstPort : r.srcPort;
    if (farPort !== null && farPort >= 49152) hit.remotePort = farPort;
    for (const pt of [r.srcPort, r.dstPort]) if (pt !== null && pt < 49152 && hit.ports.size < 40) hit.ports.add(pt);
  }
}

/** An address counts as an active connection once it has sent or received at least this many packets. */
export const ACTIVE_EACH_WAY = 3;

/** An address is online while its last packet is newer than this many seconds. */
export const ONLINE_WITHIN = 15;

/** Online means it sent to us and we answered, both within the last ONLINE_WITHIN seconds. */
export const isOnline = (i: IpSummary, now: number) => now - i.last <= ONLINE_WITHIN && now - i.lastOut <= ONLINE_WITHIN;

/** An address needs at least this many packets before its rate is trusted enough to flag. */
const HOST_MIN_PACKETS = 60;
/** How many times faster than the address it is being judged against counts as a gap worth flagging. */
const HOST_RATE_RATIO = 5;
/** A challenger must keep beating the current host for this many capture-seconds before taking the crown. */
const HOST_STICKY_SECONDS = 5;

/** Carries the crown between calls, so `pickHost` can judge a challenger over time instead of per call. */
export interface HostState {
  address: string | null;
  challenger: string | null;
  challengerSince: number | null;
}

export function newHostState(): HostState {
  return { address: null, challenger: null, challengerSince: null };
}

/**
 * The one online address carrying far more traffic than the rest, which can mean its owner is
 * hosting (their game has to simulate everything, on top of playing). Only flagged with 2+ players
 * online, so a lone player (which includes a host playing solo) is never mistaken for a host, and
 * only once the leader's own packet count is high enough that an early read or a quiet moment can't
 * trip it.
 *
 * Mutates `state` and returns the crowned address. Once crowned, an address keeps the crown through
 * ordinary jitter: a new leader only takes over once it has beaten the current host by the same gap
 * for HOST_STICKY_SECONDS straight, not on a single busy packet. Losing the crown only happens when
 * the host goes offline or a challenger holds that lead for the whole window.
 */
export function pickHost(items: IpSummary[], now: number, state: HostState): string | null {
  const online = items.filter((i) => isOnline(i, now));
  if (online.length < 2) {
    state.address = null;
    state.challenger = null;
    state.challengerSince = null;
    return null;
  }
  const rate = (i: IpSummary) => i.recentRate;
  const byRate = [...online].sort((a, b) => rate(b) - rate(a));
  const top = byRate[0];
  const current = state.address ? online.find((i) => i.address === state.address) : undefined;

  if (!current) {
    // No sticky host (none yet, or the old one went offline): pick fresh with no delay.
    state.address = top.packets >= HOST_MIN_PACKETS && rate(top) >= rate(byRate[1]) * HOST_RATE_RATIO ? top.address : null;
    state.challenger = null;
    state.challengerSince = null;
    return state.address;
  }
  if (current.address === top.address) {
    // The host is still the busiest address; no challenge in progress.
    state.challenger = null;
    state.challengerSince = null;
    return state.address;
  }

  // Someone else is busier right now. They only start a challenge by clearing the same bar
  // against the CURRENT host (not just 2nd place), and only win it by clearing that bar for
  // HOST_STICKY_SECONDS straight.
  const challenges = top.packets >= HOST_MIN_PACKETS && rate(top) >= rate(current) * HOST_RATE_RATIO;
  if (!challenges) {
    state.challenger = null;
    state.challengerSince = null;
    return state.address;
  }
  if (state.challenger !== top.address) {
    state.challenger = top.address;
    state.challengerSince = now;
    return state.address; // keep the host while the challenge is still fresh
  }
  if (now - (state.challengerSince ?? now) >= HOST_STICKY_SECONDS) {
    state.address = top.address;
    state.challenger = null;
    state.challengerSince = null;
  }
  return state.address;
}

/** The book as a list, newest first. `onlyFiltered` keeps the addresses that had at least one packet through the filters. */
export function listBook(book: IpBook, onlyFiltered: boolean, serverPort: number | null = null): IpSummary[] {
  let all = [...book.values()];
  // Only real connections from the internet: not local addresses, and not scanners that never really talk back.
  all = all.filter((i) => !isLocalAddress(i.address));
  if (serverPort !== null) all = all.filter((i) => i.ports.has(serverPort));
  all = all.filter((i) => i.inbound >= ACTIVE_EACH_WAY || i.outbound >= ACTIVE_EACH_WAY);
  return (onlyFiltered ? all.filter((i) => i.passed > 0) : all).sort((x, y) => y.packets - x.packets);
}

type IpSortKey = "label" | "ip" | "type" | "port" | "country" | "city" | "isp" | "vpn" | "io";

interface Props {
  items: IpSummary[];
  names: Record<string, string>;
  geo: Record<string, Country>;
  /** Addresses the filters hide. Only passed for the All Traffic list. */
  hidden?: Set<string>;
  /** For each hidden address, the names of the filters that hid it. */
  hiddenBy?: Record<string, string[]>;
  /** For each address that gets through, the Show filters that let it in. */
  showedBy?: Record<string, string[]>;
  /** Addresses that get the crown icon, with the name of the crown filter that matched. Only admin-chosen global filters give it. */
  crownBy?: Map<string, string>;
  /** For a labelled address, the other addresses its label used before (newest first). */
  history?: Record<string, IpEntry[]>;
  /** True when at least one Show filter is switched on. With none on, nothing limits what is shown. */
  showFiltersOn?: boolean;
  onSave: (address: string, value: string) => void;
  /** Forgets every captured address (saved labels stay). */
  onClear: () => void;
  /** Forgets one captured address. It comes back if it sends more packets. */
  onDelete: (address: string) => void;
  /** Adds (or switches on) a Hide filter for this ISP in the Filters page. */
  onHideIsp: (isp: string) => void;
  /** Adds (or switches on) a Show filter for a port, or adds the port to it if it already exists. */
  onShowPort: (port: number) => void;
  /** Opens the Filters page's new-filter window, filled in from this address. */
  onCreateFilter: (seed: Partial<Filter>) => void;
  /** The moment to judge online against, in seconds: now while capturing, the newest packet in a saved file. */
  now: number;
  /** City, ISP and VPN flags from the online lookup, keyed by address. */
  details: Record<string, IpDetails>;
}

export function CopiedBadge() {
  return <span className="rounded-pill bg-accent-soft/30 px-2 py-0.5 text-xs font-semibold text-accent">Copied</span>;
}

/** The addresses seen in a capture, each with an editable label saved in IP Storage. */
export function IpList({ items, names, geo, hidden, hiddenBy, showedBy, crownBy, history, showFiltersOn, onSave, onClear, onDelete, onHideIsp, onShowPort, onCreateFilter, now, details }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  // Right-click menu and the views it sets up. These only change what this list shows, not the capture.
  const [menu, setMenu] = useState<{ x: number; y: number; address: string } | null>(null);
  const [hiddenIps, setHiddenIps] = useState<Set<string>>(new Set());
  const [onlyIsp, setOnlyIsp] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: IpSortKey; dir: "asc" | "desc" } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("click", close);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", key);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", key);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu]);
  const ispOf = (a: string) => details[a]?.isp ?? "";
  const copy = (text: string) =>
    void copyText(text).then((ok) => (ok ? toast(`Copied: ${text.length > 50 ? text.slice(0, 47) + "…" : text}`) : toast("Copying was blocked by Windows. Select the text and press Ctrl+C instead.", { kind: "error" })));
  const [copiedCell, setCopiedCell] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyCell = (cellId: string, text: string) => {
    if (!text) return;
    copy(text);
    setCopiedCell(cellId);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopiedCell(null), 900);
  };
  useEffect(() => () => { if (copiedTimer.current) clearTimeout(copiedTimer.current); }, []);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    let base = items.filter((i) => !hiddenIps.has(i.address));
    if (onlyIsp !== null) base = base.filter((i) => ispOf(i.address) === onlyIsp);
    // A search also finds a label by the addresses (or country, ISP) it used before.
    const pastHit = (i: IpSummary) => (history?.[i.address] ?? []).some((p) => [p.address, p.place ?? "", p.isp ?? ""].some((v) => v.toLowerCase().includes(q)));
    const list = q ? base.filter((i) => i.address.toLowerCase().includes(q) || (names[i.address] ?? "").toLowerCase().includes(q) || pastHit(i)) : base;
    if (sort) {
      const value = (i: IpSummary): string | number => {
        switch (sort.key) {
          case "label": return (names[i.address] ?? "").toLowerCase();
          case "ip": return ipKey(i.address);
          case "type": return [...i.protocols].sort().join("/");
          case "port": return i.ports.size ? Math.min(...i.ports) : i.remotePort ?? "";
          case "country": return (geo[i.address]?.name ?? "").toLowerCase();
          case "city": return (details[i.address]?.city ?? "").toLowerCase();
          case "isp": return ispOf(i.address).toLowerCase();
          case "vpn": return details[i.address] ? (details[i.address].vpn ? 1 : 0) : "";
          default: return i.inbound + i.outbound;
        }
      };
      const sign = sort.dir === "asc" ? 1 : -1;
      // Empty values always go last, so the useful rows stay on top.
      return [...list].sort((a, b) => {
        const x = value(a), y = value(b);
        if (x === "" && y !== "") return 1;
        if (y === "" && x !== "") return -1;
        if (x === y) return 0;
        return (x < y ? -1 : 1) * sign;
      });
    }
    // players who are online come first; each group keeps its order
    const on = (i: IpSummary) => isOnline(i, now);
    return [...list.filter(on), ...list.filter((i) => !on(i))];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, names, query, now, hiddenIps, onlyIsp, details, geo, sort, history]);

  /** A heading that sorts the list: click once for A to Z, again for Z to A, a third time to go back to online-first. */
  const sortTh = (key: IpSortKey, text: string, width: string, extra = "", title?: string) => {
    const active = sort?.key === key;
    return (
      <th
        scope="col"
        aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
        className={`${width} p-0 font-semibold ${extra}`}
      >
        <button
          type="button"
          onClick={() => setSort((s) => (s?.key !== key ? { key, dir: "asc" } : s.dir === "asc" ? { key, dir: "desc" } : null))}
          title={active ? (sort.dir === "asc" ? "Sorted A to Z. Click for Z to A." : "Sorted Z to A. Click to clear.") : (title ?? `Sort by ${text.toLowerCase()}`)}
          className={`flex w-full items-center gap-1 px-3 py-2 text-left font-semibold transition-colors duration-fast hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-soft ${
            extra.includes("text-right") ? "justify-end" : ""
          } ${active ? "text-accent-soft" : ""}`}
        >
          <span className="truncate">{text}</span>
          <span aria-hidden="true" className={`shrink-0 text-[10px] ${active ? "opacity-100" : "opacity-30"}`}>
            {active ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}
          </span>
        </button>
      </th>
    );
  };
  const onlineCount = useMemo(() => items.filter((i) => isOnline(i, now)).length, [items, now]);

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
        <button
          type="button"
          onClick={onClear}
          disabled={items.length === 0}
          title="Forget every captured address and packet so far. Labels saved in IP Storage are kept."
          className="ml-3 h-8 rounded-pill border border-border px-3 text-xs text-text hover:bg-white/[0.08] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
        >
          Clear
        </button>
      </div>
      {(hiddenIps.size > 0 || onlyIsp !== null) && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-xs text-muted">
          {onlyIsp !== null && <button type="button" onClick={() => setOnlyIsp(null)} className="rounded-pill border border-border px-2 py-0.5 hover:bg-white/10">Only ISP: {onlyIsp} ✕</button>}
          {hiddenIps.size > 0 && <button type="button" onClick={() => setHiddenIps(new Set())} className="rounded-pill border border-border px-2 py-0.5 hover:bg-white/10">Hiding {hiddenIps.size} address{hiddenIps.size === 1 ? "" : "es"} ✕</button>}
          <button type="button" onClick={() => { setHiddenIps(new Set()); setOnlyIsp(null); }} className="px-2 py-0.5 text-text underline">Show all</button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {shown.length === 0 ? (
          <p className="p-6 text-sm text-muted">{items.length === 0 ? "No addresses yet. Start a capture or open a file." : "Nothing matches that search."}</p>
        ) : (
          <table className="w-full min-w-[64rem] table-fixed text-left text-xs">
            <thead className="sticky top-0 z-10 bg-[linear-gradient(180deg,#4a1621,#33101a)] text-text">
              <tr>
                {sortTh("label", "Label", "w-[11%]")}
                <th className="w-[3%] px-0 py-2 text-center font-semibold" title="Likely host"><span className="sr-only">Likely host</span></th>
                {sortTh("ip", "IP address", "w-[12%]")}
                {sortTh("type", "Type", "w-[6%]")}
                {sortTh("port", "Port", "w-[7%]")}
                {sortTh("country", "Country", "w-[10%]")}
                {sortTh("city", "City", "w-[10%]")}
                {sortTh("isp", "ISP", "w-[12%]")}
                {sortTh("vpn", "VPN", "w-[7%]", "", "Sort by VPN. Known VPN, proxy or data-centre address (needs the lookup)")}
                {sortTh("io", "In / out", "w-[9%]", "text-right", "Sort by packets in plus out")}
                <th className="w-[13%] px-3 py-2 font-semibold" title="Which filter hid this address, or which Show filter let it in">Filter</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((i) => {
                const label = names[i.address];
                const hit = geo[i.address];
                const online = isOnline(i, now);
                const isHidden = hidden?.has(i.address) ?? false;
                return (
                  <tr
                    key={i.address}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setMenu({ x: Math.min(e.clientX, window.innerWidth - 240), y: Math.min(e.clientY, window.innerHeight - 370), address: i.address });
                    }}
                    title={isHidden ? "A Hide filter matches this row. It stays here, dimmed, but is left out of the Filtered IPs tab." : undefined}
                    className={`border-b border-border last:border-0 hover:bg-white/[0.05] ${isHidden ? "opacity-40" : ""}`}
                  >
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
                      {editing !== i.address && history?.[i.address] && (
                        <button
                          type="button"
                          onClick={() => setMoreOpen((s) => { const n = new Set(s); if (n.has(i.address)) n.delete(i.address); else n.add(i.address); return n; })}
                          aria-expanded={moreOpen.has(i.address)}
                          title="Addresses this label used before"
                          className="shrink-0 rounded-pill border border-border-input px-2 py-0.5 text-[11px] font-semibold text-text hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
                        >
                          {moreOpen.has(i.address) ? "less" : `more+ (${history[i.address].length})`}
                        </button>
                      )}
                     </div>
                     {moreOpen.has(i.address) && history?.[i.address] && (
                       <ul className="mt-1 space-y-0.5 pl-4 text-[11px] text-muted">
                         {history[i.address].map((p) => (
                           <li key={p.address} className="truncate" title={[p.place, p.isp].filter(Boolean).join(" · ")}>
                             <span className="font-mono text-text">{p.address}</span>
                             {" · "}
                             {p.firstSeen ? `first seen ${new Date(p.firstSeen).toLocaleDateString()}` : "first seen unknown"}
                             {" · "}
                             {p.lastSeen ? `last seen ${ago(p.lastSeen)}` : "not seen yet"}
                             {p.timesSeen ? ` · ${p.timesSeen}×` : ""}
                           </li>
                         ))}
                       </ul>
                     )}
                    </td>
                    <td className="px-0 py-1.5 text-center">
                      {crownBy?.has(i.address) && (
                        <span
                          role="img"
                          aria-label="Crown"
                          title={`Matched the crown filter “${crownBy.get(i.address)}”, set by an admin.`}
                          className="inline-flex"
                        >
                          <CrownIcon className="h-3.5 w-3.5 shrink-0 text-[#ffd34d]" />
                        </span>
                      )}
                    </td>
                    <td
                      className="relative cursor-text px-3 py-1.5 font-mono text-text"
                      title="Double-click to copy"
                      onDoubleClick={() => copyCell(`${i.address}:addr`, i.address)}
                    >
                      {copiedCell === `${i.address}:addr` ? <CopiedBadge /> : i.address}
                    </td>
                    <td
                      className="relative cursor-text px-3 py-1.5 font-mono text-muted"
                      title="Double-click to copy"
                      onDoubleClick={() => copyCell(`${i.address}:type`, [...i.protocols].join(" / "))}
                    >
                      {copiedCell === `${i.address}:type` ? <CopiedBadge /> : [...i.protocols].join(" / ")}
                    </td>
                    <td
                      className="relative cursor-text px-3 py-1.5 font-mono text-muted"
                      title={i.ports.size || i.remotePort === null ? "Double-click to copy every port seen on this connection" : "No service port: this is the random port the address is using (typical of a peer-to-peer connection). Double-click to copy."}
                      onDoubleClick={() => copyCell(`${i.address}:port`, i.ports.size ? [...i.ports].sort((a, b) => a - b).join(", ") : String(i.remotePort ?? ""))}
                    >
                      {copiedCell === `${i.address}:port` ? <CopiedBadge /> : i.ports.size ? [...i.ports].sort((a, b) => a - b).slice(0, 2).join(", ") : i.remotePort !== null ? <span className="text-muted/70">{i.remotePort}</span> : ""}
                    </td>
                    <td
                      className="relative cursor-text overflow-hidden px-3 py-1.5 text-text"
                      title={hit?.name ?? "Double-click to copy"}
                      onDoubleClick={() => copyCell(`${i.address}:country`, hit?.name ?? "")}
                    >
                      {copiedCell === `${i.address}:country` ? (
                        <CopiedBadge />
                      ) : hit ? (
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="shrink-0"><Flag code={hit.code} /></span>
                          <span className="min-w-0 truncate">{hit.name}</span>
                        </span>
                      ) : null}
                    </td>
                    <td
                      className="relative cursor-text truncate px-3 py-1.5 text-text"
                      title={details[i.address] ? [details[i.address].city, details[i.address].region].filter(Boolean).join(", ") : ""}
                      onDoubleClick={() => copyCell(`${i.address}:city`, details[i.address]?.city ?? "")}
                    >
                      {copiedCell === `${i.address}:city` ? <CopiedBadge /> : details[i.address]?.city ?? ""}
                    </td>
                    <td
                      className="relative cursor-text truncate px-3 py-1.5 text-text"
                      title={details[i.address]?.isp ?? ""}
                      onDoubleClick={() => copyCell(`${i.address}:isp`, details[i.address]?.isp ?? "")}
                    >
                      {copiedCell === `${i.address}:isp` ? <CopiedBadge /> : details[i.address]?.isp ?? ""}
                    </td>
                    <td
                      className="relative cursor-text px-3 py-1.5"
                      title="Double-click to copy"
                      onDoubleClick={() => copyCell(`${i.address}:vpn`, details[i.address] ? (details[i.address].vpn ? "VPN" : "No") : "")}
                    >
                      {copiedCell === `${i.address}:vpn` ? (
                        <CopiedBadge />
                      ) : (
                        details[i.address] && (
                          <span className={details[i.address].vpn ? "font-semibold text-[#ff4d4d]" : "text-muted"}>{details[i.address].vpn ? "VPN" : "No"}</span>
                        )
                      )}
                    </td>
                    <td
                      className="relative cursor-text px-3 py-1.5 text-right font-mono text-muted"
                      title="Double-click to copy"
                      onDoubleClick={() => copyCell(`${i.address}:io`, `${i.inbound} / ${i.outbound}`)}
                    >
                      {copiedCell === `${i.address}:io` ? <CopiedBadge /> : `${i.inbound.toLocaleString()} / ${i.outbound.toLocaleString()}`}
                    </td>
                    {(() => {
                      // Only the highest-priority filter is shown; the hover text lists every filter that matched, in priority order.
                      const all = isHidden ? hiddenBy?.[i.address] : showFiltersOn ? showedBy?.[i.address] : undefined;
                      const note = isHidden ? all?.[0] || "Hidden" : showFiltersOn ? all?.[0] || "" : "No Show filter on";
                      const tip = all && all.length > 1 ? `${all[0]} (highest priority). Also matched: ${all.slice(1).join(", ")}` : note;
                      return <td className={`truncate px-3 py-1.5 ${isHidden ? "text-muted" : showFiltersOn ? "text-text" : "text-muted/70"}`} title={tip}>{note}</td>;
                    })()}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {menu && (() => {
        const i = items.find((x) => x.address === menu.address);
        if (!i) return null;
        const isp = ispOf(i.address);
        const d = details[i.address];
        const ports = [...i.ports].sort((a, b) => a - b).slice(0, 3);
        const row = [names[i.address] ?? "", i.address, [...i.protocols].join("/"), (i.ports.size ? [...i.ports].sort((a, b) => a - b).slice(0, 2).join(",") : String(i.remotePort ?? "")), geo[i.address]?.name ?? "", d?.city ?? "", isp, d ? (d.vpn ? "VPN" : "No") : "", `${i.inbound}/${i.outbound}`].join("\t");
        const item = "block w-full px-4 py-2 text-left text-sm text-text hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none";
        const danger = "block w-full px-4 py-2 text-left text-sm text-[#ff4d4d] hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none";
        return (
          <div role="menu" aria-label={`Actions for ${i.address}`} style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()} className="fixed z-50 w-56 overflow-hidden rounded-lg border border-border bg-[#1c0b11] py-1 shadow-xl">
            <button role="menuitem" type="button" className={item} onClick={() => { copy(i.address); setMenu(null); }}>Copy IP address</button>
            <button role="menuitem" type="button" className={item} onClick={() => { copy(row); setMenu(null); }}>Copy row</button>
            <button role="menuitem" type="button" className={item} onClick={() => { setEditing(i.address); setMenu(null); }}>{names[i.address] ? "Change label" : "Create IP label"}</button>
            <button role="menuitem" type="button" className={item} onClick={() => { onCreateFilter(seedFromRow(i.address, [...i.protocols], [...i.ports], names[i.address])); setMenu(null); }}>Create filter from this IP</button>
            <div className="my-1 border-t border-border" />
            {isp && <button role="menuitem" type="button" className={item} onClick={() => { setOnlyIsp(isp); setMenu(null); }}>Show only ISP: {isp}</button>}
            {isp && <button role="menuitem" type="button" className={item} onClick={() => { onHideIsp(isp); setMenu(null); }}>Hide ISP: {isp}</button>}
            <button role="menuitem" type="button" className={item} onClick={() => { setHiddenIps((s) => new Set(s).add(i.address)); setMenu(null); }}>Hide this IP</button>
            {ports.length > 0 && <div className="my-1 border-t border-border" />}
            {ports.map((p) => (
              <button key={p} role="menuitem" type="button" className={item} onClick={() => { onShowPort(p); setMenu(null); }}>Show filter: port {p}</button>
            ))}
            <div className="my-1 border-t border-border" />
            <button role="menuitem" type="button" className={danger} onClick={() => { onDelete(i.address); setMenu(null); }}>Delete row</button>
            <button role="menuitem" type="button" className={danger} onClick={() => { onClear(); setMenu(null); }}>Clear all</button>
          </div>
        );
      })()}
    </div>
  );
}
