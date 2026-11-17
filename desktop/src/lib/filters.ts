import type { PacketRow } from "@/lib/api";

export type Proto = "any" | "TCP" | "UDP" | "ICMP";
/** Which side of the packet the port and address boxes look at. */
export type Direction = "any" | "from" | "to";
/** What a switched-on filter does: keep only the packets it matches, or drop them. */
export type Mode = "show" | "hide";

/**
 * A display filter: a packet matches when it passes every box that is filled in.
 * A "show" filter keeps only matching packets (with several on, a packet that matches any is kept).
 * A "hide" filter removes matching packets. Hide wins over show.
 */
export interface Filter {
  id: string;
  name: string;
  enabled: boolean;
  mode: Mode;
  protocol: Proto;
  direction: Direction;
  port: string; // empty = any
  address: string; // empty = any. A full address matches exactly; anything shorter matches the start.
  minBytes: string; // empty = any
  maxBytes: string; // empty = any
  hex: string; // empty = any. Comma-separated byte patterns; a packet matches when any one appears in the first 32 bytes of the payload.
  countries: string; // empty = any. Comma-separated 2-letter country codes.
  isps: string; // empty = any. Comma-separated ISP names; part of a name is enough, capitals do not matter.
  /**
   * Set only at runtime for a filter an admin published for every signed-in account (never saved to disk).
   * `id` is that shared filter's own id. Turning it on or off writes a personal override instead of an
   * edit, so it never changes the filter for anyone else.
   */
  globalId?: string;
}

/** What the filters can ask about an address besides its digits. Unknown (not looked up yet) never matches. */
export interface Lookup {
  country: (ip: string) => string | undefined;
  isp: (ip: string) => string | undefined;
}

/** A comma-separated box as a list. */
export const splitList = (t: string) => t.split(",").map((x) => x.trim()).filter((x) => x !== "");

export const PROTOCOLS: Proto[] = ["any", "TCP", "UDP", "ICMP"];
export const DIRECTIONS: { id: Direction; label: string }[] = [
  { id: "any", label: "Either side" },
  { id: "from", label: "Source (sender) only" },
  { id: "to", label: "Destination (receiver) only" },
];

const base = { enabled: false, mode: "show" as Mode, direction: "any" as Direction, port: "", address: "", minBytes: "", maxBytes: "", hex: "", countries: "", isps: "" };

export function blankFilter(id: string): Filter {
  return { ...base, id, name: "", protocol: "any" };
}

const V4_FULL = /^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/;

/** Expands an IPv6 address to its 8 groups, or null if it is not a complete, valid address. */
function v6Groups(a: string): number[] | null {
  if (!a.includes(":") || /[^0-9a-fA-F:.]/.test(a)) return null;
  let text = a;
  const tail = text.match(/(\d+\.\d+\.\d+\.\d+)$/); // ::ffff:1.2.3.4
  if (tail) {
    if (!V4_FULL.test(tail[1]) || tail[1].split(".").some((n) => Number(n) > 255)) return null;
    const [p, q, r, s] = tail[1].split(".").map(Number);
    text = text.slice(0, text.length - tail[1].length) + ((p << 8) | q).toString(16) + ":" + ((r << 8) | s).toString(16);
  }
  if (text.includes(".")) return null;
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const part = (h: string) => (h === "" ? [] : h.split(":"));
  const head = part(halves[0]);
  const rest = halves.length === 2 ? part(halves[1]) : [];
  const all = head.concat(rest);
  if (all.some((g) => !/^[0-9a-fA-F]{1,4}$/.test(g))) return null;
  if (halves.length === 1 ? head.length !== 8 : head.length + rest.length > 7) return null;
  const nums = (g: string[]) => g.map((x) => parseInt(x, 16));
  return [...nums(head), ...Array(halves.length === 2 ? 8 - all.length : 0).fill(0), ...nums(rest)];
}

/** True if the text is a complete, valid IPv6 address (with or without "::"). */
export const isCompleteIpv6 = (a: string) => v6Groups(a) !== null;

/**
 * A complete address matches exactly. An IPv6 address ending in "::" (such as fe80::) is treated
 * as a prefix, since it is far more useful that way.
 */
const isFullAddress = (a: string) => (a.includes(":") ? isCompleteIpv6(a) && !a.endsWith("::") : V4_FULL.test(a));

