import type { Proto } from "@/lib/filters";

/** What the network driver keeps. Packets that do not match are never recorded at all. */
export interface CaptureFilter {
  protocol: Proto;
  port: string;
  address: string; // a full IPv4 or IPv6 address, empty = any
  minBytes: string;
}

export const NO_CAPTURE_FILTER: CaptureFilter = { protocol: "any", port: "", address: "", minBytes: "" };

const V4 = /^(\d{1,3})(\.\d{1,3}){3}$/;
const V6 = /^[0-9a-fA-F:]{2,39}$/;

export function captureProblems(f: CaptureFilter): { port?: string; address?: string; minBytes?: string } {
  const out: { port?: string; address?: string; minBytes?: string } = {};
  const port = f.port.trim();
  if (port !== "" && !(/^\d+$/.test(port) && Number(port) >= 1 && Number(port) <= 65535)) out.port = "Use a port from 1 to 65535, or leave it empty.";
  const a = f.address.trim();
  if (a !== "") {
    const v4ok = V4.test(a) && a.split(".").every((n) => Number(n) <= 255);
    const v6ok = a.includes(":") && V6.test(a) && (a.match(/::/g) ?? []).length <= 1;
    if (!v4ok && !v6ok) out.address = "Use one full address such as 192.168.0.20, or leave it empty.";
  }
  const m = f.minBytes.trim();
  if (m !== "" && !(/^\d+$/.test(m) && Number(m) <= 65535)) out.minBytes = "Use a whole number, or leave it empty.";
  return out;
}

/** Builds the filter text the driver understands from the validated boxes. Empty string means record everything. */
export function toBpf(f: CaptureFilter): string {
  if (Object.keys(captureProblems(f)).length > 0) return "";
  const parts: string[] = [];
  if (f.protocol === "TCP") parts.push("tcp");
  if (f.protocol === "UDP") parts.push("udp");
  if (f.protocol === "ICMP") parts.push("(icmp or icmp6)");
  if (f.port.trim() !== "") parts.push(`port ${Number(f.port)}`);
  if (f.address.trim() !== "") parts.push(`host ${f.address.trim()}`);
  if (f.minBytes.trim() !== "") parts.push(`greater ${Number(f.minBytes)}`);
  return parts.join(" and ");
}

export function sameCaptureFilter(a: CaptureFilter, b: CaptureFilter) {
  return a.protocol === b.protocol && a.port === b.port && a.address === b.address && a.minBytes === b.minBytes;
}

/** Reads what the store returned. Anything unexpected becomes "record everything". */
export function fromStoredCapture(raw: unknown): CaptureFilter {
  const r = (raw ?? {}) as Record<string, unknown>;
  const f: CaptureFilter = {
    protocol: (["any", "TCP", "UDP", "ICMP"] as const).includes(r.protocol as Proto) ? (r.protocol as Proto) : "any",
    port: String(r.port ?? "").slice(0, 5),
    address: String(r.address ?? "").slice(0, 45),
    minBytes: String(r.minBytes ?? "").slice(0, 5),
  };
  return Object.keys(captureProblems(f)).length === 0 ? f : NO_CAPTURE_FILTER;
}
