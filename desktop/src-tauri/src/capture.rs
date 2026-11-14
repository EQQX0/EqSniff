use etherparse::{NetSlice, SlicedPacket, TransportSlice};
use pcap::{Capture, Device};
use serde::Serialize;
use std::{
    collections::VecDeque,
    net::{Ipv4Addr, Ipv6Addr},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread::JoinHandle,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use crate::pcapfile;
use tauri::State;

/// If the window stops asking for packets, keep memory bounded.
const MAX_BUFFERED: usize = 50_000;
/// Whole packets kept so one can be replayed. Older ones are dropped.
const MAX_FRAMES: usize = 20_000;
/// Packets shown after opening a capture file.
const MAX_IMPORT: usize = 5_000;

#[derive(Serialize, Clone)]
pub struct Adapter {
    pub name: String,
    pub description: String,
    /// True for the adapter this computer uses to reach the internet.
    pub connected: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PacketRow {
    pub id: u64,
    pub time: f64,
    pub src: String,
    pub dst: String,
    pub src_port: Option<u16>,
    pub dst_port: Option<u16>,
    pub protocol: String,
    pub length: u32,
    /// First bytes of the payload as hex, so the filter editor can match on content.
    pub head: String,
}

/// What the capture thread hands to the window. The window asks for it with `poll_capture`.
#[derive(Default)]
struct Shared {
    frames: Mutex<VecDeque<Frame>>,
    rows: Mutex<Vec<PacketRow>>,
    error: Mutex<Option<String>>,
    done: AtomicBool,
}

struct Frame {
    id: u64,
    time: f64,
    wire_len: u32,
    data: Vec<u8>,
    /// The driver kept only part of the packet, so it cannot be sent again.
    truncated: bool,
}

struct Running {
    stop: Arc<AtomicBool>,
    shared: Arc<Shared>,
    handle: JoinHandle<()>,
}

#[derive(Default)]
pub struct CaptureState {
    slot: Mutex<Option<Running>>,
    /// The most recent capture (adapter name and its saved packets), kept after Stop for replay.
    last: Mutex<Option<(String, Arc<Shared>)>>,
}

#[derive(Serialize)]
pub struct Poll {
    pub rows: Vec<PacketRow>,
    pub running: bool,
    pub error: Option<String>,
}

/// The local address Windows would use to reach the internet. A UDP "connect" only asks the
/// routing table; it sends nothing.
pub(crate) fn default_route_ip() -> Option<std::net::IpAddr> {
    let sock = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    sock.connect("192.0.2.1:9").ok()?; // reserved documentation address, never contacted
    Some(sock.local_addr().ok()?.ip())
}

/// Makes sure Npcap's library can be found, and says so in plain words if it cannot.
/// Must run before any pcap call, because the library is loaded on first use.
pub(crate) fn require_npcap() -> Result<(), String> {
    #[cfg(windows)]
    {
        extern "system" {
            fn SetDllDirectoryW(path: *const u16) -> i32;
        }
        let win = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
        let npcap = std::path::Path::new(&win).join("System32").join("Npcap");
        let found = npcap.join("wpcap.dll").exists() || std::path::Path::new(&win).join("System32").join("wpcap.dll").exists();
        if !found {
            return Err("Npcap is not installed. Install Npcap from npcap.com, then restart the app.".into());
        }
        if npcap.exists() {
            use std::os::windows::ffi::OsStrExt;
            let wide: Vec<u16> = npcap.as_os_str().encode_wide().chain(Some(0)).collect();
            // SAFETY: `wide` is a valid NUL-terminated UTF-16 string that outlives the call.
            unsafe { SetDllDirectoryW(wide.as_ptr()) };
        }
    }
    Ok(())
}

#[tauri::command]
pub fn list_adapters() -> Result<Vec<Adapter>, String> {
    require_npcap()?;
    let devices = Device::list().map_err(explain)?;
    let route = default_route_ip();
    let mut list: Vec<Adapter> = devices
        .into_iter()
        .map(|d| Adapter {
            connected: route.is_some_and(|ip| d.addresses.iter().any(|a| a.addr == ip)),
            description: d.desc.clone().unwrap_or_else(|| d.name.clone()),
            name: d.name,
        })
        .collect();
    list.sort_by_key(|a| !a.connected); // stable: connected first, the rest keep their order
    Ok(list)
}

#[tauri::command]
pub fn start_capture(state: State<CaptureState>, adapter: String, filter: Option<String>) -> Result<(), String> {
    let mut slot = state.slot.lock().map_err(|_| "capture state is locked")?;
    if slot.is_some() {
        return Err("A capture is already running.".into());
    }

    require_npcap()?;
    // Open here, not in the thread, so permission and driver errors reach the UI at once.
    let mut cap = Capture::from_device(adapter.as_str())
        .and_then(|c| c.promisc(true).snaplen(2048).immediate_mode(true).timeout(200).open())
        .map_err(explain)?;
    // A capture filter makes the driver drop everything else before this app ever sees it.
    if let Some(f) = filter.as_deref().map(str::trim).filter(|f| !f.is_empty()) {
        if f.len() > 300 || !f.chars().all(|c| c.is_ascii_alphanumeric() || " .:()".contains(c)) {
            return Err("That capture filter is not valid.".into());
        }
        cap.filter(f, true).map_err(|_| "That capture filter was refused by the network driver. Check the address and port.".to_string())?;
    }

    let stop = Arc::new(AtomicBool::new(false));
    let shared = Arc::new(Shared::default());
    if let Ok(mut last) = state.last.lock() {
        *last = Some((adapter.clone(), shared.clone()));
    }
    let (flag, out) = (stop.clone(), shared.clone());
    let handle = std::thread::spawn(move || run(cap, flag, out));
    *slot = Some(Running { stop, shared, handle });
    Ok(())
}

/// Returns the packets seen since the last call. Also reports when the capture ended on its own.
#[tauri::command]
pub fn poll_capture(state: State<CaptureState>) -> Result<Poll, String> {
    let mut slot = state.slot.lock().map_err(|_| "capture state is locked")?;
    let Some(running) = slot.as_ref() else {
        return Ok(Poll { rows: vec![], running: false, error: None });
    };
    let rows = std::mem::take(&mut *running.shared.rows.lock().map_err(|_| "capture buffer is locked")?);
    if running.shared.done.load(Ordering::Acquire) {
        let error = running.shared.error.lock().ok().and_then(|mut e| e.take());
        if let Some(r) = slot.take() {
            let _ = r.handle.join();
        }
        return Ok(Poll { rows, running: false, error });
    }
    Ok(Poll { rows, running: true, error: None })
}

#[tauri::command]
pub fn stop_capture(state: State<CaptureState>) -> Result<(), String> {
    let running = state.slot.lock().map_err(|_| "capture state is locked")?.take();
    if let Some(r) = running {
        r.stop.store(true, Ordering::Relaxed);
        let _ = r.handle.join();
    }
    Ok(())
}

fn run(mut cap: Capture<pcap::Active>, stop: Arc<AtomicBool>, shared: Arc<Shared>) {
    let mut batch: Vec<PacketRow> = Vec::with_capacity(256);
    let mut last_flush = Instant::now();
    let mut next_id: u64 = 1;

    let flush = |batch: &mut Vec<PacketRow>| {
        if let Ok(mut rows) = shared.rows.lock() {
            rows.append(batch);
            if rows.len() > MAX_BUFFERED {
                let extra = rows.len() - MAX_BUFFERED;
                rows.drain(..extra);
            }
        }
        batch.clear();
    };

    while !stop.load(Ordering::Relaxed) {
        match cap.next_packet() {
            Ok(p) => {
                let now = now_secs();
                if let Some(mut row) = summarize(p.data, p.header.len, now) {
                    row.id = next_id;
                    if let Ok(mut frames) = shared.frames.lock() {
                        frames.push_back(Frame { id: next_id, time: now, wire_len: p.header.len, data: p.data.to_vec(), truncated: p.header.caplen < p.header.len });
                        if frames.len() > MAX_FRAMES {
                            frames.pop_front();
                        }
                    }
                    next_id += 1;
                    batch.push(row);
                }
            }
            Err(pcap::Error::TimeoutExpired) => {}
            Err(e) => {
                if let Ok(mut slot) = shared.error.lock() {
                    *slot = Some(explain(e));
                }
                break;
            }
        }
        if batch.len() >= 200 || (!batch.is_empty() && last_flush.elapsed() >= Duration::from_millis(100)) {
            flush(&mut batch);
            last_flush = Instant::now();
        }
    }
    flush(&mut batch);
    shared.done.store(true, Ordering::Release);
}

fn now_secs() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0)
}

