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
// hide filters
const hideTcp = mk({ id: "h", protocol: "TCP", enabled: true, mode: "hide" });
ok(!f.matchesAny([hideTcp], row({ protocol: "TCP" })), "hide removes what it matches");
ok(f.matchesAny([hideTcp], row({ protocol: "UDP" })), "hide alone keeps everything else");
ok(!f.matchesAny([hideTcp, mk({ id: "s", protocol: "TCP", enabled: true })], row({ protocol: "TCP" })), "hide wins over show");
ok(f.matchesAny([hideTcp, mk({ id: "u", protocol: "UDP", enabled: true })], row({ protocol: "UDP" })), "show still limits when a hide is on too");
ok(!f.matchesAny([hideTcp, mk({ id: "u2", protocol: "UDP", enabled: true })], row({ protocol: "ICMP" })), "packets outside the show filter stay hidden");
ok(f.matchesAny([{ ...hideTcp, enabled: false }], row({ protocol: "TCP" })), "switched-off hide does nothing");
ok(f.fromStored([{ id: "x", name: "n" }])[0].mode === "show", "legacy filters are show filters");
ok(f.fromFile(f.toFile([mk({ id: "q", name: "h", mode: "hide" })]))[0].mode === "hide", "mode survives export and import");
// problems
ok(f.problems(mk({ hex: "4" })).hex, "odd hex rejected");
ok(f.problems(mk({ hex: "zz" })).hex, "non hex rejected");
ok(f.problems(mk({ hex: "00".repeat(33) })).hex, "over 32 bytes rejected");
ok(!f.problems(mk({ hex: "47 45" })).hex, "hex ok");
ok(f.problems(mk({ minBytes: "10", maxBytes: "5" })).maxBytes, "min > max rejected");
ok(f.problems(mk({ port: "70000" })).port, "port range");
ok(f.matches(mk({ port: "80, 60, 90, 100-200, 53" }), row()) && f.matches(mk({ port: "4000-6000" }), row()) && !f.matches(mk({ port: "80, 100-200" }), row()), "port list and ranges");
ok(!f.problems(mk({ port: "80, 60, 90, 100-200, 65" })).port && f.problems(mk({ port: "80,,x" })).port && f.problems(mk({ port: "200-100" })).port, "port list validation");
ok(f.portsToBpf("80, 100-200") === "(port 80 or portrange 100-200)" && f.portsToBpf("53") === "port 53", "port list as BPF");
const look = { country: (ip) => ({ "8.8.8.8": "US", "1.1.1.1": "AU" })[ip], isp: (ip) => ({ "8.8.8.8": "Google LLC", "1.1.1.1": "Cloudflare, Inc." })[ip] };
const pk = (src, dst, extra = {}) => ({ ...row(), src, dst, ...extra });
ok(f.matches(mk({ address: "9.9.9.9, 10.0.0.0/8" }), pk("10.5.6.7", "8.8.8.8")) && !f.matches(mk({ address: "9.9.9.9, 192.168.0.0/16" }), pk("10.5.6.7", "8.8.8.4")), "several addresses and CIDR");
ok(f.matches(mk({ address: "192.168.1.0/24" }), pk("192.168.1.77", "8.8.8.8")) && !f.matches(mk({ address: "192.168.1.0/24" }), pk("192.168.2.1", "8.8.8.8")), "CIDR /24 edges");
ok(f.matches(mk({ countries: "de, us" }), pk("1.2.3.4", "8.8.8.8"), look) && !f.matches(mk({ countries: "DE" }), pk("1.2.3.4", "8.8.8.8"), look) && !f.matches(mk({ countries: "US" }), pk("1.2.3.4", "8.8.8.8")), "country list, unknown never matches");
ok(f.matches(mk({ isps: "amazon, cloud" }), pk("1.1.1.1", "5.5.5.5"), look) && f.matches(mk({ isps: "GOOGLE" }), pk("5.5.5.5", "8.8.8.8"), look) && !f.matches(mk({ isps: "google", direction: "from" }), pk("5.5.5.5", "8.8.8.8"), look), "isp partial, case, direction");
ok(f.matches(mk({ hex: "AA BB, 47 45" }), pk("1.1.1.1", "2.2.2.2", { head: "47455420" })) && !f.matches(mk({ hex: "AA BB, CC" }), pk("1.1.1.1", "2.2.2.2", { head: "47455420" })), "hex patterns, any one");
ok(f.problems(mk({ address: "10.0.0.0/33" })).address && f.problems(mk({ countries: "USA" })).countries && !f.problems(mk({ address: "10.0.0.0/8, fe80::/10, 192.168." })).address, "new box validation");
ok(f.problems(mk({ name: " " })).name, "name needed");
// files
const out = f.fromFile(f.toFile([mk({ id: "keep", name: "one", enabled: true, direction: "to", hex: "47" })]));
ok(out.length === 1 && out[0].id !== "keep" && out[0].enabled === false && out[0].direction === "to" && out[0].hex === "47", "file import: new id, off, fields kept");
const old = JSON.stringify({ kind: "network-toolkit-filters", version: 1, filters: [{ id: "q", name: "old", protocol: "TCP", port: "80", address: "", minBytes: "" }] });
ok(f.fromFile(old)[0].direction === "any" && f.fromFile(old)[0].maxBytes === "", "version 1 files still open");
assert.throws(() => f.fromFile("nope"), /not valid JSON/); n++;
assert.throws(() => f.fromFile(JSON.stringify({ kind: "x" })), /not an EqNetwork/); n++;
const stored = f.fromStored([{ id: "z", name: "legacy", protocol: "UDP", port: "53", address: "", minBytes: "" }, { bad: 1 }]);
ok(stored.length === 1 && stored[0].enabled === false && stored[0].id === "z", "stored legacy filters get defaults");
ok(f.STARTERS === undefined, "no built-in filters: the list starts empty");

