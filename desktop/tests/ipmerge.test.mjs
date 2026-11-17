import assert from "node:assert/strict";
const { mergeSync } = await import("../src/lib/ipmerge.ts");
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
let id = 0; const newId = () => `n${++id}`;
const L = (address, note, t, u) => ({ id: address, address, note, createdAt: t, ...(u ? { updatedAt: u } : {}) });
const R = (address, label, t) => ({ address, label, updatedAt: t });
const get = (r, a) => r.entries.find((e) => e.address === a);

// new computer joins: only adds
let r = mergeSync([], {}, [R("1.1.1.1", "dns", 100), R("2.2.2.2", "x", 200)], newId);
ok(r.entries.length === 2 && r.changedLocal && !r.push.length && !r.remove.length, "empty local adds everything, deletes nothing");
ok(get(r, "1.1.1.1").note === "dns", "label copied");

// first sync from a computer with data: pushes
r = mergeSync([L("a", "one", 10)], {}, [], newId);
ok(r.push.length === 1 && r.push[0].label === "one" && !r.changedLocal, "local only is pushed");

// union
r = mergeSync([L("a", "one", 10)], {}, [R("b", "two", 20)], newId);
ok(r.entries.length === 2 && r.push.length === 1 && r.changedLocal, "union of both sides");

// conflict: newest wins
r = mergeSync([L("a", "old", 10, 10)], {}, [R("a", "new", 50)], newId);
ok(get(r, "a").note === "new" && r.changedLocal && !r.push.length, "newer cloud label wins");
r = mergeSync([L("a", "newer", 10, 90)], {}, [R("a", "old", 50)], newId);
ok(get(r, "a").note === "newer" && r.push.length === 1 && !r.changedLocal, "newer local label wins and is pushed");
r = mergeSync([L("a", "x", 10, 50)], {}, [R("a", "y", 50)], newId);
ok(get(r, "a").note === "x" && r.push.length === 1, "tie keeps local");
r = mergeSync([L("a", "same", 10)], {}, [R("a", "same", 999)], newId);
ok(!r.push.length && !r.changedLocal, "equal labels do nothing");

// deletions
r = mergeSync([], { a: 100 }, [R("a", "x", 50)], newId);
ok(r.remove.join() === "a" && r.entries.length === 0, "deleted here after cloud copy: removed from cloud");
r = mergeSync([], { a: 100 }, [R("a", "edited elsewhere", 500)], newId);
ok(!r.remove.length && get(r, "a").note === "edited elsewhere", "cloud copy edited after the deletion comes back");
r = mergeSync([L("a", "back", 10, 300)], { a: 100 }, [R("a", "x", 50)], newId);
ok(!r.remove.length && get(r, "a").note === "back" && r.push.length === 1, "re-added after delete is kept");
r = mergeSync([L("a", "x", 10, 10)], {}, [], newId);
ok(r.push.length === 1, "never deletes without a record");
// cloud-recorded deletions
r = mergeSync([L("a", "x", 10, 10)], {}, [{ address: "a", label: "x", updatedAt: 100, deleted: true }], newId);
ok(r.entries.length === 0 && r.changedLocal && !r.remove.length && !r.push.length, "deleted elsewhere: removed here");
r = mergeSync([L("a", "edited after", 10, 300)], {}, [{ address: "a", label: "x", updatedAt: 100, deleted: true }], newId);
ok(get(r, "a").note === "edited after" && r.push.length === 1, "edited here after the deletion: kept and restored");
r = mergeSync([], {}, [{ address: "a", label: "x", updatedAt: 100, deleted: true }], newId);
ok(r.entries.length === 0 && !r.changedLocal && !r.remove.length, "deleted row on a new computer adds nothing");

// seen details are combined, never lost
r = mergeSync([{ ...L("a", "x", 10, 10), firstSeen: 100, lastSeen: 500, timesSeen: 2 }], {}, [{ ...R("a", "x", 10), firstSeen: 50, lastSeen: 300, timesSeen: 4 }], newId);
ok(get(r, "a").firstSeen === 50 && get(r, "a").lastSeen === 500 && get(r, "a").timesSeen === 4, "earliest first, latest last, higher count");
ok(r.push.length === 1 && r.changedLocal, "combined seen details are sent and kept");
r = mergeSync([L("a", "x", 10, 10)], {}, [{ ...R("a", "x", 10), firstSeen: 50, lastSeen: 300, timesSeen: 4, place: "UK", isp: "Virgin" }], newId);
ok(get(r, "a").place === "UK" && get(r, "a").isp === "Virgin" && r.changedLocal && !r.push.length, "details from the cloud fill in a bare local copy");
r = mergeSync([], {}, [{ ...R("a", "x", 10), groupKey: "g1", favorite: true, prevLabels: [{ label: "old", until: 5 }] }], newId);
ok(get(r, "a").groupKey === "g1" && get(r, "a").favorite === true && get(r, "a").prevLabels.length === 1, "new computer gets link, favourite, earlier labels");
r = mergeSync([{ ...L("a", "mine", 10, 90), favorite: true }], {}, [{ ...R("a", "theirs", 50), favorite: false }], newId);
ok(get(r, "a").note === "mine" && get(r, "a").favorite === true && r.push.length === 1, "newer local label brings its own favourite");
r = mergeSync([{ ...L("a", "x", 10, 10), firstSeen: 1, lastSeen: 2, timesSeen: 1 }], {}, [{ ...R("a", "x", 10), firstSeen: 1, lastSeen: 2, timesSeen: 1 }], newId);
ok(!r.push.length && !r.changedLocal, "identical details do nothing");
console.log(`ipmerge: ${n} checks passed`);