fn hex_head(bytes: &[u8]) -> String {
    bytes.iter().take(32).map(|b| format!("{b:02x}")).collect()
}

fn summarize(data: &[u8], wire_len: u32, time: f64) -> Option<PacketRow> {
    let parsed = SlicedPacket::from_ethernet(data).ok()?;
    let (src, dst, ip_proto) = match parsed.net.as_ref()? {
        NetSlice::Ipv4(ip) => {
            let h = ip.header();
            (h.source_addr().to_string(), h.destination_addr().to_string(), "IPv4")
        }
        NetSlice::Ipv6(ip) => {
            let h = ip.header();
            (h.source_addr().to_string(), h.destination_addr().to_string(), "IPv6")
        }
        _ => return None,
    };
    let (protocol, src_port, dst_port) = match parsed.transport.as_ref() {
        Some(TransportSlice::Tcp(t)) => ("TCP", Some(t.source_port()), Some(t.destination_port())),
        Some(TransportSlice::Udp(u)) => ("UDP", Some(u.source_port()), Some(u.destination_port())),
        Some(TransportSlice::Icmpv4(_)) | Some(TransportSlice::Icmpv6(_)) => ("ICMP", None, None),
        None => (ip_proto, None, None),
    };
    let payload: &[u8] = match parsed.transport.as_ref() {
        Some(TransportSlice::Tcp(t)) => t.payload(),
        Some(TransportSlice::Udp(u)) => u.payload(),
        _ => &[],
    };
    Some(PacketRow { id: 0, time, src, dst, src_port, dst_port, protocol: protocol.into(), length: wire_len, head: hex_head(payload) })
}

