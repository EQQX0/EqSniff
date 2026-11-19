// Formatting and selection helpers for the HEX inspector. Pure functions: they read bytes and
// never change them, and they have no window code, so the tests run them directly.

export const BYTES_PER_ROW = 16;

/** One decoded field of a packet: a name, its value as text, and the byte range it covers. */
export interface PacketField {
  name: string;
  value: string;
  start: number;
  len: number;
  /** 0 = a header (Ethernet, IPv4, TCP...), 1 = one field inside it. */
  depth: number;
}

/** A half-open byte range: `start` is included, `end` is not. */
export interface ByteRange {
  start: number;
  end: number;
}

/** Eight hex digits, like Wireshark: 00000010. */
export function formatOffset(n: number): string {
  return n.toString(16).padStart(8, "0");
}

export function byteHex(b: number): string {
  return (b & 0xff).toString(16).padStart(2, "0");
}

/** The printable ASCII character for a byte, or "." for anything else. */
export function asciiChar(b: number): string {
  return b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".";
}

export function rowCount(length: number): number {
  return Math.ceil(length / BYTES_PER_ROW);
}

/** Bytes from `start` up to the end of the row that starts there (a view, not a copy). */
export function rowBytes(bytes: Uint8Array, row: number): Uint8Array {
  const start = row * BYTES_PER_ROW;
  return bytes.subarray(start, Math.min(start + BYTES_PER_ROW, bytes.length));
}

/** "45 00 00 3c" for the whole packet or a range. */
export function toHex(bytes: Uint8Array, range?: ByteRange, sep = " "): string {
  const start = Math.max(0, range?.start ?? 0);
  const end = Math.min(bytes.length, range?.end ?? bytes.length);
  const out: string[] = [];
  for (let i = start; i < end; i++) out.push(byteHex(bytes[i]));
  return out.join(sep);
}

/** The printable characters of a whole packet or a range, with "." for unprintable bytes. */
export function toAscii(bytes: Uint8Array, range?: ByteRange): string {
  const start = Math.max(0, range?.start ?? 0);
  const end = Math.min(bytes.length, range?.end ?? bytes.length);
  let out = "";
  for (let i = start; i < end; i++) out += asciiChar(bytes[i]);
  return out;
}

/** A full text dump (offset, hex, ASCII), the same layout as the dump the app's Rust side builds. */
export function hexDump(bytes: Uint8Array): string {
  const lines: string[] = [];
  for (let r = 0; r < rowCount(bytes.length); r++) {
    const row = rowBytes(bytes, r);
    let hex = "";
    for (let j = 0; j < BYTES_PER_ROW; j++) {
      hex += j < row.length ? byteHex(row[j]) + " " : "   ";
      if (j === 7) hex += " ";
    }
    lines.push(`${formatOffset(r * BYTES_PER_ROW)}  ${hex} ${toAscii(row)}`);
  }
  return lines.length ? lines.join("\n") + "\n" : "";
}

/** Orders two byte positions into a range that includes both. */
export function rangeBetween(a: number, b: number): ByteRange {
  return { start: Math.min(a, b), end: Math.max(a, b) + 1 };
}

export function inRange(r: ByteRange | null, i: number): boolean {
  return r !== null && i >= r.start && i < r.end;
}

/** "00000010–0000001f (16 bytes)". */
export function describeRange(r: ByteRange | null): string {
  if (!r || r.end <= r.start) return "nothing selected";
  const n = r.end - r.start;
  return `${formatOffset(r.start)}–${formatOffset(r.end - 1)} (${n.toLocaleString()} byte${n === 1 ? "" : "s"})`;
}

/** The most specific decoded field that covers a byte (a field inside a header, else the header). */
export function fieldAt(fields: PacketField[], index: number): PacketField | null {
  let best: PacketField | null = null;
  for (const f of fields) {
    if (index >= f.start && index < f.start + f.len && (!best || f.depth >= best.depth)) best = f;
  }
  return best;
}

/** Marks which bytes belong to a decoded field, so captured-but-undecoded bytes can look different. */
export function decodedMask(fields: PacketField[], length: number): Uint8Array {
  const mask = new Uint8Array(length);
  for (const f of fields) {
    // A payload is shown as "decoded" only in the sense of being located, not interpreted, so it does not count.
    if (f.depth === 0 && /payload|data|extension/i.test(f.name)) continue;
    mask.fill(1, Math.max(0, f.start), Math.min(length, f.start + f.len));
  }
  return mask;
}

/** First and last row to draw for a scroll position, with a little extra above and below. */
export function visibleRows(scrollTop: number, viewHeight: number, rowHeight: number, total: number, extra = 4): { first: number; last: number } {
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - extra);
  const last = Math.min(total, Math.ceil((scrollTop + viewHeight) / rowHeight) + extra);
  return { first, last };
}

/** The row a byte is in, so the view can scroll to a selected field. */
export function rowOf(index: number): number {
  return Math.floor(index / BYTES_PER_ROW);
}