const sameAddress = (filter: string, ip: string) => {
  const f = filter.toLowerCase();
  const x = ip.toLowerCase();
  if (f.includes(":")) {
    if (!isFullAddress(f)) return x.startsWith(f);
    const g = v6Groups(f);
    const h = v6Groups(x);
    return g !== null && h !== null && g.every((n, i) => n === h[i]);
  }
  // IPv4 (or a bare number): "10.1" means 10.1.x.x, never 10.10.x.x.
  if (/^\d{1,3}(\.\d{1,3}){0,3}\.?$/.test(f) && !x.includes(":")) {
    const want = f.replace(/\.$/, "").split(".").map(Number);
    const have = x.split(".").map(Number);
    return want.every((n, i) => n === have[i]);
  }
  return x.startsWith(f);
};

/** Checks a CIDR such as 10.0.0.0/24 or fe80::/10. Returns the base groups and prefix length, or null. */
function parseCidr(text: string): { v6: boolean; groups: number[]; bits: number } | null {
  const m = /^([^/]+)\/(\d{1,3})$/.exec(text.trim());
  if (!m) return null;
  const bits = Number(m[2]);
  if (m[1].includes(":")) {
    const g = v6Groups(m[1]);
    return g && bits <= 128 ? { v6: true, groups: g, bits } : null;
  }
  if (!V4_FULL.test(m[1]) || m[1].split(".").some((n) => Number(n) > 255) || bits > 32) return null;
  return { v6: false, groups: m[1].split(".").map(Number), bits };
}

function inCidr(c: { v6: boolean; groups: number[]; bits: number }, ip: string): boolean {
  const x = c.v6 ? v6Groups(ip.toLowerCase()) : V4_FULL.test(ip) ? ip.split(".").map(Number) : null;
  if (!x) return false;
  const width = c.v6 ? 16 : 8;
  let left = c.bits;
  for (let i = 0; i < c.groups.length && left > 0; i++) {
    const take = Math.min(left, width);
    const shift = width - take;
    if (c.groups[i] >> shift !== x[i] >> shift) return false;
    left -= take;
  }
  return true;
}

/** One entry of the address box: a CIDR range, a full address, or the start of an address. */
const matchAddress = (entry: string, ip: string) => {
  if (entry.includes("/")) {
    const c = parseCidr(entry);
    return c !== null && inCidr(c, ip);
  }
  return sameAddress(entry, ip);
};

export function normalizeHex(text: string): string {
  return text.replace(/[\s:,-]/g, "").toLowerCase();
}

/** True if the bytes appear in `head` on a byte boundary (head is hex text, two characters per byte). */
function headHas(head: string, needle: string): boolean {
  for (let i = head.indexOf(needle); i !== -1; i = head.indexOf(needle, i + 1)) if (i % 2 === 0) return true;
  return false;
}

/** Reads a port list such as "80, 60, 90, 100-200, 65". Returns the ranges, or null when something is not a port from 1 to 65535. */
export function parsePorts(text: string): [number, number][] | null {
  const out: [number, number][] = [];
  const parts = text.split(/[\s,;]+/).filter((t) => t !== "");
  for (const t of parts) {
    const m = /^(\d{1,5})(?:\s*-\s*(\d{1,5}))?$/.exec(t);
    if (!m) return null;
    const a = Number(m[1]), b = m[2] === undefined ? a : Number(m[2]);
    if (a < 1 || b < 1 || a > 65535 || b > 65535 || a > b) return null;
    out.push([a, b]);
  }
  return out.length > 0 ? out : null;
}

/** The ports in the list text, as a BPF clause. */
export function portsToBpf(text: string): string {
  const r = parsePorts(text) ?? [];
  const bits = r.map(([a, b]) => (a === b ? `port ${a}` : `portrange ${a}-${b}`));
  return bits.length === 1 ? bits[0] : `(${bits.join(" or ")})`;
}

