import assert from "node:assert/strict";
const { parseMinecraftLog, labelFor } = await import("../src/lib/mclog.ts");
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

const log = [
  "[12:00:01] [Server thread/INFO]: Steve[/203.0.113.9:51234] logged in with entity id 12 at (1.0, 64.0, 1.0)",
  "[12:05:00] [Server thread/INFO]: Steve lost connection: Disconnected",
  "[12:06:00] [Server thread/INFO]: Alex[/198.51.100.7:40000] logged in with entity id 13 at (0.0, 64.0, 0.0)",
  "[12:07:00] [Server thread/INFO]: Sam_2[/203.0.113.9:51300] logged in with entity id 14 at (0.0, 64.0, 0.0)",
  "[12:08:00] [Server thread/INFO]: Me[/192.168.1.20:5000] logged in with entity id 15 at (0.0, 64.0, 0.0)",
  "[12:09:00] [Server thread/INFO]: .BedrockKid[/203.0.113.50:19132] logged in with entity id 16 at (0.0, 64.0, 0.0)",
  "[12:10:00] [Server thread/INFO]: Done (3.1s)! For help, type \"help\"",
].join("\r\n");

const r = parseMinecraftLog(log);
const get = (a) => r.find((x) => x.address === a);
ok(r.length === 3, "three public addresses");
ok(get("203.0.113.9").names.join() === "Steve,Sam_2", "two players on one address, in order");
ok(get("198.51.100.7").names[0] === "Alex", "single player");
ok(!get("192.168.1.20"), "private address skipped");
ok(get("203.0.113.50").names[0] === ".BedrockKid", "Floodgate style name kept");
ok(parseMinecraftLog("nothing here").length === 0, "no matches is empty");
ok(labelFor(["Steve", "Sam_2"]) === "Steve / Sam_2", "label joins names");
ok(labelFor(["abcdef", "ghijkl"], 8) === "abcdef", "label respects the limit");
console.log(`mclog: ${n} checks passed`);
