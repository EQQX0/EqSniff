import { api } from "@/lib/api";
import { FILTERS_SYNCED } from "@/lib/cloud";
import { fromStored, newId } from "@/lib/filters";
import { isEntryArray, loadEntries, newEntryId, saveEntries } from "@/lib/ipstore";

const KIND = "eqnetwork-backup";

export interface BackupSummary {
  ips: number;
  filters: number;
  tunnels: number;
}

/** Everything the account would sync, as one JSON text: IP Storage, filters and VPN tunnels (with their private keys). */
export async function buildBackup(): Promise<{ text: string; summary: BackupSummary }> {
  const [ips, rawFilters, tunnelList] = await Promise.all([loadEntries(), api.getFilters(), api.vpnSyncList()]);
  const filters = fromStored(rawFilters);
  const tunnels: { name: string; text: string }[] = [];
  for (const t of tunnelList) tunnels.push({ name: t.name, text: await api.vpnSyncRead(t.name) });
  const doc = { kind: KIND, version: 1, exportedAt: new Date().toISOString(), ips, filters, tunnels };
  return { text: JSON.stringify(doc, null, 2), summary: { ips: ips.length, filters: filters.length, tunnels: tunnels.length } };
}

/** Adds what the file holds. Existing addresses, filters (by id or name) and tunnel names are kept as they are. */
export async function restoreBackup(text: string): Promise<{ added: BackupSummary; skipped: number; notes: string[] }> {
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("That file is not an EqNetwork backup.");
  }
  if (doc?.kind !== KIND) throw new Error("That file is not an EqNetwork backup.");
  const added: BackupSummary = { ips: 0, filters: 0, tunnels: 0 };
  let skipped = 0;
  const notes: string[] = [];

  if (isEntryArray(doc.ips)) {
    const have = await loadEntries();
    const seen = new Set(have.map((e) => e.address));
    const fresh = doc.ips
      .filter((e) => e.address && !seen.has(e.address))
      .map((e) => ({ id: newEntryId(), address: e.address, note: String(e.note ?? "").slice(0, 500), createdAt: Number(e.createdAt) || Date.now() }));
    skipped += doc.ips.length - fresh.length;
    if (fresh.length) await saveEntries([...have, ...fresh], have);
    added.ips = fresh.length;
  }

  if (Array.isArray(doc.filters)) {
    const have = fromStored(await api.getFilters());
    const names = new Set(have.map((f) => f.name));
    const fresh = fromStored(doc.filters).filter((f) => !names.has(f.name)).map((f) => ({ ...f, id: newId(), enabled: false }));
    skipped += doc.filters.length - fresh.length;
    if (fresh.length) {
      await api.saveFilters([...have, ...fresh]);
      window.dispatchEvent(new Event(FILTERS_SYNCED));
    }
    added.filters = fresh.length;
  }

  if (Array.isArray(doc.tunnels)) {
    const names = new Set((await api.vpnSyncList()).map((t) => t.name));
    for (const t of doc.tunnels as { name?: unknown; text?: unknown }[]) {
      if (typeof t?.name !== "string" || typeof t.text !== "string") continue;
      if (names.has(t.name)) {
        skipped++;
        continue;
      }
      try {
        await api.vpnSyncWrite(t.name, t.text);
        names.add(t.name);
        added.tunnels++;
      } catch (e) {
        notes.push(`Tunnel ${t.name} was not restored: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  return { added, skipped, notes };
}
