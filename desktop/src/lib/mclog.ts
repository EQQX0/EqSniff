/** Which player used which address, read from a Minecraft server log. */
export interface Seen {
  address: string;
  names: string[];
}

// Java servers log: Steve[/203.0.113.9:51234] logged in with entity id ...
// The same "Name[/address:port]" form also appears on "lost connection" and "left the game" lines.
const LINE = /([A-Za-z0-9_.]{1,32})\[\/([^\]\s]+?):\d{1,5}\]/g;

const PRIVATE = /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fe80:|fc|fd)/i;

/** Pulls every (player, address) pair out of log text. Local addresses are skipped, they say nothing about where a player is. */
export function parseMinecraftLog(text: string): Seen[] {
  const by = new Map<string, Set<string>>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes("[/")) continue;
    LINE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = LINE.exec(line))) {
      const name = m[1];
      const address = m[2];
      if (PRIVATE.test(address)) continue;
      if (!by.has(address)) by.set(address, new Set());
      by.get(address)!.add(name);
    }
  }
  return [...by].map(([address, names]) => ({ address, names: [...names] }));
}

/** The label to store: names joined, kept inside the label length limit. */
export function labelFor(names: string[], max = 500): string {
  let out = "";
  for (const n of names) {
    const next = out ? `${out} / ${n}` : n;
    if (next.length > max) break;
    out = next;
  }
  return out;
}
