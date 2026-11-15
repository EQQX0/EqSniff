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
  hex: string; // empty = any. Bytes that must appear in the first 32 bytes of the payload.
}

export const PROTOCOLS: Proto[] = ["any", "TCP", "UDP", "ICMP"];
export const DIRECTIONS: { id: Direction; label: string }[] = [
  { id: "any", label: "Either side" },
  { id: "from", label: "Source (sender) only" },
  { id: "to", label: "Destination (receiver) only" },
];

const base = { enabled: false, mode: "show" as Mode, direction: "any" as Direction, port: "", address: "", minBytes: "", maxBytes: "", hex: "" };

export const STARTERS: Filter[] = [
  { ...base, id: "starter-web", name: "Secure web traffic (port 443)", protocol: "TCP", port: "443" },
  { ...base, id: "starter-dns", name: "DNS lookups", protocol: "UDP", port: "53" },
  { ...base, id: "starter-ping", name: "Ping (ICMP)", protocol: "ICMP" },
  { ...base, id: "starter-local", name: "Local network only (192.168.)", protocol: "any", address: "192.168." },
  { ...base, id: "starter-big", name: "Large packets (1000+ bytes)", protocol: "any", minBytes: "1000" },
  { ...base, id: "starter-get", name: "Web page requests (starts with GET)", protocol: "TCP", hex: "47 45 54 20" },
];

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

export function normalizeHex(text: string): string {
  return text.replace(/[\s:,-]/g, "").toLowerCase();
}

/** True if the bytes appear in `head` on a byte boundary (head is hex text, two characters per byte). */
function headHas(head: string, needle: string): boolean {
  for (let i = head.indexOf(needle); i !== -1; i = head.indexOf(needle, i + 1)) if (i % 2 === 0) return true;
  return false;
}

export function matches(f: Filter, r: PacketRow): boolean {
  // The ICMP filter covers both the IPv4 and IPv6 flavours.
  if (f.protocol !== "any" && r.protocol !== f.protocol && !(f.protocol === "ICMP" && r.protocol === "ICMPv6")) return false;
  const side = (src: boolean, dst: boolean) => (f.direction === "from" ? src : f.direction === "to" ? dst : src || dst);
  if (f.port.trim() !== "") {
    const p = Number(f.port);
    if (!side(r.srcPort === p, r.dstPort === p)) return false;
  }
  const a = f.address.trim();
  if (a !== "" && !side(sameAddress(a, r.src), sameAddress(a, r.dst))) return false;
  if (f.minBytes.trim() !== "" && r.length < Number(f.minBytes)) return false;
  if (f.maxBytes.trim() !== "" && r.length > Number(f.maxBytes)) return false;
  const h = normalizeHex(f.hex);
  if (h !== "" && !headHas(r.head ?? "", h)) return false;
  return true;
}

/**
 * Hide filters remove what they match. Show filters, when any are on, keep only what they match.
 * With nothing switched on, every packet shows.
 */
export function matchesAny(filters: Filter[], r: PacketRow): boolean {
  const on = filters.filter((f) => f.enabled);
  if (on.some((f) => f.mode === "hide" && matches(f, r))) return false;
  const show = on.filter((f) => f.mode !== "hide");
  return show.length === 0 || show.some((f) => matches(f, r));
}

export interface Problems {
  name?: string;
  port?: string;
  minBytes?: string;
  maxBytes?: string;
  hex?: string;
}

/** Returns plain-language problems with a filter. An empty object means it is fine. */
export function problems(f: Filter): Problems {
  const out: Problems = {};
  if (f.name.trim() === "") out.name = "Give the filter a name.";
  if (f.port.trim() !== "" && !(/^\d+$/.test(f.port.trim()) && Number(f.port) >= 1 && Number(f.port) <= 65535))
    out.port = "Use a port from 1 to 65535, or leave it empty.";
  if (f.minBytes.trim() !== "" && !/^\d+$/.test(f.minBytes.trim())) out.minBytes = "Use a whole number, or leave it empty.";
  if (f.maxBytes.trim() !== "" && !/^\d+$/.test(f.maxBytes.trim())) out.maxBytes = "Use a whole number, or leave it empty.";
  if (!out.minBytes && !out.maxBytes && f.minBytes.trim() !== "" && f.maxBytes.trim() !== "" && Number(f.minBytes) > Number(f.maxBytes))
    out.maxBytes = "The largest size must not be smaller than the smallest.";
  const h = normalizeHex(f.hex);
  if (h !== "" && (!/^([0-9a-f]{2})+$/.test(h) || h.length > 64)) out.hex = "Use hex bytes such as 47 45 54 (at most 32 bytes), or leave it empty.";
  return out;
}

export const newId = () => `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/** Short plain-language summary of what a filter checks. */
export function describe(f: Filter): string {
  const side = f.direction === "from" ? "source " : f.direction === "to" ? "destination " : "";
  return (
    [
      f.protocol !== "any" && f.protocol,
      f.port && `${side}port ${f.port}`,
      f.address && `${side}address ${f.address}${isFullAddress(f.address.trim()) ? "" : "…"}`,
      f.minBytes && `${f.minBytes}+ bytes`,
      f.maxBytes && `up to ${f.maxBytes} bytes`,
      f.hex && `contains ${normalizeHex(f.hex)}`,
    ]
      .filter(Boolean)
      .join(" · ") || "Matches everything"
  );
}

const FILE_KIND = "network-toolkit-filters";

export function toFile(filters: Filter[]): string {
  return JSON.stringify({ kind: FILE_KIND, version: 3, filters }, null, 2);
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
    port: text(raw?.port, 5),
    address: text(raw?.address, 45),
    minBytes: text(raw?.minBytes, 7),
    maxBytes: text(raw?.maxBytes, 7),
    hex: text(raw?.hex, 100),
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
