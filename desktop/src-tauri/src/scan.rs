//! A small network scan of YOUR OWN local network: which devices answer, and which of a fixed
//! list of common ports they have open. It works like a simple nmap "connect scan".
//!
//! Limits that are built in, not options:
//!   - only the private subnet of this computer's connected adapter (never anywhere else)
//!   - at most 256 addresses per scan
//!   - a fixed list of common ports, short timeouts, a fixed number of parallel connections
//!   - no packets are crafted; it only opens normal TCP connections, like a browser would

use serde::Serialize;
use std::{
    collections::HashSet,
    io::ErrorKind,
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream},
    process::Command,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use crate::scannet::{self, targets};
use tauri::State;

const PORTS: &[(u16, &str)] = &[
    (21, "ftp"), (22, "ssh"), (23, "telnet"), (25, "smtp"), (53, "dns"), (80, "http"), (110, "pop3"),
    (135, "msrpc"), (139, "netbios"), (143, "imap"), (443, "https"), (445, "smb"), (554, "rtsp"),
    (631, "ipp"), (993, "imaps"), (1883, "mqtt"), (3389, "rdp"), (5900, "vnc"), (8000, "http-alt"),
    (8080, "http-alt"), (8443, "https-alt"), (9100, "printer"),
];
const WORKERS: usize = 48;
const CONNECT_TIMEOUT: Duration = Duration::from_millis(300);

#[derive(Serialize, Clone)]
pub struct OpenPort {
    pub port: u16,
    pub service: &'static str,
}

#[derive(Serialize, Clone)]
pub struct Host {
    pub ip: String,
    pub mac: Option<String>,
    pub ports: Vec<OpenPort>,
}

#[derive(Default)]
struct Shared {
    total: AtomicUsize,
    done: AtomicUsize,
    finished: AtomicBool,
    hosts: Mutex<Vec<Host>>,
}

struct Run {
    cancel: Arc<AtomicBool>,
    shared: Arc<Shared>,
}

#[derive(Default)]
pub struct ScanState(Mutex<Option<Run>>);

#[derive(Serialize)]
pub struct ScanPoll {
    pub running: bool,
    pub scanned: usize,
    pub total: usize,
    pub hosts: Vec<Host>,
}

/// This computer's address and subnet size on the connected adapter. Falls back to a /24 when
/// the adapter's mask cannot be read, and refuses single-address networks such as VPN tunnels.
fn local_network() -> Result<(Ipv4Addr, u8), String> {
    let own = match crate::capture::default_route_ip() {
        Some(IpAddr::V4(v)) if v.is_private() => v,
        Some(_) => return Err("Scanning works only on a private home or office network. This computer is not on one.".into()),
        None => return Err("Could not tell which network this computer is on. Check that you are connected.".into()),
    };
    let mut found: Option<u8> = None;
    if crate::capture::require_npcap().is_ok() {
        if let Ok(devices) = pcap::Device::list() {
            for d in devices {
                for a in d.addresses {
                    if a.addr == IpAddr::V4(own) {
                        if let Some(IpAddr::V4(mask)) = a.netmask {
                            found = Some(u32::from(mask).count_ones() as u8);
                        }
                    }
                }
            }
        }
    }
    Ok((own, scannet::pick_prefix(found)?))
}

/// IPv4 -> MAC from Windows' own ARP table. Entries appear once this computer has talked to a device.
fn arp_table() -> Vec<(Ipv4Addr, String)> {
    #[cfg(windows)]
    use std::os::windows::process::CommandExt;
    let mut cmd = Command::new(crate::vpnengine::sys32("arp.exe"));
    cmd.arg("-a");
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000);
    let Ok(out) = cmd.output() else { return vec![] };
    scannet::parse_arp(&String::from_utf8_lossy(&out.stdout))
}