// Capture-level payload bytes
const cf = await import("../src/lib/capturefilter.ts");
const cfo = (o) => ({ ...cf.NO_CAPTURE_FILTER, ...o });
ok(cf.toBpf(cfo({})) === "", "no capture filter");
ok(cf.toBpf(cfo({ protocol: "TCP", hex: "47 45 54 20" })) === "tcp and ip and tcp[((tcp[12] & 0xf0) >> 2) + 0:4] = 0x47455420", "tcp 4 bytes");
ok(cf.toBpf(cfo({ protocol: "UDP", hex: "ab" })) === "udp and ip and udp[8 + 0:1] = 0xab", "udp 1 byte");
ok(cf.toBpf(cfo({ protocol: "UDP", hex: "0102030405060708" })).includes("udp[8 + 4:4] = 0x05060708"), "8 bytes = two chunks");
ok(cf.toBpf(cfo({ protocol: "UDP", hex: "010203" })).includes("udp[8 + 0:2] = 0x0102") && cf.toBpf(cfo({ protocol: "UDP", hex: "010203" })).includes("udp[8 + 2:1] = 0x03"), "3 bytes = 2 + 1");
const any = cf.toBpf(cfo({ hex: "4745", port: "80" }));
ok(any.startsWith("((ip and tcp[") && any.includes(") or (ip and udp[") && any.endsWith("and port 80"), "any protocol checks both", any);
ok(cf.captureProblems(cfo({ hex: "zz" })).hex && cf.captureProblems(cfo({ hex: "123" })).hex && cf.captureProblems(cfo({ hex: "00".repeat(9) })).hex, "bad hex flagged");
ok(cf.captureProblems(cfo({ protocol: "ICMP", hex: "47" })).hex, "hex with ICMP flagged");
ok(cf.toBpf(cfo({ hex: "zz" })) === "", "bad boxes give an empty filter");
ok(cf.fromStoredCapture({ protocol: "TCP", hex: "47 45" }).hex === "47 45" && cf.fromStoredCapture({ protocol: "TCP" }).hex === "", "stored filter reads hex, old files default");

// Address matching: IPv4 on octet boundaries
const addr = (address, ip, o = {}) => f.matches(mk({ address, ...o }), row({ src: ip, dst: "8.8.8.8", ...o.row }));
ok(addr("10.1", "10.1.2.3") && addr("10.1.", "10.1.2.3"), "10.1 matches 10.1.x.x");
ok(!addr("10.1", "10.10.2.3") && !addr("10.1", "10.100.0.1"), "10.1 does not match 10.10.x.x");
ok(!addr("10.1.", "10.10.2.3"), "10.1. does not match 10.10.x.x");
ok(addr("10", "10.0.0.1") && !addr("10", "100.0.0.1") && !addr("1", "10.0.0.1"), "single octet is an octet, not a text prefix");
ok(addr("192.168.0", "192.168.0.20") && !addr("192.168.0", "192.168.1.20"), "three octets");
ok(addr("192.168.0.20", "192.168.0.20") && !addr("192.168.0.2", "192.168.0.20"), "full v4 exact");
ok(!addr("10.1", "2001:db8::1"), "v4 text does not match v6 rows");

