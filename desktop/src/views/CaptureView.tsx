import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type Adapter, type PacketRow } from "@/lib/api";
import { matches, type Filter } from "@/lib/filters";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { download, isLocalAddress, toCsv, toJson, toTxt } from "@/lib/export";
import { EmptyState } from "@/components/ui/EmptyState";
import { NetworkIcon } from "@/components/ui/icons";

const MAX_ROWS = 1000;

function clock(t: number) {
  const d = new Date(t * 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

const endpoint = (ip: string, port: number | null) => (port === null ? ip : ip.includes(":") ? `[${ip}]:${port}` : `${ip}:${port}`);

interface Props {
  filters: Filter[];
  activeId: string;
  onActiveId: (id: string) => void;
  onSeen: (rows: PacketRow[]) => void;
}

export function CaptureView({ filters, activeId, onActiveId, onSeen }: Props) {
  const [adapters, setAdapters] = useState<Adapter[]>([]);
  const [adapter, setAdapter] = useState("");
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<PacketRow[]>([]);
  const [total, setTotal] = useState(0);
  const [replayRow, setReplayRow] = useState<PacketRow | null>(null);
  const [replayBusy, setReplayBusy] = useState(false);
  const [replayError, setReplayError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const tableEnd = useRef<HTMLDivElement>(null);
  const active = filters.find((f) => f.id === activeId);
  const shown = useMemo(() => (active ? rows.filter((r) => matches(active, r)) : rows), [rows, active]);

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
  }, [running, onSeen]);

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

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-text">Capture</h1>
        <p className="mt-1 text-sm text-muted">Watch traffic on one of your network adapters.</p>
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
        <label className="flex w-56 flex-col gap-1.5 text-sm">
          <span className="font-medium text-text">Filter</span>
          <select
            value={active ? activeId : ""}
            onChange={(e) => onActiveId(e.target.value)}
            className="h-10 min-w-0 rounded-md border border-border-input bg-surface px-3 text-sm text-text
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="">Show everything</option>
            {filters.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
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
        <p className="ml-auto text-sm text-muted" aria-live="polite">
          {running ? "Capturing" : "Stopped"} · {total.toLocaleString()} packets
          {active && ` · ${shown.length.toLocaleString()} match`}
          {total > MAX_ROWS && ` (keeping last ${MAX_ROWS.toLocaleString()})`}
        </p>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">Export {active ? "matching" : "shown"} packets:</span>
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
              setNotice(`Exported ${shown.length.toLocaleString()} packets as ${kind}.`);
            }}
          >
            {kind}
          </Button>
        ))}
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
            title={rows.length > 0 ? "Nothing matches this filter" : running ? "Waiting for traffic" : "No capture yet"}
            body={
              rows.length > 0
                ? "Pick “Show everything” in the Filter box to see all captured packets."
                : running
                ? "Packets appear here as they cross the adapter."
                : "Pick an adapter and press Start capture. Nothing leaves your computer."
            }
          />
        ) : (
          <table className="w-full min-w-[40rem] text-left font-mono text-xs">
            <thead className="sticky top-0 bg-surface text-muted">
              <tr className="border-b border-border">
                <th scope="col" className="px-3 py-2 font-semibold">Time</th>
                <th scope="col" className="px-3 py-2 font-semibold">Source</th>
                <th scope="col" className="px-3 py-2 font-semibold">Destination</th>
                <th scope="col" className="px-3 py-2 font-semibold">Protocol</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Bytes</th>
                <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-1.5 text-muted">{clock(r.time)}</td>
                  <td className="px-3 py-1.5 text-text">{endpoint(r.src, r.srcPort)}</td>
                  <td className="px-3 py-1.5 text-text">{endpoint(r.dst, r.dstPort)}</td>
                  <td className="px-3 py-1.5 text-muted">{r.protocol}</td>
                  <td className="px-3 py-1.5 text-right text-muted">{r.length}</td>
                  <td className="px-3 py-1 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!(isLocalAddress(r.src) && isLocalAddress(r.dst))}
                      title={isLocalAddress(r.src) && isLocalAddress(r.dst) ? undefined : "Replay works only for packets between two devices on your own network."}
                      aria-label={`Replay packet from ${r.src} to ${r.dst}`}
                      onClick={() => { setReplayRow(r); setReplayError(null); }}
                    >
                      Replay
                    </Button>
                  </td>
                </tr>
              ))}
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
