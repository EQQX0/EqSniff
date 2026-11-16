import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type Adapter, type Country, type IpDetails, type PacketRow } from "@/lib/api";
import { matchesAny, type Filter, type Lookup } from "@/lib/filters";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  base64ToBytes,
  bytesToBase64,
  copyText,
  download,
  downloadBlob,
  isLocalAddress,
  tableToTsv,
  toCsv,
  toJson,
  toTxt,
} from "@/lib/export";
import { EmptyState } from "@/components/ui/EmptyState";
import { NetworkIcon } from "@/components/ui/icons";
import { Switch } from "@/components/ui/Switch";
import { NAME_MAX, loadEntries, newEntryId, onChange as onIpStoreChange, saveEntries, setName } from "@/lib/ipstore";
import { labelFor, parseMinecraftLog } from "@/lib/mclog";
import { ACTIVE_EACH_WAY, IpList, absorb, listBook, type IpBook } from "@/views/CaptureIps";
import "flag-icons/css/flag-icons.min.css";

type ColumnId = "name" | "srcIp" | "srcPort" | "dstIp" | "dstPort" | "country" | "protocol" | "bytes" | "time";
const COLUMNS: { id: ColumnId; label: string; right?: boolean }[] = [
  { id: "name", label: "Label" },
  { id: "srcIp", label: "Source IP" },
  { id: "srcPort", label: "Source port" },
  { id: "dstIp", label: "Destination IP" },
  { id: "dstPort", label: "Destination port" },
  { id: "country", label: "Country" },
  { id: "protocol", label: "Protocol" },
  { id: "bytes", label: "Bytes", right: true },
  { id: "time", label: "Time", right: true },
];
const COLUMNS_KEY = "capture-columns-v2";
/** Relative column widths. The header bar and the list use the same ones so they line up. */
const COL_WIDTH: Record<ColumnId, number> = { name: 14, srcIp: 13, srcPort: 10, dstIp: 13, dstPort: 12, country: 14, protocol: 8, bytes: 7, time: 10 };

function loadColumns(): ColumnId[] {
  try {
    const raw = JSON.parse(localStorage.getItem(COLUMNS_KEY) ?? "null");
    if (Array.isArray(raw)) {
      const ok = COLUMNS.map((c) => c.id).filter((id) => raw.includes(id));
      if (ok.length > 0) return ok;
    }
  } catch {
    /* unreadable: use the default */
  }
  return COLUMNS.map((c) => c.id);
}

/** Flag drawn from files shipped inside the app, so it also works offline and on Windows, which has no flag emoji. */
export function Flag({ code }: { code: string }) {
  if (!/^[A-Za-z]{2}$/.test(code)) return <span className="inline-block h-3.5 w-5 rounded-sm bg-white/10" aria-hidden="true" />;
  return <span className={`fi fi-${code.toLowerCase()} inline-block h-3.5 w-5 rounded-sm bg-cover shadow-[0_0_0_1px_rgba(255,255,255,.18)]`} aria-hidden="true" />;
}

/** The window reads at most this much of a capture file. */
const MAX_FILE_BYTES = 32 * 1024 * 1024;
/** The app side looks up at most this many addresses per request. */
const GEO_CHUNK = 500;
/** Remembered lookups are dropped past this, so a very long capture cannot grow without bound. */
const GEO_REMEMBER = 20000;

