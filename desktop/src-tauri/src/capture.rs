use pcap::{Capture, Device};
use serde::Serialize;
use std::{
    collections::VecDeque,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread::JoinHandle,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use crate::inspect::{self, Field};
use crate::packet::{both_ends_local, link_name, link_supported, summarize_link, LINK_ETHERNET};
pub use crate::packet::PacketRow;
use crate::pcapfile;
use crate::pcapng::{self, IfaceInfo};
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

/// What the capture thread hands to the window. The window asks for it with `poll_capture`.
#[derive(Default)]
struct Shared {
    frames: Mutex<VecDeque<Frame>>,
    rows: Mutex<Vec<PacketRow>>,
    error: Mutex<Option<String>>,
    done: AtomicBool,
    /// Interfaces the frames came from (one for a live capture, as many as the file has otherwise).
    ifaces: Mutex<Vec<IfaceInfo>>,
}

struct Frame {
    id: u64,
    time: f64,
    /// Exact capture time in nanoseconds since 1970.
    ts_ns: u64,
    link: u32,
    iface: u32,
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

#[tauri::command(async)]
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

#[tauri::command(async)]
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
        if f.len() > 600 || !f.chars().all(|c| c.is_ascii_alphanumeric() || " .:()[]+&>=".contains(c)) {
            return Err("That capture filter is not valid.".into());
        }
        cap.filter(f, true).map_err(|_| "That capture filter was refused by the network driver. Check the address and port.".to_string())?;
    }

    let stop = Arc::new(AtomicBool::new(false));
    let shared = Arc::new(Shared::default());
    if let Ok(mut i) = shared.ifaces.lock() {
        *i = vec![IfaceInfo { link: LINK_ETHERNET, snaplen: 2048, name: Some(adapter.clone()), description: None }];
    }
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
    // Read `done` first. The capture thread sets it only after its last flush, so when it is
    // already true, taking the rows afterwards cannot miss the final batch.
    let done = running.shared.done.load(Ordering::Acquire);
    let rows = std::mem::take(&mut *running.shared.rows.lock().map_err(|_| "capture buffer is locked")?);
    if done {
        let error = running.shared.error.lock().ok().and_then(|mut e| e.take());
        if let Some(r) = slot.take() {
            let _ = r.handle.join();
        }
        return Ok(Poll { rows, running: false, error });
    }
    Ok(Poll { rows, running: true, error: None })
}

