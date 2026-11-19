import assert from "node:assert/strict";
const H = await import("../src/lib/hex.ts");
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; }; const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

// offsets
eq(H.formatOffset(0), "00000000", "offset zero");
eq(H.formatOffset(16), "00000010", "offset 16");
eq(H.formatOffset(0x1a2b3c), "001a2b3c", "offset pads to eight digits");

// hex
const ip = Uint8Array.from([0x45, 0x00, 0x00, 0x3c, 0x12, 0x34, 0x40, 0x00, 0x40, 0x11]);
eq(H.toHex(ip), "45 00 00 3c 12 34 40 00 40 11", "hex of a whole packet");
eq(H.toHex(ip, { start: 2, end: 4 }), "00 3c", "hex of a range");
eq(H.toHex(ip, { start: 2, end: 4 }, ""), "003c", "hex without separators");
eq(H.toHex(ip, { start: 8, end: 999 }), "40 11", "a range past the end is clamped");
eq(H.toHex(ip, { start: -5, end: 1 }), "45", "a range before the start is clamped");
eq(H.toHex(new Uint8Array(0)), "", "no bytes, no text");
eq(H.byteHex(0), "00", "zero byte"); eq(H.byteHex(255), "ff", "ff byte");

// ascii
eq(H.toAscii(Uint8Array.from([0x45, 0x00, 0x00, 0x3c, 0x12, 0x34, 0x40])), "E..<.4@", "the layout example from the spec");
eq(H.asciiChar(0x1f), ".", "control is a dot"); eq(H.asciiChar(0x20), " ", "space prints"); eq(H.asciiChar(0x7e), "~", "tilde prints");
eq(H.asciiChar(0x7f), ".", "delete is a dot"); eq(H.asciiChar(0xff), ".", "high byte is a dot");
eq(H.toAscii(Uint8Array.from([72, 105, 0, 200]), { start: 1, end: 4 }), "i..", "ascii of a range");

// rows and dump
eq(H.rowCount(0), 0, "no rows"); eq(H.rowCount(16), 1, "one full row"); eq(H.rowCount(17), 2, "partial row counts");
const twenty = Uint8Array.from({ length: 20 }, (_, i) => i);
eq(H.rowBytes(twenty, 1).length, 4, "last row is short"); eq(H.rowBytes(twenty, 0)[15], 15, "first row content");
const dump = H.hexDump(twenty).split("\n");
eq(dump.length, 3, "two lines and a trailing newline");
ok(dump[0].startsWith("00000000  00 01 02 03 04 05 06 07  08 09 0a 0b 0c 0d 0e 0f  "), "dump first line matches the Rust dump");
ok(dump[1].startsWith("00000010  10 11 12 13 "), "dump second line");
eq(dump[0].indexOf("................"), dump[1].indexOf("...."), "ascii column lines up on a short row");
eq(H.hexDump(new Uint8Array(0)), "", "empty dump");

// selection
eq(H.rangeBetween(5, 2), { start: 2, end: 6 }, "range between two bytes, either order");
eq(H.rangeBetween(3, 3), { start: 3, end: 4 }, "single byte range");
ok(H.inRange({ start: 2, end: 4 }, 3) && !H.inRange({ start: 2, end: 4 }, 4) && !H.inRange(null, 0), "range membership is half open");
eq(H.describeRange({ start: 16, end: 32 }), "00000010–0000001f (16 bytes)", "range text");
eq(H.describeRange({ start: 0, end: 1 }), "00000000–00000000 (1 byte)", "single byte text");
eq(H.describeRange(null), "nothing selected", "no selection");

// fields
const fields = [
  { name: "Ethernet", value: "", start: 0, len: 14, depth: 0 },
  { name: "Source", value: "x", start: 6, len: 6, depth: 1 },
  { name: "Payload", value: "5 bytes", start: 40, len: 5, depth: 0 },
];
eq(H.fieldAt(fields, 7).name, "Source", "the inner field wins");
eq(H.fieldAt(fields, 1).name, "Ethernet", "falls back to the header");
eq(H.fieldAt(fields, 20), null, "bytes outside any field");
const mask = H.decodedMask(fields, 50);
ok(mask[0] === 1 && mask[13] === 1 && mask[14] === 0 && mask[42] === 0, "payload bytes are not marked as decoded");
ok(H.decodedMask(fields, 5).length === 5, "mask never outruns the packet");

// virtual scrolling, so a large packet draws only a few rows
const v = H.visibleRows(0, 200, 20, 100000);
ok(v.first === 0 && v.last <= 20, "only the first screen of a huge packet is drawn");
const mid = H.visibleRows(20000, 200, 20, 100000);
ok(mid.last - mid.first < 30 && mid.first > 900, "scrolled far down draws a small window");
eq(H.visibleRows(0, 200, 20, 3).last, 3, "short packet draws every row");
eq(H.rowOf(15), 0, "row of byte 15"); eq(H.rowOf(16), 1, "row of byte 16");

// large packet: formatting 256 KB stays fast and exact
const big = Uint8Array.from({ length: 262144 }, (_, i) => i & 0xff);
const t0 = performance.now();
const hex = H.toHex(big);
const d = H.hexDump(big);
const ms = performance.now() - t0;
eq(hex.length, 262144 * 3 - 1, "hex length for 256 KB");
eq(d.split("\n").length - 1, 16384, "dump line count for 256 KB");
ok(ms < 3000, `formatting 256 KB took ${Math.round(ms)} ms`);

// the formatters never change the bytes they read
const before = Uint8Array.from(ip);
H.toHex(ip); H.toAscii(ip); H.hexDump(ip);
eq(ip, before, "input bytes are untouched");

console.log(`hex: ${n} checks passed`);