// Address matching: IPv6
ok(addr("2001:db8::1", "2001:db8::1"), "v6 full exact");
ok(addr("2001:0db8:0:0:0:0:0:1", "2001:db8::1"), "v6 full, different spelling, same address");
ok(addr("2001:DB8::1", "2001:db8::1"), "v6 case");
ok(!addr("2001:db8::1", "2001:db8::10") && !addr("2001:db8::1", "2001:db8::1:0"), "v6 full never matches a longer one");
ok(addr("2001:db8", "2001:db8::10") && addr("2001:db8:", "2001:db8::10") && addr("fe80::", "fe80::1234"), "v6 partial and trailing :: are prefixes");
ok(addr("fe80:", "fe80::1") && !addr("fe80:", "fd00::1"), "v6 prefix with colon");
ok(addr("::1", "::1") && !addr("::1", "::10"), "loopback is exact");
ok(addr("::ffff:1.2.3.4", "::ffff:102:304"), "v4-mapped spelling");
ok(f.isCompleteIpv6("fe80::1") && f.isCompleteIpv6("1:2:3:4:5:6:7:8") && f.isCompleteIpv6("::") && f.isCompleteIpv6("::ffff:1.2.3.4"), "complete v6");
ok(!f.isCompleteIpv6("fe80:") && !f.isCompleteIpv6("1:2:3:4:5:6:7") && !f.isCompleteIpv6("1::2::3") && !f.isCompleteIpv6("12345::1") && !f.isCompleteIpv6("1:2:3:4:5:6:7:8:9") && !f.isCompleteIpv6("::g") && !f.isCompleteIpv6("1:2:3:4:5:6:7::8") && !f.isCompleteIpv6("1.2.3.4"), "incomplete v6");
ok(f.matches(mk({ protocol: "ICMP" }), row({ protocol: "ICMPv6" })) && !f.matches(mk({ protocol: "UDP" }), row({ protocol: "ICMPv6" })), "ICMP filter covers ICMPv6");

// Capture filter: addresses
const addrProblem = (a) => cf.captureProblems(cfo({ address: a })).address;
ok(!addrProblem("192.168.0.20") && !addrProblem("10.0.0.1") && !addrProblem("0.0.0.0"), "plain v4 fine");
ok(addrProblem("192.168.000.20") && addrProblem("010.0.0.1") && addrProblem("1.2.3.04") && addrProblem("00.1.1.1"), "leading-zero octets rejected");
ok(addrProblem("256.1.1.1") && addrProblem("1.2.3") && addrProblem("1.2.3.4.5") && addrProblem("1.2.3.-4"), "bad v4 rejected");
ok(!addrProblem("fe80::1") && !addrProblem("2001:db8:0:0:0:0:0:1") && !addrProblem("::1"), "v6 fine");
ok(addrProblem(":::") && addrProblem("1::2::3") && addrProblem("fe80:") && addrProblem("12345::1") && addrProblem("g::1"), "bad v6 rejected");
ok(cf.toBpf(cfo({ address: "010.0.0.1" })) === "", "leading zeros give no filter");
ok(cf.toBpf(cfo({ address: "fe80::1", protocol: "TCP", port: "80" })) === "tcp and port 80 and host fe80::1", "v6 host");

// Every filter text the app can build stays inside the characters the app side accepts.
const WHITELIST = /^[A-Za-z0-9 .:()\[\]+&>=]*$/;
const protocols = ["any", "TCP", "UDP", "ICMP"], ports = ["", "80", "65535"], addrs = ["", "192.168.0.20", "fe80::1", "::1", "2001:db8::abcd"];
const mins = ["", "1", "1500"], hexes = ["", "47", "47 45 54 20", "0102030405060708", "ab:cd", "010203"];
let combos = 0, bad = [];
for (const protocol of protocols) for (const port of ports) for (const address of addrs) for (const minBytes of mins) for (const hex of hexes) {
  const text = cf.toBpf(cfo({ protocol, port, address, minBytes, hex }));
  combos++;
  if (!WHITELIST.test(text) || text.length > 600) bad.push(text);
}
ok(combos > 500 && bad.length === 0, "every toBpf output matches the whitelist and length cap: " + bad[0]);

// seedFromRow: a right-clicked row becomes the starting point of a new filter
{
  const a = f.seedFromRow("13.134.141.148", ["UDP"], [50498, 56066], "");
  ok(a.address === "13.134.141.148" && a.protocol === "UDP" && a.port === "" && a.name === "Filter for 13.134.141.148", "seed: only high ports -> no port box");
  const b = f.seedFromRow("1.2.3.4", ["TCP", "UDP"], [9305, 3478, 3479, 61000], "Steve");
  ok(b.protocol === "any" && b.port === "3478, 3479" && b.name === "Filter for Steve", "seed: mixed protocols -> any, two lowest service ports, label as name");
  ok(f.seedFromRow("1.2.3.4", ["ICMPv6"], [null, null]).protocol === "ICMP", "seed: ICMPv6 maps to ICMP");
}
console.log(`${n} checks passed`);