/// Turns driver errors into something a person can act on.
fn explain(e: pcap::Error) -> String {
    let raw = e.to_string();
    let lower = raw.to_lowercase();
    if lower.contains("wpcap") || lower.contains("loadlibrary") || lower.contains("dll") {
        "Npcap is not installed. Install Npcap from npcap.com, then restart the app.".into()
    } else if lower.contains("permission") || lower.contains("denied") || lower.contains("access") {
        "Windows blocked access to the network adapter. Run the app as administrator, or reinstall Npcap with non-admin capture enabled.".into()
    } else {
        raw
    }
}

fn is_local_v4(ip: Ipv4Addr) -> bool {
    ip.is_private() || ip.is_loopback() || ip.is_link_local()
}

fn is_local_v6(ip: Ipv6Addr) -> bool {
    let first = ip.segments()[0];
    ip.is_loopback() || (first & 0xfe00) == 0xfc00 || (first & 0xffc0) == 0xfe80
}

/// Replay is for testing your own network, so both ends of the packet must be devices inside it.
/// A packet from or to an internet address is refused, so the app cannot put forged internet
/// traffic onto your network.
fn both_ends_local(data: &[u8]) -> Result<(), String> {
    let parsed = SlicedPacket::from_ethernet(data).map_err(|_| "This packet cannot be read, so it was not sent.".to_string())?;
    let ok = match parsed.net.as_ref() {
        Some(NetSlice::Ipv4(ip)) => is_local_v4(ip.header().source_addr()) && is_local_v4(ip.header().destination_addr()),
        Some(NetSlice::Ipv6(ip)) => is_local_v6(ip.header().source_addr()) && is_local_v6(ip.header().destination_addr()),
        _ => false,
    };
    if ok { Ok(()) } else { Err("Replay only works for packets between two devices on your own network. This one involves an address outside it.".into()) }
}