export function matches(f: Filter, r: PacketRow, look?: Lookup): boolean {
  // The ICMP filter covers both the IPv4 and IPv6 flavours.
  if (f.protocol !== "any" && r.protocol !== f.protocol && !(f.protocol === "ICMP" && r.protocol === "ICMPv6")) return false;
  const side = (src: boolean, dst: boolean) => (f.direction === "from" ? src : f.direction === "to" ? dst : src || dst);
  if (f.port.trim() !== "") {
    const ranges = parsePorts(f.port) ?? [];
    const inList = (p: number | null) => p !== null && ranges.some(([a, b]) => p >= a && p <= b);
    if (!side(inList(r.srcPort), inList(r.dstPort))) return false;
  }
  const addrs = splitList(f.address);
  if (addrs.length > 0 && !side(addrs.some((a) => matchAddress(a, r.src)), addrs.some((a) => matchAddress(a, r.dst)))) return false;
  const codes = splitList(f.countries).map((c) => c.toUpperCase());
  if (codes.length > 0) {
    const has = (ip: string) => {
      const c = look?.country(ip);
      return !!c && codes.includes(c.toUpperCase());
    };
    if (!side(has(r.src), has(r.dst))) return false;
  }
  const names = splitList(f.isps).map((n) => n.toLowerCase());
  if (names.length > 0) {
    const has = (ip: string) => {
      const n = look?.isp(ip)?.toLowerCase();
      return !!n && names.some((w) => n.includes(w));
    };
    if (!side(has(r.src), has(r.dst))) return false;
  }
  if (f.minBytes.trim() !== "" && r.length < Number(f.minBytes)) return false;
  if (f.maxBytes.trim() !== "" && r.length > Number(f.maxBytes)) return false;
  const patterns = splitList(f.hex).map(normalizeHex).filter((h) => h !== "");
  if (patterns.length > 0 && !patterns.some((h) => headHas(r.head ?? "", h))) return false;
  return true;
}

/**
 * Hide filters remove what they match. Show filters, when any are on, keep only what they match.
 * With nothing switched on, every packet shows.
 */
export function matchesAny(filters: Filter[], r: PacketRow, look?: Lookup): boolean {
  const on = filters.filter((f) => f.enabled);
  if (on.some((f) => f.mode === "hide" && matches(f, r, look))) return false;
  const show = on.filter((f) => f.mode !== "hide");
  return show.length === 0 || show.some((f) => matches(f, r, look));
}

export interface Problems {
  name?: string;
  port?: string;
  address?: string;
  countries?: string;
  minBytes?: string;
  maxBytes?: string;
  hex?: string;
}

/** Returns plain-language problems with a filter. An empty object means it is fine. */
export function problems(f: Filter): Problems {
  const out: Problems = {};
  if (f.name.trim() === "") out.name = "Give the filter a name.";
  if (f.port.trim() !== "" && parsePorts(f.port) === null)
    out.port = "Use ports from 1 to 65535 separated by commas, ranges like 100-200 allowed (80, 443, 100-200), or leave it empty.";
  if (f.minBytes.trim() !== "" && !/^\d+$/.test(f.minBytes.trim())) out.minBytes = "Use a whole number, or leave it empty.";
  if (f.maxBytes.trim() !== "" && !/^\d+$/.test(f.maxBytes.trim())) out.maxBytes = "Use a whole number, or leave it empty.";
  if (!out.minBytes && !out.maxBytes && f.minBytes.trim() !== "" && f.maxBytes.trim() !== "" && Number(f.minBytes) > Number(f.maxBytes))
    out.maxBytes = "The largest size must not be smaller than the smallest.";
  if (splitList(f.address).some((a) => (a.includes("/") ? parseCidr(a) === null : !/^[0-9a-fA-F:.]+$/.test(a))))
    out.address = "Use addresses like 8.8.8.8, ranges like 192.168.1.0/24, or the start of an address like 192.168.";
  if (splitList(f.countries).some((c) => !/^[A-Za-z]{2}$/.test(c))) out.countries = "Use 2-letter country codes such as US, DE, CA.";
  if (splitList(f.hex).some((x) => { const h = normalizeHex(x); return !/^([0-9a-f]{2})+$/.test(h) || h.length > 64; }))
    out.hex = "Use hex bytes such as 47 45 54 (at most 32 bytes each), separated by commas, or leave it empty.";
  return out;
}

/** A Hide filter that only names ISPs. These live on the Filters page's ISP tab and stay out of the Capture quick-toggle row. */
export const isIspFilter = (f: Filter) =>
  f.mode === "hide" && f.isps.trim() !== "" && f.protocol === "any" && f.port.trim() === "" && f.address.trim() === "" &&
  f.countries.trim() === "" && f.minBytes.trim() === "" && f.maxBytes.trim() === "" && f.hex.trim() === "";

