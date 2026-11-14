import type { PacketRow } from "@/lib/api";

export type Proto = "any" | "TCP" | "UDP" | "ICMP";
/** Which side of the packet the port and address boxes look at. */
export type Direction = "any" | "from" | "to";

/**
 * A display filter: a packet matches when it passes every box that is filled in.
 * With several filters switched on, the table shows packets that match any of them.
 */
export interface Filter {
  id: string;
  name: string;
  enabled: boolean;
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

const base = { enabled: false, direction: "any" as Direction, port: "", address: "", minBytes: "", maxBytes: "", hex: "" };

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

const isFullAddress = (a: string) => (a.includes(":") ? !a.endsWith(":") : /^\d{1,3}(\.\d{1,3}){3}$/.test(a));
const sameAddress = (filter: string, ip: string) =>
  isFullAddress(filter) ? ip.toLowerCase() === filter.toLowerCase() : ip.toLowerCase().startsWith(filter.toLowerCase());

export function normalizeHex(text: string): string {
  return text.replace(/[\s:,-]/g, "").toLowerCase();
}

/** True if the bytes appear in `head` on a byte boundary (head is hex text, two characters per byte). */
function headHas(head: string, needle: string): boolean {
  for (let i = head.indexOf(needle); i !== -1; i = head.indexOf(needle, i + 1)) if (i % 2 === 0) return true;
  return false;
}

export function matches(f: Filter, r: PacketRow): boolean {
  if (f.protocol !== "any" && r.protocol !== f.protocol) return false;
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

/** Shows everything when no filter is switched on; otherwise packets that match any switched-on filter. */
export function matchesAny(filters: Filter[], r: PacketRow): boolean {
  const on = filters.filter((f) => f.enabled);
  return on.length === 0 || on.some((f) => matches(f, r));
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
  return JSON.stringify({ kind: FILE_KIND, version: 2, filters }, null, 2);
}

function clean(raw: Record<string, unknown>, keepId: boolean): Filter {
  const text = (v: unknown, n: number) => String(v ?? "").slice(0, n);
  return {
    id: keepId && typeof raw?.id === "string" ? raw.id : newId(), // ids from a file are never trusted
    name: text(raw?.name, 80),
    enabled: keepId ? raw?.enabled === true : false, // imported filters start switched off
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
  if (d?.kind !== FILE_KIND || !Array.isArray(d.filters)) throw new Error("That file is not a Network Toolkit filter file.");
  const list = (d.filters as Record<string, unknown>[]).map((raw) => clean(raw, false)).filter((f) => Object.keys(problems(f)).length === 0);
  if (list.length === 0) throw new Error("No usable filters were found in that file.");
  return list;
}

/** Reads what get_filters returned: null before anything was saved. Filters saved by older versions get defaults. */
export function fromStored(raw: unknown): Filter[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Record<string, unknown>[]).filter((f) => f && typeof f.id === "string" && typeof f.name === "string").map((f) => clean(f, true));
}
