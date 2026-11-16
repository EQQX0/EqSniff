import { useEffect, useMemo, useRef, useState } from "react";
import type { Country, IpDetails, PacketRow } from "@/lib/api";
import { Flag } from "@/views/CaptureView";
import { isLocalAddress } from "@/lib/export";
import { NAME_MAX } from "@/lib/ipstore";
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
      hit = { address: a, packets: 0, bytes: 0, last: r.time, first: r.time, lastOut: 0, passed: 0, inbound: 0, outbound: 0, ports: new Set(), protocols: new Set(), recentRate: 0, rateAt: r.time };
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

interface Props {
  items: IpSummary[];
  names: Record<string, string>;
  geo: Record<string, Country>;
  /** Addresses the filters hide. Only passed for the All Traffic list. */
  hidden?: Set<string>;
  onSave: (address: string, value: string) => void;
  /** Forgets every captured address (saved labels stay). */
  onClear: () => void;
  /** Forgets one captured address. It comes back if it sends more packets. */
  onDelete: (address: string) => void;
  /** Adds (or switches on) a Hide filter for this ISP in the Filters page. */
  onHideIsp: (isp: string) => void;
  /** The moment to judge online against, in seconds: now while capturing, the newest packet in a saved file. */
  now: number;
  /** City, ISP and VPN flags from the online lookup, keyed by address. */
  details: Record<string, IpDetails>;
}

