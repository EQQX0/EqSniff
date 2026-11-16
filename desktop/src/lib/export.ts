import type { PacketRow } from "@/lib/api";

const iso = (t: number) => new Date(t * 1000).toISOString();

/** Spreadsheet programs run text starting with = + - @ as a formula. Prefix those with a quote. */
export const cell = (v: string | number | null) => {
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
  downloadBlob(name, new Blob([text], { type }));
}

export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
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

const endpoint = (ip: string, p: number | null) => (p === null ? ip : ip.includes(":") ? `[${ip}]:${p}` : `${ip}:${p}`);

/** One packet as a tab-separated line, which pastes into a spreadsheet as separate cells. */
export function rowToTsv(r: PacketRow, country = ""): string {
  return [iso(r.time), endpoint(r.src, r.srcPort), endpoint(r.dst, r.dstPort), country, r.protocol, r.length].join("\t");
}

export function tableToTsv(rows: PacketRow[], countryOf: (r: PacketRow) => string): string {
  const head = ["Time", "Source", "Destination", "Country", "Protocol", "Bytes"].join("\t");
  return [head, ...rows.map((r) => rowToTsv(r, countryOf(r)))].join("\r\n") + "\r\n";
}

/** Copies text to the clipboard. Returns false if the system refused. */
export async function copyText(text: string): Promise<boolean> {
  // The older call needs no permission prompt inside a click, so try it first.
  const box = document.createElement("textarea");
  box.value = text;
  box.setAttribute("readonly", "");
  box.style.position = "fixed";
  box.style.opacity = "0";
  document.body.appendChild(box);
  box.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  box.remove();
  if (ok) return true;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
