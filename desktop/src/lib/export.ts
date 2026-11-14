import type { PacketRow } from "@/lib/api";

const iso = (t: number) => new Date(t * 1000).toISOString();

/** Spreadsheet programs run text starting with = + - @ as a formula. Prefix those with a quote. */
const cell = (v: string | number | null) => {
  const s = v === null ? "" : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

const HEAD = ["time", "source", "source_port", "destination", "destination_port", "protocol", "bytes"];

export function toCsv(rows: PacketRow[]): string {
  const lines = rows.map((r) => [iso(r.time), r.src, r.srcPort, r.dst, r.dstPort, r.protocol, r.length].map(cell).join(","));
  return [HEAD.join(","), ...lines].join("\r\n") + "\r\n";
}

export function toJson(rows: PacketRow[]): string {
  return JSON.stringify(
    rows.map((r) => ({ time: iso(r.time), source: r.src, sourcePort: r.srcPort, destination: r.dst, destinationPort: r.dstPort, protocol: r.protocol, bytes: r.length })),
    null,
    2
  );
}

export function toTxt(rows: PacketRow[]): string {
  const ep = (ip: string, p: number | null) => (p === null ? ip : ip.includes(":") ? `[${ip}]:${p}` : `${ip}:${p}`);
  return rows.map((r) => `${iso(r.time)}  ${r.protocol.padEnd(5)} ${ep(r.src, r.srcPort)} -> ${ep(r.dst, r.dstPort)}  ${r.length} bytes`).join("\n") + "\n";
}

export function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** True for addresses that stay inside a home or office network. */
export function isLocalAddress(ip: string): boolean {
  if (ip.includes(":")) {
    const l = ip.toLowerCase();
    return l === "::1" || l.startsWith("fe8") || l.startsWith("fe9") || l.startsWith("fea") || l.startsWith("feb") || l.startsWith("fc") || l.startsWith("fd");
  }
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n))) return false;
  return p[0] === 10 || p[0] === 127 || (p[0] === 192 && p[1] === 168) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 169 && p[1] === 254);
}