#[tauri::command(async)]
pub fn scan_start(state: State<ScanState>, target: String) -> Result<String, String> {
    let mut slot = state.0.lock().map_err(|_| "scan state is locked")?;
    if let Some(r) = slot.as_ref() {
        if !r.shared.finished.load(Ordering::Acquire) {
            return Err("A scan is already running.".into());
        }
    }
    let (own, prefix) = local_network()?;
    let list = targets(own, prefix, &target)?;
    let mask = !0u32 << (32 - prefix);
    let network = format!("{}/{}", Ipv4Addr::from(u32::from(own) & mask), prefix);

    let cancel = Arc::new(AtomicBool::new(false));
    let shared = Arc::new(Shared::default());
    shared.total.store(list.len(), Ordering::Relaxed);
    *slot = Some(Run { cancel: cancel.clone(), shared: shared.clone() });

    std::thread::spawn(move || {
        let list = Arc::new(list);
        let next = Arc::new(AtomicUsize::new(0));
        let workers: Vec<_> = (0..WORKERS.min(list.len().max(1)))
            .map(|_| {
                let (list, next, cancel, shared) = (list.clone(), next.clone(), cancel.clone(), shared.clone());
                std::thread::spawn(move || loop {
                    let i = next.fetch_add(1, Ordering::Relaxed);
                    if i >= list.len() || cancel.load(Ordering::Relaxed) {
                        break;
                    }
                    let ip = list[i];
                    let mut open = Vec::new();
                    let mut alive = false;
                    for (port, service) in PORTS {
                        if cancel.load(Ordering::Relaxed) {
                            break;
                        }
                        match TcpStream::connect_timeout(&SocketAddr::new(IpAddr::V4(ip), *port), CONNECT_TIMEOUT) {
                            Ok(_) => {
                                alive = true;
                                open.push(OpenPort { port: *port, service });
                            }
                            // A refusal means the device is there and the port is closed.
                            Err(e) if e.kind() == ErrorKind::ConnectionRefused => alive = true,
                            Err(_) => {}
                        }
                    }
                    if alive {
                        if let Ok(mut hosts) = shared.hosts.lock() {
                            hosts.push(Host { ip: ip.to_string(), mac: None, ports: open });
                        }
                    }
                    shared.done.fetch_add(1, Ordering::Relaxed);
                })
            })
            .collect();
        for w in workers {
            let _ = w.join();
        }

        // Devices that ignore every probed port still answer address lookups, so Windows'
        // ARP table shows them. Add those, and attach MAC addresses.
        let wanted: HashSet<Ipv4Addr> = list.iter().copied().collect();
        if let Ok(mut hosts) = shared.hosts.lock() {
            for (ip, mac) in arp_table() {
                if !wanted.contains(&ip) {
                    continue;
                }
                match hosts.iter_mut().find(|h| h.ip == ip.to_string()) {
                    Some(h) => h.mac = Some(mac),
                    None => hosts.push(Host { ip: ip.to_string(), mac: Some(mac), ports: vec![] }),
                }
            }
        }
        shared.finished.store(true, Ordering::Release);
    });
    Ok(network)
}

#[tauri::command]
pub fn scan_poll(state: State<ScanState>) -> Result<ScanPoll, String> {
    let slot = state.0.lock().map_err(|_| "scan state is locked")?;
    let Some(run) = slot.as_ref() else {
        return Ok(ScanPoll { running: false, scanned: 0, total: 0, hosts: vec![] });
    };
    let mut hosts = run.shared.hosts.lock().map_err(|_| "scan results are locked")?.clone();
    hosts.sort_by_key(|h| h.ip.parse::<Ipv4Addr>().map(u32::from).unwrap_or(0));
    Ok(ScanPoll {
        running: !run.shared.finished.load(Ordering::Acquire),
        scanned: run.shared.done.load(Ordering::Relaxed),
        total: run.shared.total.load(Ordering::Relaxed),
        hosts,
    })
}

#[tauri::command]
pub fn scan_cancel(state: State<ScanState>) -> Result<(), String> {
    if let Some(r) = state.0.lock().map_err(|_| "scan state is locked")?.as_ref() {
        r.cancel.store(true, Ordering::Relaxed);
    }
    Ok(())
}