function clock(t: number) {
  const d = new Date(t * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Sort key for an address: IPv4 compares as numbers, anything else as text after the IPv4 ones. */
function ipKey(ip: string): string {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  return v4 ? "0" + v4.slice(1).map((n) => n.padStart(3, "0")).join(".") : "1" + ip.toLowerCase();
}

type SortState = { key: ColumnId; dir: "asc" | "desc" } | null;

interface Props {
  filters: Filter[];
  /** Filters an admin published for every signed-in account. They match packets the same as your own, but
   * only the Filters page lets you turn one off for yourself; they are left out of the quick toggle row here. */
  globalFilters?: Filter[];
  onToggle: (id: string) => void;
  /** Adds or switches on a Hide filter for an ISP. */
  onHideIsp: (isp: string) => Promise<void>;
  onSeen: (rows: PacketRow[]) => void;
}

export function CaptureView({ filters, globalFilters = [], onToggle, onHideIsp, onSeen }: Props) {
  /** Your own filters plus whatever global filters are in effect. Used for matching only; the quick toggle
   * row below still lists your own filters alone. */
  const effectiveFilters = useMemo(() => (globalFilters.length ? [...filters, ...globalFilters] : filters), [filters, globalFilters]);
  const [adapters, setAdapters] = useState<Adapter[]>([]);
  const [adapter, setAdapter] = useState("");
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<PacketRow[]>([]);
  const [total, setTotal] = useState(0);
  const [fromFile, setFromFile] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<number | null>(null); // the row whose label is being typed
  const [sort, setSort] = useState<SortState>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [geo, setGeo] = useState<Record<string, Country>>({});
  const [cols, setCols] = useState<ColumnId[]>(loadColumns);
  const [colsOpen, setColsOpen] = useState(false);
  const [tab, setTab] = useState<"all" | "filtered">("filtered");
  // The IP list is the main view. The packet table stays hidden until you ask for it.
  const [ipsOpen, setIpsOpen] = useState(true);
  const [details, setDetails] = useState<Record<string, IpDetails>>({});
  const lookupBusy = useRef(new Set<string>());
  const [clockNow, setClockNow] = useState(() => Date.now() / 1000);
  const ipBook = useRef<IpBook>(new Map());
  useEffect(() => {
    // A live capture keeps counting after Stop, so players who left turn red. A saved file is judged at its newest packet.
    if (fromFile) return;
    const t = setInterval(() => setClockNow(Date.now() / 1000), 1000);
    return () => clearInterval(t);
  }, [fromFile]);
  const [ipVersion, setIpVersion] = useState(0);
  const filtersNow = useRef(effectiveFilters);
  filtersNow.current = effectiveFilters;
  // Country and ISP filters ask what is known about an address so far.
  const lookup = useMemo<Lookup>(() => ({ country: (ip) => geo[ip]?.code, isp: (ip) => details[ip]?.isp }), [geo, details]);
  const lookupNow = useRef(lookup);
  lookupNow.current = lookup;
  const colsBox = useRef<HTMLDivElement>(null);
  const show = (id: ColumnId) => cols.includes(id);
  const visibleWidth = COLUMNS.filter((c) => cols.includes(c.id)).reduce((n, c) => n + COL_WIDTH[c.id], 0) || 1;
  const asked = useRef(new Set<string>());
  const fileInput = useRef<HTMLInputElement>(null);
  const anyOn = effectiveFilters.some((f) => f.enabled);
  /** The address on the other end of a packet, which is the one a label and a country belong to. */
  const farOf = (r: PacketRow) => (isLocalAddress(r.src) ? r.dst : r.src);

  const countryOf = useCallback(
    (r: PacketRow) => {
      const hit = geo[isLocalAddress(r.src) ? r.dst : r.src];
      return hit ? hit.code : "";
    },
    [geo]
  );

  /** What is left after the filters. The All Traffic tab ignores them, so hidden addresses still show up there. */
  const filteredRows = useMemo(() => {
    const kept = rows.filter((r) => matchesAny(effectiveFilters, r, lookup));
    // Drop packets from addresses that are not holding a real conversation: local ones, and ones that only probe or ping.
    const book = ipBook.current;
    return kept.filter((r) => {
      const far = farOf(r);
      if (isLocalAddress(far)) return false;
      const e = book.get(far);
      return !!e && (e.inbound >= ACTIVE_EACH_WAY || e.outbound >= ACTIVE_EACH_WAY);
    });
  }, [rows, effectiveFilters, ipVersion, lookup]);
  const portNum = null;
  const allIps = useMemo(() => listBook(ipBook.current, false, portNum), [ipVersion, portNum]);
  const filteredIps = useMemo(() => listBook(ipBook.current, true, portNum), [ipVersion, portNum]);

  const shown = useMemo(() => {
    const kept = tab === "all" ? rows : filteredRows;
    if (!sort) return kept;
    const far = (r: PacketRow) => (isLocalAddress(r.src) ? r.dst : r.src);
    const value = (r: PacketRow): string | number => {
      switch (sort.key) {
        case "name": return (names[far(r)] ?? "").toLowerCase();
        case "srcIp": return ipKey(r.src);
        case "dstIp": return ipKey(r.dst);
        case "srcPort": return r.srcPort ?? -1;
        case "dstPort": return r.dstPort ?? -1;
        case "country": return (geo[far(r)]?.name ?? "").toLowerCase();
        case "protocol": return r.protocol;
        case "bytes": return r.length;
        default: return r.time;
      }
    };
    const sign = sort.dir === "asc" ? 1 : -1;
    // Empty names and countries always go last, so the useful rows stay on top.
    return [...kept].sort((a, b) => {
      const x = value(a), y = value(b);
      if (x === "" && y !== "") return 1;
      if (y === "" && x !== "") return -1;
      if (x === y) return a.id - b.id;
      return (x < y ? -1 : 1) * sign;
    });
  }, [rows, filteredRows, tab, sort, names, geo]);

  function clickHeader(key: ColumnId) {
    setSort((s) => (s?.key !== key ? { key, dir: "asc" } : s.dir === "asc" ? { key, dir: "desc" } : null));
  }

  useEffect(() => {
    const load = () =>
      loadEntries()
        .then((list) => setNames(Object.fromEntries(list.filter((e) => e.note).map((e) => [e.address, e.note]))))
        .catch(() => {});
    load();
    return onIpStoreChange(load); // keeps names in step with the IP Storage page
  }, []);

  async function saveName(address: string, value: string) {
    setEditing(null);
    const clean = value.trim().slice(0, NAME_MAX);
    if (clean === (names[address] ?? "")) return;
    setNames((n) => {
      const next = { ...n };
      if (clean) next[address] = clean;
      else delete next[address];
      return next;
    });
    try {
      await setName(address, clean);
      setNotice(clean ? `Saved the label for ${address} in IP Storage.` : `Removed the label for ${address} from IP Storage.`);
    } catch (e) {
      setError(String(e));
    }
  }

  // City and ISP are always shown. They come from databases on this computer, so a batch of new addresses is looked up
  // within a fraction of a second. The timer is kept in a ref: one that restarted on every packet update would never fire.
  const lookupTimer = useRef<number | null>(null);
  const lookupLast = useRef(0);
  const lookupRunning = useRef(false);
  const ipsNow = useRef<string[]>([]);
  const detailsNow = useRef(details);
  ipsNow.current = [...allIps, ...filteredIps].map((i) => i.address);
  detailsNow.current = details;

  useEffect(() => {
    if (lookupTimer.current !== null || lookupRunning.current) return;
    const pending = () => [...new Set(ipsNow.current)].filter((a) => !detailsNow.current[a] && !lookupBusy.current.has(a));
    if (pending().length === 0) return;
    lookupTimer.current = window.setTimeout(async () => {
      lookupTimer.current = null;
      const todo = pending().slice(0, 100);
      if (todo.length === 0) return;
      lookupLast.current = Date.now();
      lookupRunning.current = true;
      todo.forEach((a) => lookupBusy.current.add(a));
      try {
        const got = await api.ipDetails(todo);
        setDetails((d) => ({ ...d, ...Object.fromEntries(got.map((g) => [g.address, g])) }));
      } catch {
        // try these addresses again in 30 seconds
        window.setTimeout(() => {
          todo.forEach((a) => lookupBusy.current.delete(a));
          setIpVersion((v) => v + 1);
        }, 30000);
      } finally {
        lookupRunning.current = false;
        setIpVersion((v) => v + 1); // wakes the effect for addresses that arrived meanwhile
      }
    }, Math.max(80, 400 - (Date.now() - lookupLast.current)));
  });

  /** Forgets one address and its packets. It returns if it sends more. */
  function deleteRow(address: string) {
    ipBook.current.delete(address);
    setIpVersion((v) => v + 1);
    setRows((r) => r.filter((x) => x.src !== address && x.dst !== address));
  }

  /** Forgets the addresses and packets seen so far. Labels saved in IP Storage stay. */
  function clearCaptured() {
    ipBook.current = new Map();
    setIpVersion((v) => v + 1);
    setRows([]);
    setTotal(0);
    setNotice("Cleared the captured addresses and packets. Saved labels were kept.");
  }

  /** Forgets only the packet table shown here. The IP list keeps its addresses. */
  function clearPackets() {
    setRows([]);
    setTotal(0);
    setNotice("Cleared the traffic table. The IP list was kept.");
  }

  const askGeo = useCallback((list: PacketRow[]) => {
    const fresh = new Set<string>();
    for (const r of list) {
      const far = isLocalAddress(r.src) ? r.dst : r.src;
      if (!isLocalAddress(far) && !asked.current.has(far)) fresh.add(far);
    }
    if (fresh.size === 0) return;
    if (asked.current.size > GEO_REMEMBER) {
      asked.current.clear();
      setGeo({});
    }
    const all = [...fresh];
    for (let i = 0; i < all.length; i += GEO_CHUNK) {
      const chunk = all.slice(i, i + GEO_CHUNK); // only addresses really sent are marked as asked
      chunk.forEach((ip) => asked.current.add(ip));
      api
        .geoLookup(chunk)
        .then((found) => setGeo((g) => ({ ...g, ...found })))
        .catch(() => chunk.forEach((ip) => asked.current.delete(ip))); // try again later
    }
  }, []);

  function toggleColumn(id: ColumnId) {
    const next = COLUMNS.map((c) => c.id).filter((c) => (c === id ? !cols.includes(c) : cols.includes(c)));
    if (next.length === 0) return; // keep at least one column
    setCols(next);
    try {
      localStorage.setItem(COLUMNS_KEY, JSON.stringify(next));
    } catch {
      /* not remembered; still works for this run */
    }
  }

  useEffect(() => {
    if (!colsOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!colsBox.current?.contains(e.target as Node)) setColsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setColsOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [colsOpen]);

  const resetGeo = useCallback(() => {
    asked.current.clear();
    setGeo({});
  }, []);

  /** Adds packets from the app side to the table. */
  const ingest = useCallback(
    (fresh: PacketRow[]) => {
      if (fresh.length === 0) return;
      onSeen(fresh);
      askGeo(fresh);
      absorb(ipBook.current, fresh, farOf, (r) => matchesAny(filtersNow.current, r, lookupNow.current));
      setIpVersion((v) => v + 1);
      setTotal((n) => n + fresh.length);
      setRows((prev) => prev.concat(fresh));
    },
    [onSeen, askGeo]
  );

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.listAdapters(), api.getSettings()])
      .then(([list, settings]) => {
        if (cancelled) return;
        setAdapters(list);
        const remembered = list.find((a) => a.name === settings.lastAdapter);
        setAdapter(remembered?.name ?? list[0]?.name ?? "");
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  // The app side collects packets; this asks for them a few times a second while capturing.
  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const poll = await api.pollCapture();
        if (cancelled) return;
        ingest(poll.rows);
        if (!poll.running) {
          setRunning(false);
          if (poll.error) setError(poll.error);
        }
      } catch (e) {
        if (!cancelled) {
          setRunning(false);
          setError(String(e));
        }
      }
    };
    const id = window.setInterval(tick, 150);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [running, ingest]);

  const start = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await api.startCapture(adapter, "");
      // The packet table starts empty (packet numbers restart with each capture), but the IP list keeps what it
      // has seen. Only the Clear button, or leaving a saved file, empties it.
      setRows([]);
      if (fromFile) {
        ipBook.current = new Map();
        resetGeo();
      }
      setIpVersion((v) => v + 1);
      setTotal(0);
      setFromFile(null);
      setNotice(null);
      setRunning(true);
      const settings = await api.getSettings();
      await api.setSettings({ ...settings, lastAdapter: adapter });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [adapter, resetGeo, fromFile]);

  const stop = useCallback(async () => {
    setBusy(true);
    try {
      const last = await api.stopCapture(); // the final moments of traffic come back with the stop
      ingest(last);
      setRunning(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [ingest]);

  async function copy(text: string, what: string) {
    setNotice((await copyText(text)) ? `Copied ${what}.` : "Copying was blocked by Windows. Select the text and press Ctrl+C instead.");
  }

  async function exportPcap() {
    setError(null);
    try {
      const b64 = await api.exportPcap(shown.map((r) => r.id));
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      downloadBlob(`capture-${stamp}.pcap`, new Blob([base64ToBytes(b64) as BlobPart], { type: "application/vnd.tcpdump.pcap" }));
      setNotice(`Exported ${shown.length.toLocaleString()} packets as PCAP. Windows saved the file in your Downloads folder.`);
    } catch (e) {
      setError(String(e));
    }
  }

  async function openPcap(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const part = file.size > MAX_FILE_BYTES ? file.slice(0, MAX_FILE_BYTES) : file;
      const res = await api.importPcap(bytesToBase64(new Uint8Array(await part.arrayBuffer())));
      setRows(res.rows);
      ipBook.current = new Map();
      absorb(ipBook.current, res.rows, farOf, (r) => matchesAny(filtersNow.current, r, lookupNow.current));
      setIpVersion((v) => v + 1);
      setTotal(res.rows.length);
      setFromFile(file.name);
      resetGeo();
      onSeen(res.rows);
      askGeo(res.rows);
      // Only say "first N of M" when records were really left unread. Records that are not IP
      // (ARP and the like) are counted separately.
      const cut = res.totalRecords > res.readRecords ? ` Showing the first ${res.readRecords.toLocaleString()} of ${res.totalRecords.toLocaleString()}.` : "";
      const other = res.readRecords > res.rows.length ? ` ${(res.readRecords - res.rows.length).toLocaleString()} non-IP packets were skipped.` : "";
      const big = file.size > MAX_FILE_BYTES ? " Only the first 32 MB of the file was read." : "";
      setNotice(`Opened ${file.name}: ${res.rows.length.toLocaleString()} packets.${cut}${other}${big}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    if (fileInput.current) fileInput.current.value = "";
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-text">Capture</h1>
        <p className="mt-1 text-sm text-muted">Watch traffic on one of your network adapters, or open a saved capture file.</p>
      </div>

      <Card className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm">
          <span className="font-medium text-text">Network adapter</span>
          <select
            value={adapter}
            disabled={running || adapters.length === 0}
            onChange={(e) => setAdapter(e.target.value)}
            className="h-10 min-w-0 rounded-md border border-border-input bg-surface px-3 text-sm text-text
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft disabled:opacity-50"
          >
            {adapters.length === 0 && <option value="">No adapters found</option>}
            {adapters.map((a) => (
              <option key={a.name} value={a.name}>
                {a.description}{a.connected ? " (connected)" : ""}
              </option>
            ))}
          </select>
        </label>
        {running ? (
          <Button variant="danger" onClick={stop} loading={busy}>
            Stop capture
          </Button>
        ) : (
          <Button onClick={start} loading={busy} disabled={!adapter}>
            Start capture
          </Button>
        )}
        <Button variant="secondary" disabled={running} onClick={() => fileInput.current?.click()}>
          Open capture file
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept=".pcap,.cap,application/vnd.tcpdump.pcap"
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose a .pcap capture file to open"
          onChange={(e) => openPcap(e.target.files?.[0])}
        />
        <p className="ml-auto text-sm text-muted" aria-live="polite">
          {fromFile ? `File: ${fromFile}` : running ? "Capturing" : "Stopped"} · {total.toLocaleString()} packets
          {anyOn && ` · ${shown.length.toLocaleString()} match`}
        </p>
      </Card>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
        <span className="text-sm text-muted">Filters:</span>
        {filters.length === 0 && <span className="text-sm text-muted">none yet. Add some on the Filters page.</span>}
        {filters.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={f.enabled}
            onClick={() => onToggle(f.id)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-fast
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft
              ${f.enabled ? "border-accent bg-surface text-text" : "border-border text-muted hover:text-text"}`}
          >
            {f.enabled ? "✓ " : ""}{f.mode === "hide" ? "Hide: " : ""}{f.name}
          </button>
        ))}
        {!anyOn && filters.length > 0 && <span className="text-xs text-muted">None switched on, so everything shows.</span>}
      </div>

      <div className={`flex flex-wrap items-center gap-2 ${ipsOpen ? "hidden" : ""}`}>
        <span className="text-sm text-muted">Export {anyOn ? "matching" : "shown"} packets:</span>
        {(["CSV", "JSON", "TXT"] as const).map((kind) => (
          <Button
            key={kind}
            size="sm"
            variant="secondary"
            disabled={shown.length === 0}
            onClick={() => {
              const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
              if (kind === "CSV") download(`capture-${stamp}.csv`, toCsv(shown), "text/csv");
              if (kind === "JSON") download(`capture-${stamp}.json`, toJson(shown), "application/json");
              if (kind === "TXT") download(`capture-${stamp}.txt`, toTxt(shown), "text/plain");
              setNotice(`Exported ${shown.length.toLocaleString()} packets as ${kind}. Windows saved the file in your Downloads folder.`);
            }}
          >
            {kind}
          </Button>
        ))}
        <Button size="sm" variant="secondary" disabled={shown.length === 0} onClick={exportPcap}>
          PCAP
        </Button>
        <span className="mx-1 text-sm text-muted">·</span>
        <Button
          size="sm"
          variant="secondary"
          disabled={shown.length === 0}
          onClick={() => copy(tableToTsv(shown, countryOf), `${shown.length.toLocaleString()} rows`)}
        >
          Copy table
        </Button>
        <span className="mx-1 text-sm text-muted">·</span>
        <Button
          size="sm"
          variant="secondary"
          disabled={rows.length === 0}
          title="Forget the traffic table so far. The IP list keeps its addresses."
          onClick={clearPackets}
        >
          Clear
        </Button>
        <span role="status" className="text-sm text-muted">{notice}</span>
        <div ref={colsBox} className="relative ml-auto">
          <Button size="sm" variant="secondary" aria-expanded={colsOpen} aria-haspopup="true" onClick={() => setColsOpen((o) => !o)}>
            Columns
          </Button>
          {colsOpen && (
            <div role="group" aria-label="Visible columns" className="glass-strong anim-pop absolute right-0 top-full z-30 mt-2 w-52 rounded-lg p-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Visible columns</p>
              <ul className="flex flex-col gap-1">
                {COLUMNS.map((c) => (
                  <li key={c.id}>
                    <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm text-text transition-colors duration-fast hover:bg-white/[0.07]">
                      <Switch label={`Show ${c.label}`} checked={show(c.id)} onChange={() => toggleColumn(c.id)} />
                      {c.label}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-danger px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Traffic view" className="flex items-center gap-2">
          {([
            ["all", ipsOpen ? "Unfiltered IPs" : "All Traffic", ipsOpen ? allIps.length : rows.length],
            ["filtered", ipsOpen ? "Filtered IPs" : "Filtered Traffic", ipsOpen ? filteredIps.length : filteredRows.length],
          ] as const).map(([id, text, n]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft ${
                tab === id ? "border-accent bg-accent text-white" : "border-border bg-white/[0.04] text-muted hover:bg-white/[0.08]"
              }`}
            >
              {text}
              <span className="rounded-md bg-black/30 px-1.5 py-0.5 text-xs">{n.toLocaleString()}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setIpsOpen((o) => !o)}
          title={ipsOpen ? "Show the captured packets as a table" : "Go back to the list of IPs"}
          className={`ml-2 inline-flex items-center gap-2 rounded-pill border px-3 py-1.5 text-sm transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft ${
            "border-border text-muted hover:bg-white/[0.06]"
          }`}
        >
          <NetworkIcon className="h-4 w-4" />
          {ipsOpen ? "Show traffic" : "Back to IPs"}
        </button>
        {ipsOpen && <span className="text-xs text-muted">Click a label to edit it. Labels are saved in IP Storage.</span>}
        {ipsOpen && notice && <span role="status" className="text-xs text-muted">{notice}</span>}
      </div>

      {ipsOpen ? (
        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden !p-0">
          <IpList
            items={tab === "all" ? allIps : filteredIps}
            names={names}
            geo={geo}
            hidden={tab === "all" ? new Set(allIps.map((i) => i.address).filter((a) => !filteredIps.some((f) => f.address === a))) : undefined}
            onSave={saveName}
            now={fromFile ? allIps.reduce((m, i) => Math.max(m, i.last), 0) : clockNow}
            onClear={clearCaptured}
            onDelete={deleteRow}
            onHideIsp={(isp) => void onHideIsp(isp).then(() => setNotice(`Added the filter “Hide ISP: ${isp}” and switched it on. Find it on the Filters page. The Filtered IPs tab no longer lists it.`)).catch((e) => setError(String(e)))}
            details={details}
          />
        </Card>
      ) : (
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden !p-0">
        <div className="flex min-h-0 flex-1 flex-col overflow-x-auto">
          <div className="flex h-full min-w-[64rem] flex-col">
            {/* The heading bar sits above the list and never scrolls with it. */}
            <div className="shrink-0 overflow-y-hidden border-b border-accent/40 bg-[linear-gradient(180deg,#4a1621,#33101a)] text-text shadow-[0_6px_14px_-8px_rgba(0,0,0,.6)] [scrollbar-gutter:stable]">
              <table className="w-full table-fixed text-left text-xs">
                <colgroup>
                  {COLUMNS.filter((c) => show(c.id)).map((c) => (
                    <col key={c.id} style={{ width: `${(COL_WIDTH[c.id] / visibleWidth) * 100}%` }} />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    {COLUMNS.filter((c) => show(c.id)).map((c) => {
                      const active = sort?.key === c.id;
                      return (
                        <th
                          key={c.id}
                          scope="col"
                          aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                          className={`whitespace-nowrap p-0 text-[11px] font-bold uppercase tracking-wider ${c.right ? "text-right" : ""}`}
                        >
                          <button
                            type="button"
                            onClick={() => clickHeader(c.id)}
                            title={active ? (sort.dir === "asc" ? "Sorted A to Z. Click for Z to A." : "Sorted Z to A. Click to clear.") : `Sort by ${c.label.toLowerCase()}`}
                            className={`flex w-full items-center gap-1.5 px-3 py-3 transition-colors duration-fast hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-soft ${
                              c.right ? "justify-end" : ""
                            } ${active ? "text-accent-soft" : ""}`}
                          >
                            {c.label}
                            <span aria-hidden="true" className={`text-[10px] ${active ? "opacity-100" : "opacity-30"}`}>
                              {active ? (sort.dir === "asc" ? "\u25B2" : "\u25BC") : "\u2195"}
                            </span>
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
              </table>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
              {shown.length === 0 ? (
          <EmptyState
            icon={<NetworkIcon className="h-6 w-6" />}
            title={rows.length > 0 ? "Nothing matches these filters" : running ? "Waiting for traffic" : "No capture yet"}
            body={
              rows.length > 0
                ? "Switch the filters off to see all captured packets."
                : running
                ? "Packets appear here as they cross the adapter."
                : "Pick an adapter and press Start capture, or open a .pcap file. Nothing leaves your computer."
            }
          />
              ) : (
                <table className="w-full table-fixed text-left text-xs">
                  <colgroup>
                  {COLUMNS.filter((c) => show(c.id)).map((c) => (
                    <col key={c.id} style={{ width: `${(COL_WIDTH[c.id] / visibleWidth) * 100}%` }} />
                  ))}
                </colgroup>
            <tbody>
              {shown.map((r) => {
                const far = farOf(r);
                const cellCopy = (text: string, what: string) => ({
                  title: "Double-click to copy",
                  onDoubleClick: () => copy(text, what),
                });
                const port = (n: number | null) => (n === null ? "" : String(n));
                return (
                  <tr key={r.id} className="border-b border-border transition-colors duration-fast last:border-0 hover:bg-white/[0.05]">
                    {show("name") && (
                      <td className="max-w-[14rem] px-3 py-1.5">
                        {editing === r.id ? (
                          <input
                            autoFocus
                            defaultValue={names[far] ?? ""}
                            maxLength={NAME_MAX}
                            aria-label={`Label for ${far}`}
                            placeholder="Type a label"
                            onFocus={(e) => e.currentTarget.select()}
                            onBlur={(e) => saveName(far, e.currentTarget.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveName(far, e.currentTarget.value);
                              if (e.key === "Escape") {
                                e.currentTarget.value = names[far] ?? "";
                                e.currentTarget.blur();
                              }
                            }}
                            className="h-7 w-full rounded-pill border border-accent-soft bg-white/[0.08] px-3 text-xs text-text focus-visible:outline-none"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => setEditing(r.id)}
                            title={`${names[far] ? "Change the label for" : "Add a label for"} ${far}. Saved in IP Storage.`}
                            aria-label={`${names[far] ? "Change the label for" : "Add a label for"} ${far}`}
                            className={`max-w-full truncate rounded-pill px-2 py-0.5 text-left transition-colors duration-fast hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft ${
                              names[far] ? "font-semibold text-text" : "text-muted/70"
                            }`}
                          >
                            {names[far] ?? "+ Add label"}
                          </button>
                        )}
                      </td>
                    )}
                    {show("srcIp") && <td className="px-3 py-1.5 font-mono text-text" {...cellCopy(r.src, "the source address")}>{r.src}</td>}
                    {show("srcPort") && <td className="px-3 py-1.5 font-mono text-muted" {...cellCopy(port(r.srcPort), "the source port")}>{port(r.srcPort)}</td>}
                    {show("dstIp") && <td className="px-3 py-1.5 font-mono text-text" {...cellCopy(r.dst, "the destination address")}>{r.dst}</td>}
                    {show("dstPort") && <td className="px-3 py-1.5 font-mono text-muted" {...cellCopy(port(r.dstPort), "the destination port")}>{port(r.dstPort)}</td>}
                    {show("country") && (
                      <td className="px-3 py-1.5 text-text">
                        {(() => {
                          const hit = geo[far];
                          return hit ? (
                            <span className="inline-flex items-center gap-2" title={hit.code}>
                              <Flag code={hit.code} />
                              <span>{hit.name}</span>
                            </span>
                          ) : (
                            ""
                          );
                        })()}
                      </td>
                    )}
                    {show("protocol") && <td className="px-3 py-1.5 font-mono text-muted">{r.protocol}</td>}
                    {show("bytes") && <td className="px-3 py-1.5 text-right font-mono text-muted" {...cellCopy(String(r.length), "the size")}>{r.length}</td>}
                    {show("time") && <td className="px-3 py-1.5 text-right font-mono text-muted" {...cellCopy(clock(r.time), "the time")}>{clock(r.time)}</td>}
                  </tr>
                );
              })}
            </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </Card>
      )}

    </div>
  );
}
