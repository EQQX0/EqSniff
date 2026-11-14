import assert from "node:assert/strict";
const f = await import("../src/lib/filters.ts");
const row = (o) => ({ id: 1, time: 0, src: "192.168.0.20", dst: "8.8.8.8", srcPort: 5000, dstPort: 53, protocol: "UDP", length: 100, head: "474554200d0a", ...o });
const mk = (o) => ({ ...f.blankFilter("x"), name: "t", ...o });
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

ok(f.matches(mk({}), row()), "empty filter matches everything");
ok(f.matches(mk({ protocol: "UDP" }), row()), "protocol");
ok(!f.matches(mk({ protocol: "TCP" }), row()), "protocol mismatch");
ok(f.matches(mk({ port: "53" }), row()) && f.matches(mk({ port: "5000" }), row()), "port either side");
ok(f.matches(mk({ port: "53", direction: "to" }), row()) && !f.matches(mk({ port: "53", direction: "from" }), row()), "port direction");
ok(f.matches(mk({ address: "192.168.0.20", direction: "from" }), row()) && !f.matches(mk({ address: "192.168.0.20", direction: "to" }), row()), "address direction");
ok(f.matches(mk({ address: "192.168.0" }), row({ src: "192.168.0.20" })), "short address is a prefix");
ok(!f.matches(mk({ address: "192.168.0.2" }), row({ src: "192.168.0.200", dst: "8.8.8.8" })), "a complete address never matches a longer one");
ok(!f.matches(mk({ address: "192.168.0.20" }), row({ src: "192.168.0.200", dst: "8.8.8.8" })), "full address is exact, not .200");
ok(f.matches(mk({ address: "192.168." }), row()), "prefix with dot");
ok(f.matches(mk({ minBytes: "100" }), row()) && !f.matches(mk({ minBytes: "101" }), row()), "min bytes");
ok(f.matches(mk({ maxBytes: "100" }), row()) && !f.matches(mk({ maxBytes: "99" }), row()), "max bytes");
ok(f.matches(mk({ hex: "47 45 54 20" }), row()), "hex GET with spaces");
ok(f.matches(mk({ hex: "47:45:54" }), row()), "hex colons");
ok(f.matches(mk({ hex: "4554" }), row({ head: "4745542000" })), "hex mid match");
ok(!f.matches(mk({ hex: "7454" }), row({ head: "47454200" })), "hex absent");
ok(!f.matches(mk({ hex: "74" }), row({ head: "a74b" })), "hex must align on a byte boundary");
ok(f.matches(mk({ hex: "a7" }), row({ head: "a74b" })), "hex aligned");
ok(!f.matches(mk({ hex: "47" }), row({ head: "" })), "no payload");
// matchesAny
const a = mk({ id: "a", protocol: "TCP", enabled: true }), b = mk({ id: "b", protocol: "UDP", enabled: true }), c = mk({ id: "c", protocol: "ICMP", enabled: false });
ok(f.matchesAny([a, b, c], row()), "any of the enabled");
ok(!f.matchesAny([a, c], row()), "enabled ones do not match");
ok(f.matchesAny([c], row({ protocol: "TCP" })), "none enabled shows everything");
// problems
ok(f.problems(mk({ hex: "4" })).hex, "odd hex rejected");
ok(f.problems(mk({ hex: "zz" })).hex, "non hex rejected");
ok(f.problems(mk({ hex: "00".repeat(33) })).hex, "over 32 bytes rejected");
ok(!f.problems(mk({ hex: "47 45" })).hex, "hex ok");
ok(f.problems(mk({ minBytes: "10", maxBytes: "5" })).maxBytes, "min > max rejected");
ok(f.problems(mk({ port: "70000" })).port, "port range");
ok(f.problems(mk({ name: " " })).name, "name needed");
// files
const out = f.fromFile(f.toFile([mk({ id: "keep", name: "one", enabled: true, direction: "to", hex: "47" })]));
ok(out.length === 1 && out[0].id !== "keep" && out[0].enabled === false && out[0].direction === "to" && out[0].hex === "47", "file import: new id, off, fields kept");
const old = JSON.stringify({ kind: "network-toolkit-filters", version: 1, filters: [{ id: "q", name: "old", protocol: "TCP", port: "80", address: "", minBytes: "" }] });
ok(f.fromFile(old)[0].direction === "any" && f.fromFile(old)[0].maxBytes === "", "version 1 files still open");
assert.throws(() => f.fromFile("nope"), /not valid JSON/); n++;
assert.throws(() => f.fromFile(JSON.stringify({ kind: "x" })), /not a Network Toolkit/); n++;
const stored = f.fromStored([{ id: "z", name: "legacy", protocol: "UDP", port: "53", address: "", minBytes: "" }, { bad: 1 }]);
ok(stored.length === 1 && stored[0].enabled === false && stored[0].id === "z", "stored legacy filters get defaults");
ok(f.STARTERS.every((s) => Object.keys(f.problems(s)).length === 0), "starters are valid");
console.log(`${n} checks passed`);
