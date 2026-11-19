import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type UIEvent } from "react";
import type { PacketDetail } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import { copyText, base64ToBytes } from "@/lib/export";
import {
  BYTES_PER_ROW,
  asciiChar,
  byteHex,
  decodedMask,
  describeRange,
  fieldAt,
  formatOffset,
  inRange,
  rangeBetween,
  rowBytes,
  rowCount,
  rowOf,
  toHex,
  visibleRows,
  type ByteRange,
  type PacketField,
} from "@/lib/hex";

const ROW_H = 20; // px, fixed so only the rows in view are drawn
const clock = (t: number) => new Date(t * 1000).toLocaleTimeString([], { hour12: false }) + "." + String(Math.floor((t % 1) * 1000)).padStart(3, "0");

interface Props {
  detail: PacketDetail | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}

/**
 * Shows one saved packet byte by byte: offset, hex and ASCII, with the decoded fields beside it.
 * Clicking a field selects its bytes, and selecting bytes highlights the field they belong to.
 * The bytes are only read, never changed.
 */
export function HexInspector({ detail, loading, error, onClose }: Props) {
  const bytes = useMemo(() => (detail ? base64ToBytes(detail.data) : new Uint8Array(0)), [detail]);
  const fields: PacketField[] = detail?.fields ?? [];
  const decoded = useMemo(() => decodedMask(fields, bytes.length), [fields, bytes.length]);
  const total = rowCount(bytes.length);

  const [sel, setSel] = useState<ByteRange | null>(null);
  const anchor = useRef(0);
  const dragging = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(240);
  const fieldRefs = useRef(new Map<number, HTMLButtonElement>());

  // A new packet starts with nothing selected and the view at the top.
  useEffect(() => {
    setSel(null);
    anchor.current = 0;
    setScrollTop(0);
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [detail?.id]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    setViewH(el.clientHeight || 240);
    const ro = new ResizeObserver(() => setViewH(el.clientHeight || 240));
    ro.observe(el);
    return () => ro.disconnect();
  }, [detail?.id]);

  useEffect(() => {
    const up = () => (dragging.current = false);
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  const scrollToByte = useCallback((i: number) => {
    const el = scroller.current;
    if (!el) return;
    const top = rowOf(i) * ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H - el.clientHeight;
  }, []);

  // The field the selection starts in, if the selection sits inside it.
  const active = useMemo(() => {
    if (!sel) return null;
    const f = fieldAt(fields, sel.start);
    return f && sel.end <= f.start + f.len ? f : null;
  }, [sel, fields]);

  useEffect(() => {
    if (!active) return;
    fieldRefs.current.get(fields.indexOf(active))?.scrollIntoView({ block: "nearest" });
  }, [active, fields]);

  function selectField(f: PacketField) {
    setSel({ start: f.start, end: f.start + f.len });
    anchor.current = f.start;
    scrollToByte(f.start);
  }

  function byteIndex(e: MouseEvent): number | null {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
    return el ? Number(el.dataset.i) : null;
  }

  function onDown(e: MouseEvent) {
    if (e.button !== 0) return;
    const i = byteIndex(e);
    if (i === null) return;
    e.preventDefault(); // no native text selection; the byte selection is the selection
    scroller.current?.focus();
    if (e.shiftKey && sel) setSel(rangeBetween(anchor.current, i));
    else {
      anchor.current = i;
      setSel(rangeBetween(i, i));
    }
    dragging.current = true;
  }

  function onOver(e: MouseEvent) {
    if (!dragging.current) return;
    const i = byteIndex(e);
    if (i !== null) setSel(rangeBetween(anchor.current, i));
  }

  function onKey(e: KeyboardEvent) {
    if (bytes.length === 0) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      setSel({ start: 0, end: bytes.length });
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c" && sel) {
      e.preventDefault();
      void copySelected();
      return;
    }
    if (e.key === "Escape") {
      setSel(null);
      return;
    }
    const cur = sel ? (anchor.current === sel.start ? sel.end - 1 : sel.start) : 0;
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -BYTES_PER_ROW, ArrowDown: BYTES_PER_ROW, PageUp: -BYTES_PER_ROW * 8, PageDown: BYTES_PER_ROW * 8 };
    let next: number | null = null;
    if (e.key in step) next = cur + step[e.key];
    if (e.key === "Home") next = e.ctrlKey ? 0 : rowOf(cur) * BYTES_PER_ROW;
    if (e.key === "End") next = e.ctrlKey ? bytes.length - 1 : Math.min(bytes.length - 1, rowOf(cur) * BYTES_PER_ROW + BYTES_PER_ROW - 1);
    if (next === null) return;
    e.preventDefault();
    next = Math.max(0, Math.min(bytes.length - 1, next));
    if (e.shiftKey && sel) setSel(rangeBetween(anchor.current, next));
    else {
      anchor.current = next;
      setSel(rangeBetween(next, next));
    }
    scrollToByte(next);
  }

  async function copyAll() {
    const ok = await copyText(toHex(bytes));
    toast(ok ? `Copied the HEX of all ${bytes.length.toLocaleString()} bytes.` : "Copying was blocked by Windows. Select the text and press Ctrl+C instead.", { kind: ok ? undefined : "error" });
  }

  async function copySelected() {
    if (!sel) return;
    const ok = await copyText(toHex(bytes, sel));
    toast(ok ? `Copied ${(sel.end - sel.start).toLocaleString()} selected byte${sel.end - sel.start === 1 ? "" : "s"} as HEX.` : "Copying was blocked by Windows. Select the text and press Ctrl+C instead.", { kind: ok ? undefined : "error" });
  }

  const win = visibleRows(scrollTop, viewH, ROW_H, total);
  const rows: number[] = [];
  for (let r = win.first; r < win.last; r++) rows.push(r);

  return (
    <section aria-label="Packet inspector" className="flex h-80 shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-surface">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-3 py-2 text-xs">
        <h2 className="text-sm font-bold text-text">Packet inspector</h2>
        {detail && (
          <>
            <span className="text-muted">
              #{detail.id} · {clock(detail.time)} · {detail.linkName}
              {detail.ifaceName ? ` · ${detail.ifaceName}` : ""}
            </span>
            <span className="font-mono text-text" title="Length on the wire and how many of those bytes were captured">
              Length {detail.wireLen.toLocaleString()} bytes{detail.capLen !== detail.wireLen ? ` (captured ${detail.capLen.toLocaleString()})` : ""}
            </span>
            {detail.truncated && <span className="rounded-pill border border-border px-2 py-0.5 text-muted">cut short</span>}
            <span className="font-mono text-muted" aria-live="polite">
              Selection: {describeRange(sel)}
            </span>
          </>
        )}
        <span className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="secondary" disabled={!detail || bytes.length === 0} onClick={() => void copyAll()}>
            Copy HEX
          </Button>
          <Button size="sm" variant="secondary" disabled={!sel} onClick={() => void copySelected()}>
            Copy selected
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close the packet inspector">
            Close
          </Button>
        </span>
      </header>

      {error ? (
        <p role="alert" className="p-4 text-sm text-danger">{error}</p>
      ) : !detail ? (
        <p className="p-4 text-sm text-muted">{loading ? "Loading the packet…" : "Right-click a packet and choose Inspect bytes."}</p>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="flex w-72 shrink-0 flex-col border-r border-border">
            <p className="border-b border-border px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted">Decoded fields</p>
            <ul className="min-h-0 flex-1 overflow-y-auto py-1 text-xs">
              {fields.length === 0 && <li className="px-3 py-2 text-muted">This packet's link type has no decoded fields. The raw bytes are shown.</li>}
              {fields.map((f, k) => {
                const on = f === active;
                return (
                  <li key={k}>
                    <button
                      type="button"
                      ref={(el) => {
                        if (el) fieldRefs.current.set(k, el);
                        else fieldRefs.current.delete(k);
                      }}
                      aria-pressed={on}
                      onClick={() => selectField(f)}
                      title={`Bytes ${formatOffset(f.start)} to ${formatOffset(f.start + f.len - 1)}`}
                      className={`flex w-full items-baseline gap-2 py-1 pr-3 text-left transition-colors duration-fast hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-soft ${
                        f.depth === 0 ? "pl-3 font-bold text-text" : "pl-6 text-text"
                      } ${on ? "bg-accent-soft/25" : ""}`}
                    >
                      <span className="shrink-0">{f.name}</span>
                      <span className="min-w-0 flex-1 truncate font-mono text-muted">{f.value}</span>
                      <span className="shrink-0 font-mono text-[10px] text-muted/80">{f.len}B</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="grid grid-cols-[6.5rem_minmax(0,1fr)_11rem] border-b border-border px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted">
              <span>Offset</span>
              <span>HEX</span>
              <span>ASCII</span>
            </div>
            <div
              ref={scroller}
              tabIndex={0}
              role="group"
              aria-label={`Packet bytes. ${bytes.length.toLocaleString()} bytes. Use the arrow keys to select, Shift to extend, Ctrl+C to copy.`}
              onScroll={(e: UIEvent<HTMLDivElement>) => setScrollTop(e.currentTarget.scrollTop)}
              onMouseDown={onDown}
              onMouseOver={onOver}
              onKeyDown={onKey}
              className="min-h-0 flex-1 select-none overflow-y-auto font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-soft"
            >
              {bytes.length === 0 ? (
                <p className="p-3 text-muted">This packet holds no bytes.</p>
              ) : (
                <div style={{ height: total * ROW_H, position: "relative" }}>
                  {rows.map((r) => {
                    const row = rowBytes(bytes, r);
                    const base = r * BYTES_PER_ROW;
                    return (
                      <div
                        key={r}
                        style={{ position: "absolute", top: r * ROW_H, height: ROW_H }}
                        className="grid w-full grid-cols-[6.5rem_minmax(0,1fr)_11rem] items-center px-3 leading-5"
                      >
                        <span className="text-muted">{formatOffset(base)}</span>
                        <span className="whitespace-pre">
                          {Array.from(row, (b, j) => {
                            const i = base + j;
                            const picked = inRange(sel, i);
                            return (
                              <span key={j}>
                                <span
                                  data-i={i}
                                  className={`cursor-default rounded-sm px-[2px] ${
                                    picked ? "bg-accent text-on-accent" : decoded[i] ? "bg-white/[0.08] text-text" : "text-muted"
                                  }`}
                                >
                                  {byteHex(b)}
                                </span>
                                {j === 7 ? "  " : " "}
                              </span>
                            );
                          })}
                        </span>
                        <span className="whitespace-pre">
                          {Array.from(row, (b, j) => {
                            const i = base + j;
                            const picked = inRange(sel, i);
                            return (
                              <span key={j} data-i={i} className={`cursor-default ${picked ? "bg-accent text-on-accent" : decoded[i] ? "text-text" : "text-muted"}`}>
                                {asciiChar(b)}
                              </span>
                            );
                          })}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <p className="border-t border-border px-3 py-1 text-[11px] text-muted">
              <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-white/[0.08] align-middle" /> bytes covered by a decoded header field ·{" "}
              <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm border border-border align-middle" /> raw captured bytes (payload, undecoded) · captured data is shown as saved and is never edited
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