/// Stops the capture and returns the packets the window has not received yet (up to the last
/// moments before the stop), so none are lost.
#[tauri::command(async)]
pub fn stop_capture(state: State<CaptureState>) -> Result<Vec<PacketRow>, String> {
    let running = state.slot.lock().map_err(|_| "capture state is locked")?.take();
    let Some(r) = running else { return Ok(vec![]) };
    r.stop.store(true, Ordering::Relaxed);
    let _ = r.handle.join();
    let rows = std::mem::take(&mut *r.shared.rows.lock().map_err(|_| "capture buffer is locked")?);
    Ok(rows)
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
                let ts_ns = now_ns();
                let now = ts_ns as f64 / 1e9;
                if let Some((mut row, cut)) = summarize_link(p.data, LINK_ETHERNET, p.header.len, now) {
                    row.id = next_id;
                    if let Ok(mut frames) = shared.frames.lock() {
                        frames.push_back(Frame { id: next_id, time: now, ts_ns, link: LINK_ETHERNET, iface: 0, wire_len: p.header.len, data: p.data.to_vec(), truncated: p.header.caplen < p.header.len || cut });
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

fn now_ns() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(0)
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

/// Sends one saved packet once, on the adapter it was captured from.
#[tauri::command(async)]
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

/// The saved packets with these ids, in the order given, as records, plus the interfaces they came from.
fn records_for(state: &State<CaptureState>, ids: Vec<u64>) -> Result<(Vec<pcapfile::Rec>, Vec<IfaceInfo>), String> {
    let (_, shared) = state.last.lock().map_err(|_| "capture state is locked")?.clone().ok_or("Capture some traffic first.")?;
    let frames = shared.frames.lock().map_err(|_| "capture buffer is locked")?;
    let wanted: std::collections::HashSet<u64> = ids.into_iter().collect();
    let recs: Vec<pcapfile::Rec> = frames
        .iter()
        .filter(|f| wanted.contains(&f.id))
        .map(|f| pcapfile::Rec { time: f.time, ts_ns: f.ts_ns, data: f.data.clone(), wire_len: f.wire_len, link: f.link, iface: f.iface })
        .collect();
    if recs.is_empty() {
        return Err("None of those packets are still saved. Only the most recent 20,000 are kept.".into());
    }
    let ifaces = shared.ifaces.lock().map_err(|_| "capture buffer is locked")?.clone();
    Ok((recs, ifaces))
}

/// Builds a .pcap file from the saved packets with these ids (in the order given) and returns it
/// as base64 text, which is how the window receives binary data.
#[tauri::command(async)]
pub fn export_pcap(state: State<CaptureState>, ids: Vec<u64>) -> Result<String, String> {
    use base64::Engine;
    let (recs, _) = records_for(&state, ids)?;
    // A classic .pcap file has one link type for the whole file.
    if recs.iter().any(|r| r.link != recs[0].link) {
        return Err("These packets come from interfaces with different link types, which a .pcap file cannot hold. Export as PCAPNG instead.".into());
    }
    Ok(base64::engine::general_purpose::STANDARD.encode(pcapfile::write(&recs)))
}

/// Same as `export_pcap`, as a .pcapng file: keeps nanosecond timestamps, every interface and its name.
#[tauri::command(async)]
pub fn export_pcapng(state: State<CaptureState>, ids: Vec<u64>) -> Result<String, String> {
    use base64::Engine;
    let (recs, ifaces) = records_for(&state, ids)?;
    let app = format!("EqSniff {}", env!("CARGO_PKG_VERSION"));
    Ok(base64::engine::general_purpose::STANDARD.encode(pcapng::write(&recs, &ifaces, &app)))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IfaceOut {
    pub link: u32,
    pub link_name: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub snaplen: u32,
    pub supported: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub rows: Vec<PacketRow>,
    /// Records in the file, including ones that were not looked at.
    pub total_records: usize,
    /// Records that were looked at (the first ones, up to a limit). Less than `total_records`
    /// only when the file was really cut short.
    pub read_records: usize,
    /// "pcap" or "pcapng".
    pub format: String,
    pub interfaces: Vec<IfaceOut>,
    /// What the file says about itself.
    pub info: Vec<String>,
    /// What was not kept or could not be read. Always shown to the person.
    pub notes: Vec<String>,
}

/// Opens a .pcap or .pcapng file (sent as base64). The packets become the saved capture, so they
/// can be exported again, but not replayed.
#[tauri::command(async)]
pub fn import_pcap(state: State<CaptureState>, data: String) -> Result<ImportResult, String> {
    if state.slot.lock().map_err(|_| "capture state is locked")?.is_some() {
        return Err("Stop the capture before opening a file.".into());
    }
    let bytes = pcapfile::decode_upload(&data)?;
    drop(data);
    let loaded = pcapng::read_any(&bytes, MAX_IMPORT)?;
    drop(bytes);
    let read_records = loaded.recs.len();
    let total_records = loaded.total;
    let shared = Arc::new(Shared::default());
    let mut rows = Vec::new();
    let mut undecoded = vec![0usize; loaded.ifaces.len()];
    {
        let mut frames = shared.frames.lock().map_err(|_| "capture buffer is locked")?;
        let mut next_id = 1u64;
        for r in loaded.recs {
            if let Some((mut row, cut)) = summarize_link(&r.data, r.link, r.wire_len, r.time) {
                row.id = next_id;
                frames.push_back(Frame {
                    id: next_id,
                    time: r.time,
                    ts_ns: r.ts_ns,
                    link: r.link,
                    iface: r.iface,
                    wire_len: r.wire_len,
                    truncated: (r.data.len() as u32) < r.wire_len || cut,
                    data: r.data,
                });
                next_id += 1;
                rows.push(row);
            } else if let Some(n) = undecoded.get_mut(r.iface as usize) {
                *n += 1;
            }
        }
    }
    let mut notes = loaded.notes;
    for (i, info) in loaded.ifaces.iter().enumerate() {
        if !link_supported(info.link) {
            let label = info.name.clone().unwrap_or_else(|| format!("Interface {i}"));
            notes.push(format!(
                "{label} uses {}, which the app cannot decode, so its packets are not shown ({} in the part read).",
                link_name(info.link),
                undecoded[i]
            ));
        }
    }
    if rows.is_empty() {
        if let Some(info) = loaded.ifaces.iter().find(|i| !link_supported(i.link)) {
            return Err(format!(
                "This capture uses {}, which the app cannot decode. It opens Ethernet, Linux cooked, loopback and raw IP captures.",
                link_name(info.link)
            ));
        }
        return Err("No IPv4 or IPv6 packets were found in that file.".into());
    }
    let interfaces: Vec<IfaceOut> = loaded
        .ifaces
        .iter()
        .map(|i| IfaceOut { link: i.link, link_name: link_name(i.link), name: i.name.clone(), description: i.description.clone(), snaplen: i.snaplen, supported: link_supported(i.link) })
        .collect();
    *shared.ifaces.lock().map_err(|_| "capture buffer is locked")? = loaded.ifaces;
    *state.last.lock().map_err(|_| "capture state is locked")? = Some((String::new(), shared));
    Ok(ImportResult { rows, total_records, read_records, format: if loaded.pcapng { "pcapng" } else { "pcap" }.into(), interfaces, info: loaded.info, notes })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PacketDetail {
    pub id: u64,
    pub time: f64,
    pub wire_len: u32,
    pub cap_len: usize,
    /// The capture holds less than the packet had on the wire.
    pub truncated: bool,
    pub link: u32,
    pub link_name: String,
    pub iface: u32,
    pub iface_name: Option<String>,
    /// The captured bytes, exactly as saved, as base64.
    pub data: String,
    pub fields: Vec<Field>,
    /// Text hex dump of the bytes. Only built when asked for (large packets make it big).
    pub hex_dump: Option<String>,
}

/// Everything about one saved packet for the HEX inspector: its bytes, and the decoded fields
/// with the byte range of each. The bytes are encoded straight from the saved copy.
#[tauri::command(async)]
pub fn packet_detail(state: State<CaptureState>, id: u64, hex_dump: Option<bool>) -> Result<PacketDetail, String> {
    use base64::Engine;
    let (_, shared) = state.last.lock().map_err(|_| "capture state is locked")?.clone().ok_or("Capture some traffic first.")?;
    let frames = shared.frames.lock().map_err(|_| "capture buffer is locked")?;
    // Ids only grow, so the frame can be found by binary search.
    let at = frames.partition_point(|f| f.id < id);
    let f = frames.get(at).filter(|f| f.id == id).ok_or("That packet is no longer saved. Only the most recent 20,000 are kept.")?;
    let iface_name = shared.ifaces.lock().ok().and_then(|i| i.get(f.iface as usize).and_then(|x| x.name.clone()));
    Ok(PacketDetail {
        id,
        time: f.time,
        wire_len: f.wire_len,
        cap_len: f.data.len(),
        truncated: f.truncated,
        link: f.link,
        link_name: link_name(f.link),
        iface: f.iface,
        iface_name,
        data: base64::engine::general_purpose::STANDARD.encode(&f.data),
        fields: inspect::decode(&f.data, f.link),
        hex_dump: hex_dump.unwrap_or(false).then(|| inspect::hexdump(&f.data)),
    })
}
