import type { PacketRow } from "@/lib/api";

export type Proto = "any" | "TCP" | "UDP" | "ICMP";

/** A display filter: a packet is shown when it matches every field that is filled in. */
export interface Filter {
  id: string;
  name: string;
  protocol: Proto;
  port: string; // empty = any; otherwise matches source or destination port
  address: string; // empty = any; otherwise the start of an IP address, source or destination
  minBytes: string; // empty = any
}

export const PROTOCOLS: Proto[] = ["any", "TCP", "UDP", "ICMP"];

export const STARTERS: Filter[] = [
  { id: "starter-web", name: "Secure web traffic (port 443)", protocol: "TCP", port: "443", address: "", minBytes: "" },
  { id: "starter-dns", name: "DNS lookups", protocol: "UDP", port: "53", address: "", minBytes: "" },
  { id: "starter-ping", name: "Ping (ICMP)", protocol: "ICMP", port: "", address: "", minBytes: "" },
  { id: "starter-local", name: "Local network only (192.168.)", protocol: "any", port: "", address: "192.168.", minBytes: "" },
  { id: "starter-big", name: "Large packets (1000+ bytes)", protocol: "any", port: "", address: "", minBytes: "1000" },
];

export function matches(f: Filter, r: PacketRow): boolean {
  if (f.protocol !== "any" && r.protocol !== f.protocol) return false;
  if (f.port.trim() !== "") {
    const p = Number(f.port);
    if (r.srcPort !== p && r.dstPort !== p) return false;
  }
  const a = f.address.trim();
  if (a !== "" && !r.src.startsWith(a) && !r.dst.startsWith(a)) return false;
  if (f.minBytes.trim() !== "" && r.length < Number(f.minBytes)) return false;
  return true;
}

/** Returns a plain-language problem with a filter, or null when it is fine. */
export function problems(f: Filter): { name?: string; port?: string; minBytes?: string } {
  const out: { name?: string; port?: string; minBytes?: string } = {};
  if (f.name.trim() === "") out.name = "Give the filter a name.";
  if (f.port.trim() !== "" && !(/^\d+$/.test(f.port.trim()) && Number(f.port) >= 1 && Number(f.port) <= 65535))
    out.port = "Use a port from 1 to 65535, or leave it empty.";
  if (f.minBytes.trim() !== "" && !/^\d+$/.test(f.minBytes.trim())) out.minBytes = "Use a whole number, or leave it empty.";
  return out;
}

export const newId = () => `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

const FILE_KIND = "network-toolkit-filters";

export function toFile(filters: Filter[]): string {
  return JSON.stringify({ kind: FILE_KIND, version: 1, filters }, null, 2);
}

/** Reads a filter file. Throws a plain-language message if it is not one of ours. */
export function fromFile(text: string): Filter[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file is not a filter file (it is not valid JSON).");
  }
  const d = data as { kind?: string; filters?: unknown };
  if (d?.kind !== FILE_KIND || !Array.isArray(d.filters)) throw new Error("That file is not a Network Toolkit filter file.");
  const list: Filter[] = [];
  for (const raw of d.filters as Record<string, unknown>[]) {
    const proto = PROTOCOLS.includes(raw?.protocol as Proto) ? (raw.protocol as Proto) : "any";
    const f: Filter = {
      id: newId(), // never trust ids from a file
      name: String(raw?.name ?? "").slice(0, 80),
      protocol: proto,
      port: String(raw?.port ?? "").slice(0, 5),
      address: String(raw?.address ?? "").slice(0, 45),
      minBytes: String(raw?.minBytes ?? "").slice(0, 7),
    };
    if (Object.keys(problems(f)).length === 0) list.push(f);
  }
  if (list.length === 0) throw new Error("No usable filters were found in that file.");
  return list;
}

/** Reads what get_filters returned: null before anything was saved. */
export function fromStored(raw: unknown): Filter[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Filter[]).filter((f) => f && typeof f.id === "string" && typeof f.name === "string");
}