export const newId = () => `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/** Short plain-language summary of what a filter checks. */
export function describe(f: Filter): string {
  const side = f.direction === "from" ? "source " : f.direction === "to" ? "destination " : "";
  return (
    [
      f.protocol !== "any" && f.protocol,
      f.port && `${side}port ${f.port}`,
      f.address && `${side}address ${splitList(f.address).map((a) => a + (a.includes("/") || isFullAddress(a) ? "" : "…")).join(", ")}`,
      f.countries && `country ${splitList(f.countries).map((c) => c.toUpperCase()).join(", ")}`,
      f.isps && `ISP ${splitList(f.isps).join(", ")}`,
      f.minBytes && `${f.minBytes}+ bytes`,
      f.maxBytes && `up to ${f.maxBytes} bytes`,
      f.hex && `contains ${splitList(f.hex).map(normalizeHex).join(" or ")}`,
    ]
      .filter(Boolean)
      .join(" · ") || "Matches everything"
  );
}

const FILE_KIND = "network-toolkit-filters";

export function toFile(filters: Filter[]): string {
  return JSON.stringify({ kind: FILE_KIND, version: 4, filters }, null, 2);
}

function clean(raw: Record<string, unknown>, keepId: boolean): Filter {
  const text = (v: unknown, n: number) => String(v ?? "").slice(0, n);
  return {
    id: keepId && typeof raw?.id === "string" ? raw.id : newId(), // ids from a file are never trusted
    name: text(raw?.name, 80),
    enabled: keepId ? raw?.enabled === true : false, // imported filters start switched off
    mode: raw?.mode === "hide" ? "hide" : "show", // older files and saved filters are show filters
    protocol: PROTOCOLS.includes(raw?.protocol as Proto) ? (raw.protocol as Proto) : "any",
    direction: ["any", "from", "to"].includes(raw?.direction as string) ? (raw.direction as Direction) : "any",
    port: text(raw?.port, 200),
    address: text(raw?.address, 600),
    countries: text(raw?.countries, 120),
    isps: text(raw?.isps, 600),
    minBytes: text(raw?.minBytes, 7),
    maxBytes: text(raw?.maxBytes, 7),
    hex: text(raw?.hex, 600),
  };
}

/** Reads a filter file. Throws a plain-language message if it is not one of ours. Older files still open. */
export function fromFile(text: string): Filter[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file is not a filter file (it is not valid JSON).");
  }
  const d = data as { kind?: string; filters?: unknown };
  if (d?.kind !== FILE_KIND || !Array.isArray(d.filters)) throw new Error("That file is not an EqNetwork filter file.");
  const list = (d.filters as Record<string, unknown>[]).map((raw) => clean(raw, false)).filter((f) => Object.keys(problems(f)).length === 0);
  if (list.length === 0) throw new Error("No usable filters were found in that file.");
  return list;
}

/** Reads what get_filters returned: null before anything was saved. Filters saved by older versions get defaults. */
export function fromStored(raw: unknown): Filter[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Record<string, unknown>[]).filter((f) => f && typeof f.id === "string" && typeof f.name === "string").map((f) => clean(f, true));
}

/**
 * Builds the runtime filter an admin published globally. `effectiveEnabled` is the user's own override
 * if they have one, else the shared default. The id is the shared filter's id, so toggling it can be
 * told apart from a normal local filter (see `Filter.globalId`).
 */
export function filterFromGlobal(id: string, name: string, effectiveEnabled: boolean, bodyJson: string): Filter {
  let raw: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(bodyJson);
    if (parsed && typeof parsed === "object") raw = parsed as Record<string, unknown>;
  } catch {
    /* a damaged body falls back to a blank filter */
  }
  return { ...clean({ ...raw, id, name, enabled: effectiveEnabled }, true), globalId: id };
}

/** Everything but id/name/enabled, for an admin to save as a global filter's shared definition. */
export function bodyForGlobal(f: Filter): string {
  const { id: _id, name: _name, enabled: _enabled, globalId: _globalId, ...rest } = f;
  return JSON.stringify(rest);
}
