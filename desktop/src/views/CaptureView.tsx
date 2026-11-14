import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type Adapter, type Country, type PacketRow } from "@/lib/api";
import { matchesAny, type Filter } from "@/lib/filters";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import {
  base64ToBytes,
  bytesToBase64,
  copyText,
  download,
  downloadBlob,
  isLocalAddress,
  rowToTsv,
  tableToTsv,
  toCsv,
  toJson,
  toTxt,
} from "@/lib/export";
import { EmptyState } from "@/components/ui/EmptyState";
import { NetworkIcon } from "@/components/ui/icons";

const MAX_ROWS = 1000;
/** The window reads at most this much of a capture file. */
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_OPEN_ROWS = 5000;

function clock(t: number) {
  const d = new Date(t * 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

const endpoint = (ip: string, port: number | null) => (port === null ? ip : ip.includes(":") ? `[${ip}]:${port}` : `${ip}:${port}`);

interface Props {
  filters: Filter[];
  onToggle: (id: string) => void;
  onSeen: (rows: PacketRow[]) => void;
}

export function CaptureView({ filters, onToggle, onSeen }: Props) {
  const [adapters, setAdapters] = useState<Adapter[]>([]);
  const [adapter, setAdapter] = useState("");
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<PacketRow[]>([]);
  const [total, setTotal] = useState(0);
  const [fromFile, setFromFile] = useState<string | null>(null);
  const [replayRow, setReplayRow] = useState<PacketRow | null>(null);
  const [replayBusy, setReplayBusy] = useState(false);
  const [replayError, setReplayError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [geo, setGeo] = useState<Record<string, Country>>({});
  const asked = useRef(new Set<string>());
  const tableEnd = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const anyOn = filters.some((f) => f.enabled);
  const shown = useMemo(() => rows.filter((r) => matchesAny(filters, r)), [rows, filters]);

  const countryOf = useCallback(
    (r: PacketRow) => {
      const hit = geo[isLocalAddress(r.src) ? r.dst : r.src];
      return hit ? hit.code : "";
    },
    [geo]
  );

  const askGeo = useCallback((list: PacketRow[]) => {
    const fresh = new Set<string>();
    for (const r of list) {
      const far = isLocalAddress(r.src) ? r.dst : r.src;
      if (!isLocalAddress(far) && !asked.current.has(far)) fresh.add(far);
    }
    if (fresh.size === 0) return;
    fresh.forEach((ip) => asked.current.add(ip));
    api.geoLookup([...fresh]).then((found) => setGeo((g) => ({ ...g, ...found }))).catch(() => {});
  }, []);

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
        if (poll.rows.length > 0) {
          onSeen(poll.rows);
          askGeo(poll.rows);
          setTotal((n) => n + poll.rows.length);
          setRows((prev) => {
            const next = prev.concat(poll.rows);
            return next.length > MAX_ROWS ? next.slice(next.length - MAX_ROWS) : next;
          });
        }
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
  }, [running, onSeen, askGeo]);

  // Follow new packets only while the user is at the bottom, so they can scroll back and read.
  const stick = useRef(true);
  useEffect(() => {
    const scroller = tableEnd.current?.parentElement;
    if (!scroller) return;
    const onScroll = () => {
      stick.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 60;
    };
    scroller.addEventListener("scroll", onScroll);
    return () => scroller.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (stick.current) tableEnd.current?.scrollIntoView({ block: "end" });
  }, [shown]);

  const start = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await api.startCapture(adapter);
      setRows([]);
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
  }, [adapter]);

  const stop = useCallback(async () => {
    setBusy(true);
    try {
      await api.stopCapture();
      setRunning(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, []);

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
      setTotal(res.rows.length);
      setFromFile(file.name);
      onSeen(res.rows);
      askGeo(res.rows);
      const cut = res.totalRecords > res.rows.length ? ` Showing the first ${MAX_OPEN_ROWS.toLocaleString()} of ${res.totalRecords.toLocaleString()}.` : "";
      const big = file.size > MAX_FILE_BYTES ? " Only the first 32 MB of the file was read." : "";
      setNotice(`Opened ${file.name}: ${res.rows.length.toLocaleString()} packets.${cut}${big}`);
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
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
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
          {!fromFile && total > MAX_ROWS && ` (keeping last ${MAX_ROWS.toLocaleString()})`}
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
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent
              ${f.enabled ? "border-accent bg-surface text-text" : "border-border text-muted hover:text-text"}`}
          >
            {f.enabled ? "✓ " : ""}{f.name}
          </button>
        ))}
        {!anyOn && filters.length > 0 && <span className="text-xs text-muted">None switched on, so everything shows.</span>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
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
        <span role="status" className="text-sm text-muted">{notice}</span>
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-danger px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <Card className="min-h-0 flex-1 overflow-auto p-0">
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
          <table className="w-full min-w-[44rem] text-left font-mono text-xs">
            <thead className="sticky top-0 bg-surface text-muted">
              <tr className="border-b border-border">
                <th scope="col" className="px-3 py-2 font-semibold">Time</th>
                <th scope="col" className="px-3 py-2 font-semibold">Source</th>
                <th scope="col" className="px-3 py-2 font-semibold">Destination</th>
                <th scope="col" className="px-3 py-2 font-semibold">Country</th>
                <th scope="col" className="px-3 py-2 font-semibold">Protocol</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Bytes</th>
                <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const local = isLocalAddress(r.src) && isLocalAddress(r.dst);
                const replayable = local && !fromFile;
                const cellCopy = (text: string, what: string) => ({
                  title: "Double-click to copy",
                  onDoubleClick: () => copy(text, what),
                });
                return (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-1.5 text-muted" {...cellCopy(clock(r.time), "the time")}>{clock(r.time)}</td>
                    <td className="px-3 py-1.5 text-text" {...cellCopy(endpoint(r.src, r.srcPort), "the source")}>{endpoint(r.src, r.srcPort)}</td>
                    <td className="px-3 py-1.5 text-text" {...cellCopy(endpoint(r.dst, r.dstPort), "the destination")}>{endpoint(r.dst, r.dstPort)}</td>
                    <td className="px-3 py-1.5 text-muted">
                      {(() => {
                        const hit = geo[isLocalAddress(r.src) ? r.dst : r.src];
                        return hit ? <span title={hit.name}>{hit.code}</span> : "";
                      })()}
                    </td>
                    <td className="px-3 py-1.5 text-muted">{r.protocol}</td>
                    <td className="px-3 py-1.5 text-right text-muted" {...cellCopy(String(r.length), "the size")}>{r.length}</td>
                    <td className="whitespace-nowrap px-3 py-1 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Copy row: ${r.src} to ${r.dst}`}
                        onClick={() => copy(rowToTsv(r, countryOf(r)), "the row")}
                      >
                        Copy
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!replayable}
                        title={
                          fromFile
                            ? "Packets opened from a file cannot be sent again."
                            : local
                            ? undefined
                            : "Replay works only for packets between two devices on your own network."
                        }
                        aria-label={`Replay packet from ${r.src} to ${r.dst}`}
                        onClick={() => { setReplayRow(r); setReplayError(null); }}
                      >
                        Replay
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div ref={tableEnd} />
      </Card>

      <Modal open={replayRow !== null} onClose={() => !replayBusy && setReplayRow(null)} title="Send this packet again?">
        {replayRow && (
          <div className="flex flex-col gap-3 text-sm">
            <p className="text-muted">
              This sends one {replayRow.protocol} packet ({replayRow.length} bytes) from {endpoint(replayRow.src, replayRow.srcPort)} to{" "}
              {endpoint(replayRow.dst, replayRow.dstPort)} on your network, once. Use it only on your own devices.
            </p>
            {replayError && <p role="alert" className="text-danger">{replayError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setReplayRow(null)} disabled={replayBusy}>Cancel</Button>
              <Button
                loading={replayBusy}
                onClick={async () => {
                  setReplayBusy(true);
                  setReplayError(null);
                  try {
                    setNotice(await api.replayPacket(replayRow.id));
                    setReplayRow(null);
                  } catch (e) {
                    setReplayError(String(e));
                  } finally {
                    setReplayBusy(false);
                  }
                }}
              >
                Send once
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