/** The addresses seen in a capture, each with an editable label saved in IP Storage. */
export function IpList({ items, names, geo, hidden, onSave, onClear, onDelete, onHideIsp, now, details }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // Right-click menu and the views it sets up. These only change what this list shows, not the capture.
  const [menu, setMenu] = useState<{ x: number; y: number; address: string } | null>(null);
  const [hiddenIps, setHiddenIps] = useState<Set<string>>(new Set());
  const [onlyIsp, setOnlyIsp] = useState<string | null>(null);
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
  const copy = (text: string) => void navigator.clipboard?.writeText(text).catch(() => {});
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    let base = items.filter((i) => !hiddenIps.has(i.address));
    if (onlyIsp !== null) base = base.filter((i) => ispOf(i.address) === onlyIsp);
    const list = q ? base.filter((i) => i.address.toLowerCase().includes(q) || (names[i.address] ?? "").toLowerCase().includes(q)) : base;
    // players who are online come first; each group keeps its order
    const on = (i: IpSummary) => isOnline(i, now);
    return [...list.filter(on), ...list.filter((i) => !on(i))];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, names, query, now, hiddenIps, onlyIsp, details]);
  const onlineCount = useMemo(() => items.filter((i) => isOnline(i, now)).length, [items, now]);
  const hostState = useRef<HostState>(newHostState());
  const hostAddress = useMemo(() => pickHost(items, now, hostState.current), [items, now]);

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
                <th className="w-[14%] px-3 py-2 font-semibold">Label</th>
                <th className="w-[3%] px-0 py-2 text-center font-semibold" title="Likely host"><span className="sr-only">Likely host</span></th>
                <th className="w-[12%] px-3 py-2 font-semibold">IP address</th>
                <th className="w-[6%] px-3 py-2 font-semibold">Type</th>
                <th className="w-[7%] px-3 py-2 font-semibold">Port</th>
                <th className="w-[11%] px-3 py-2 font-semibold">Country</th>
                <th className="w-[10%] px-3 py-2 font-semibold">City</th>
                <th className="w-[14%] px-3 py-2 font-semibold">ISP</th>
                <th className="w-[7%] px-3 py-2 font-semibold" title="Known VPN, proxy or data-centre address (needs the lookup)">VPN</th>
                <th className="w-[9%] px-3 py-2 text-right font-semibold" title="Packets in / out">In / out</th>
                <th className="w-[7%] px-3 py-2 font-semibold">{hidden ? "Filter" : ""}</th>
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
                      setMenu({ x: Math.min(e.clientX, window.innerWidth - 240), y: Math.min(e.clientY, window.innerHeight - 330), address: i.address });
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
                     </div>
                    </td>
                    <td className="px-0 py-1.5 text-center">
                      {hostAddress === i.address && (
                        <span
                          role="img"
                          aria-label="Likely host"
                          title="Carrying far more traffic than the other online players right now — may be hosting, not just playing."
                          className="inline-flex"
                        >
                          <CrownIcon className="h-3.5 w-3.5 shrink-0 text-[#ffd34d]" />
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-text">{i.address}</td>
                    <td className="px-3 py-1.5 font-mono text-muted">{[...i.protocols].join(" / ")}</td>
                    <td className="px-3 py-1.5 font-mono text-muted" title="Service port seen on this connection">
                      {[...i.ports].sort((a, b) => a - b).slice(0, 2).join(", ")}
                    </td>
                    <td className="px-3 py-1.5 text-text">
                      {hit && (
                        <span className="inline-flex items-center gap-2">
                          <Flag code={hit.code} />
                          <span className="truncate">{hit.name}</span>
                        </span>
                      )}
                    </td>
                    <td className="truncate px-3 py-1.5 text-text" title={details[i.address] ? [details[i.address].city, details[i.address].region].filter(Boolean).join(", ") : ""}>{details[i.address]?.city ?? ""}</td>
                    <td className="truncate px-3 py-1.5 text-text" title={details[i.address]?.isp ?? ""}>{details[i.address]?.isp ?? ""}</td>
                    <td className="px-3 py-1.5">
                      {details[i.address] && (
                        <span className={details[i.address].vpn ? "font-semibold text-[#ff4d4d]" : "text-muted"}>{details[i.address].vpn ? "VPN" : "No"}</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-muted">{i.inbound.toLocaleString()} / {i.outbound.toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-muted">{isHidden ? "Hidden" : ""}</td>
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
        const row = [names[i.address] ?? "", i.address, [...i.protocols].join("/"), [...i.ports].sort((a, b) => a - b).slice(0, 2).join(","), geo[i.address]?.name ?? "", d?.city ?? "", isp, d ? (d.vpn ? "VPN" : "No") : "", `${i.inbound}/${i.outbound}`].join("\t");
        const item = "block w-full px-4 py-2 text-left text-sm text-text hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none";
        const danger = "block w-full px-4 py-2 text-left text-sm text-[#ff4d4d] hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none";
        return (
          <div role="menu" aria-label={`Actions for ${i.address}`} style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()} className="fixed z-50 w-56 overflow-hidden rounded-lg border border-border bg-[#1c0b11] py-1 shadow-xl">
            <button role="menuitem" type="button" className={item} onClick={() => { copy(i.address); setMenu(null); }}>Copy IP address</button>
            <button role="menuitem" type="button" className={item} onClick={() => { copy(row); setMenu(null); }}>Copy row</button>
            <button role="menuitem" type="button" className={item} onClick={() => { setEditing(i.address); setMenu(null); }}>{names[i.address] ? "Change label" : "Create IP label"}</button>
            <div className="my-1 border-t border-border" />
            {isp && <button role="menuitem" type="button" className={item} onClick={() => { setOnlyIsp(isp); setMenu(null); }}>Show only ISP: {isp}</button>}
            {isp && <button role="menuitem" type="button" className={item} onClick={() => { onHideIsp(isp); setMenu(null); }}>Hide ISP: {isp}</button>}
            <button role="menuitem" type="button" className={item} onClick={() => { setHiddenIps((s) => new Set(s).add(i.address)); setMenu(null); }}>Hide this IP</button>
            <div className="my-1 border-t border-border" />
            <button role="menuitem" type="button" className={danger} onClick={() => { onDelete(i.address); setMenu(null); }}>Delete row</button>
            <button role="menuitem" type="button" className={danger} onClick={() => { onClear(); setMenu(null); }}>Clear all</button>
          </div>
        );
      })()}
    </div>
  );
}