/// Sends one saved packet once, on the adapter it was captured from.
#[tauri::command]
pub fn replay_packet(state: State<CaptureState>, id: u64) -> Result<String, String> {
    let (adapter, shared) = state
        .last
        .lock()
        .map_err(|_| "capture state is locked")?
        .clone()
        .ok_or("Capture some traffic first.")?;
    let (data, truncated) = {
        let frames = shared.frames.lock().map_err(|_| "capture buffer is locked")?;
        let f = frames.iter().find(|f| f.id == id).ok_or("That packet is no longer saved. Only the most recent 20,000 are kept.")?;
        (f.data.clone(), f.truncated)
    };
    if truncated {
        return Err("This packet was too large to save in full, so it cannot be replayed.".into());
    }
    if adapter.is_empty() {
        return Err("Packets opened from a file cannot be sent again. Replay works on a live capture.".into());
    }
    both_ends_local(&data)?;
    require_npcap()?;
    let mut cap = Capture::from_device(adapter.as_str())
        .and_then(|c| c.open())
        .map_err(explain)?;
    cap.sendpacket(data.as_slice()).map_err(explain)?;
    Ok(format!("Sent 1 packet ({} bytes).", data.len()))
}

/// Builds a .pcap file from the saved packets with these ids (in the order given) and returns it
/// as base64 text, which is how the window receives binary data.
#[tauri::command]
pub fn export_pcap(state: State<CaptureState>, ids: Vec<u64>) -> Result<String, String> {
    use base64::Engine;
    let (_, shared) = state.last.lock().map_err(|_| "capture state is locked")?.clone().ok_or("Capture some traffic first.")?;
    let frames = shared.frames.lock().map_err(|_| "capture buffer is locked")?;
    let wanted: std::collections::HashSet<u64> = ids.into_iter().collect();
    let recs: Vec<pcapfile::Rec> = frames
        .iter()
        .filter(|f| wanted.contains(&f.id))
        .map(|f| pcapfile::Rec { time: f.time, data: f.data.clone(), wire_len: f.wire_len })
        .collect();
    if recs.is_empty() {
        return Err("None of those packets are still saved. Only the most recent 20,000 are kept.".into());
    }
    Ok(base64::engine::general_purpose::STANDARD.encode(pcapfile::write(&recs)))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub rows: Vec<PacketRow>,
    /// Records in the file, including ones that were not shown.
    pub total_records: usize,
}

/// Opens a .pcap file (sent as base64). The packets become the saved capture, so they can be
/// exported again, but not replayed.
#[tauri::command]
pub fn import_pcap(state: State<CaptureState>, data: String) -> Result<ImportResult, String> {
    use base64::Engine;
    if state.slot.lock().map_err(|_| "capture state is locked")?.is_some() {
        return Err("Stop the capture before opening a file.".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD.decode(data.trim()).map_err(|_| "The file could not be read.".to_string())?;
    let (recs, total_records) = pcapfile::read(&bytes, MAX_IMPORT)?;
    let shared = Arc::new(Shared::default());
    let mut rows = Vec::new();
    {
        let mut frames = shared.frames.lock().map_err(|_| "capture buffer is locked")?;
        let mut next_id = 1u64;
        for r in recs {
            if let Some(mut row) = summarize(&r.data, r.wire_len, r.time) {
                row.id = next_id;
                frames.push_back(Frame { id: next_id, time: r.time, wire_len: r.wire_len, truncated: (r.data.len() as u32) < r.wire_len, data: r.data });
                next_id += 1;
                rows.push(row);
            }
        }
    }
    if rows.is_empty() {
        return Err("No IPv4 or IPv6 packets were found in that file.".into());
    }
    *state.last.lock().map_err(|_| "capture state is locked")? = Some((String::new(), shared));
    Ok(ImportResult { rows, total_records })
}
