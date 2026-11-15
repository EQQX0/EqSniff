//! The WireGuard engine. It runs in a second copy of this program that Windows starts with administrator rights
//! (`network-toolkit.exe --vpn-run <folder> <name>`), because creating a network adapter needs them.
//!
//! The pieces: `wintun.dll` (signed by the WireGuard project) gives us a virtual adapter, `boringtun` does the
//! WireGuard cryptography, and `netsh` sets the address, routes and DNS. The window talks to this process through
//! three small files next to the tunnel: `<name>.state` (written here), `<name>.stop` (written by the window to
//! ask for a stop) and `<name>.log` (what happened, never any key).

use crate::vpnconf::{self, Config};
use boringtun::noise::{Tunn, TunnResult};
use boringtun::x25519::{PublicKey, StaticSecret};
use std::{
    fs,
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, ToSocketAddrs, UdpSocket},
    os::windows::{io::AsRawSocket, process::CommandExt},
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

const NO_WINDOW: u32 = 0x0800_0000;

pub fn decode_key(k: &str) -> Result<[u8; 32], String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let v = STANDARD.decode(k.trim()).map_err(|_| "A key in the tunnel file is not valid.".to_string())?;
    v.try_into().map_err(|_| "A key in the tunnel file is not 32 bytes.".to_string())
}

/// The public key that belongs to a private key, in the usual base64 form.
pub fn public_key_of(private: &str) -> Option<String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let secret = StaticSecret::from(decode_key(private).ok()?);
    Some(STANDARD.encode(PublicKey::from(&secret).as_bytes()))
}

// ---------- the files shared with the window ----------

pub fn state_path(dir: &Path, name: &str) -> PathBuf {
    dir.join(format!("{name}.state"))
}
pub fn stop_path(dir: &Path, name: &str) -> PathBuf {
    dir.join(format!("{name}.stop"))
}
pub fn log_path(dir: &Path, name: &str) -> PathBuf {
    dir.join(format!("{name}.log"))
}
pub fn options_path(dir: &Path, name: &str) -> PathBuf {
    dir.join(format!("{name}.options"))
}

// ---------- per-tunnel options (kept apart from the .conf, so an imported file can never set them) ----------

#[derive(Debug, Default, Clone, Copy, PartialEq)]
pub struct Options {
    pub killswitch: bool,
}

/// Reads the options file text. Anything unreadable means the defaults (kill switch off).
pub fn parse_options(text: &str) -> Options {
    let v: serde_json::Value = serde_json::from_str(text).unwrap_or(serde_json::Value::Null);
    Options { killswitch: v.get("killswitch").and_then(|x| x.as_bool()).unwrap_or(false) }
}

pub fn render_options(o: Options) -> String {
    format!("{{\"killswitch\":{}}}\n", o.killswitch)
}

pub fn read_options(dir: &Path, name: &str) -> Options {
    fs::read_to_string(options_path(dir, name)).map(|t| parse_options(&t)).unwrap_or_default()
}

// ---------- editing and log helpers ----------

/// What the edit box shows in place of the private key.
pub const KEY_PLACEHOLDER: &str = "<unchanged>";

/// Puts the stored private key back in place of the placeholder (on the PrivateKey line only).
pub fn fill_placeholder(text: &str, stored_key: &str) -> String {
    let mut out = String::with_capacity(text.len() + 44);
    for (i, line) in text.lines().enumerate() {
        if i > 0 {
            out.push('\n');
        }
        match line.split_once('=') {
            Some((k, v)) if k.trim().eq_ignore_ascii_case("privatekey") && v.trim() == KEY_PLACEHOLDER => {
                out.push_str(k);
                out.push_str("= ");
                out.push_str(stored_key);
            }
            _ => out.push_str(line),
        }
    }
    out
}

/// The rendered file with the private key hidden, for the edit box.
pub fn render_for_edit(c: &Config) -> String {
    let mut c = c.clone();
    c.private_key = KEY_PLACEHOLDER.to_string();
    vpnconf::render(&c)
}

/// The last `n` lines of `text`.
pub fn tail_lines(text: &str, n: usize) -> String {
    let lines: Vec<&str> = text.lines().collect();
    lines[lines.len().saturating_sub(n)..].join("\n")
}

struct Log(Mutex<fs::File>);
impl Log {
    fn line(&self, text: &str) {
        use std::io::Write;
        if let Ok(mut f) = self.0.lock() {
            let _ = writeln!(f, "{text}");
        }
    }
}

// ---------- routing helpers ----------

#[derive(Clone, Copy)]
struct Net {
    ip: IpAddr,
    len: u8,
}

fn parse_net(s: &str) -> Option<Net> {
    let (a, l) = match s.split_once('/') {
        Some((a, l)) => (a, Some(l)),
        None => (s, None),
    };
    let ip: IpAddr = a.parse().ok()?;
    let max = if ip.is_ipv4() { 32 } else { 128 };
    // No prefix means a single address.
    let len: u8 = match l {
        Some(l) => l.parse().ok()?,
        None => max,
    };
    (len <= max).then_some(Net { ip, len })
}

fn bits(ip: IpAddr) -> (u128, u8) {
    match ip {
        IpAddr::V4(v) => (u32::from(v) as u128, 32),
        IpAddr::V6(v) => (u128::from(v), 128),
    }
}

fn contains(net: Net, ip: IpAddr) -> bool {
    if net.ip.is_ipv4() != ip.is_ipv4() {
        return false;
    }
    let (n, total) = bits(net.ip);
    let (i, _) = bits(ip);
    if net.len == 0 {
        return true;
    }
    let shift = total - net.len;
    (n >> shift) == (i >> shift)
}

/// `net` minus the single address `hole`, as a list of ranges. This keeps the encrypted packets to the server
/// out of the tunnel, so they leave by the normal route instead of looping back in.
fn without(net: Net, hole: IpAddr) -> Vec<Net> {
    let (mut base, total) = bits(net.ip);
    let (h, _) = bits(hole);
    let mut out = Vec::new();
    let mut len = net.len;
    while len < total {
        len += 1;
        let bit = 1u128 << (total - len);
        // The half that does not hold the hole stays whole.
        let (keep, go) = if h & bit == 0 { (base | bit, base) } else { (base, base | bit) };
        out.push(Net { ip: from_bits(keep, total), len });
        base = go;
    }
    out
}

/// For tests: a network or address as (address, prefix length). A missing prefix means a single address.
pub fn net_parts(s: &str) -> Option<(String, u8)> {
    parse_net(s).map(|n| (n.ip.to_string(), n.len))
}

/// For tests: the ranges that cover `net` except the address `hole`, as text.
pub fn exclude_routes(net: &str, hole: &str) -> Option<Vec<String>> {
    let n = parse_net(net)?;
    let h: IpAddr = hole.parse().ok()?;
    contains(n, h).then(|| without(n, h).into_iter().map(|x| format!("{}/{}", x.ip, x.len)).collect())
}

fn from_bits(v: u128, total: u8) -> IpAddr {
    if total == 32 { IpAddr::V4(Ipv4Addr::from(v as u32)) } else { IpAddr::V6(Ipv6Addr::from(v)) }
}

fn packet_dst(p: &[u8]) -> Option<IpAddr> {
    match p.first()? >> 4 {
        4 if p.len() >= 20 => Some(IpAddr::V4(Ipv4Addr::new(p[16], p[17], p[18], p[19]))),
        6 if p.len() >= 40 => {
            let mut b = [0u8; 16];
            b.copy_from_slice(&p[24..40]);
            Some(IpAddr::V6(Ipv6Addr::from(b)))
        }
        _ => None,
    }
}

// ---------- sockets that keep out of the tunnel ----------

/// Index of the network interface Windows would use to reach `to`, found before the tunnel exists.
fn best_interface(to: SocketAddr) -> Option<u32> {
    use windows_sys::Win32::NetworkManagement::IpHelper::GetBestInterfaceEx;
    let mut raw = [0u8; 28];
    let len = match to {
        SocketAddr::V4(a) => {
            raw[0..2].copy_from_slice(&2u16.to_le_bytes());
            raw[2..4].copy_from_slice(&a.port().to_be_bytes());
            raw[4..8].copy_from_slice(&a.ip().octets());
            16
        }
        SocketAddr::V6(a) => {
            raw[0..2].copy_from_slice(&23u16.to_le_bytes());
            raw[2..4].copy_from_slice(&a.port().to_be_bytes());
            raw[8..24].copy_from_slice(&a.ip().octets());
            28
        }
    };
    let _ = len;
    let mut idx = 0u32;
    // SAFETY: `raw` is a valid SOCKADDR_IN or SOCKADDR_IN6 image and `idx` is a valid out pointer.
    let rc = unsafe { GetBestInterfaceEx(raw.as_ptr() as *const _, &mut idx) };
    (rc == 0 && idx != 0).then_some(idx)
}

/// Pins the socket to one interface so the encrypted packets never go back into our own tunnel.
fn pin_to_interface(sock: &UdpSocket, v6: bool, index: u32) {
    use windows_sys::Win32::Networking::WinSock::setsockopt;
    let (level, value) = if v6 { (41, index.to_ne_bytes()) } else { (0, index.to_be_bytes()) };
    // SAFETY: the socket handle is live for the call and the option value is four bytes.
    unsafe {
        setsockopt(sock.as_raw_socket() as usize, level, 31, value.as_ptr(), 4);
    }
}

// ---------- the running tunnel ----------

struct PeerRun {
    sent: AtomicU64,
    got: AtomicU64,
    tunn: Mutex<Tunn>,
    sock: UdpSocket,
    allowed: Vec<Net>,
}

fn send_net(p: &PeerRun, data: &[u8]) {
    if p.sock.send(data).is_ok() {
        p.sent.fetch_add(1, Ordering::Relaxed);
    }
}

fn netsh(args: &[&str]) -> Result<(), String> {
    let out = Command::new("netsh.exe").args(args).creation_flags(NO_WINDOW).output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        let text = String::from_utf8_lossy(&out.stdout);
        Err(format!("netsh {}: {}", args.join(" "), text.trim()))
    }
}

fn mask_v4(len: u8) -> String {
    let m: u32 = if len == 0 { 0 } else { u32::MAX << (32 - len) };
    Ipv4Addr::from(m).to_string()
}

/// Every netsh call names the adapter by its index, never by name: a tunnel called "Ethernet" would otherwise
/// match the real Ethernet adapter, because Windows renames the new one to "Ethernet 2".
fn configure(ifc: u32, cfg: &Config, endpoints: &[IpAddr], log: &Log) -> Result<(), String> {
    let ix = ifc.to_string();
    let ix = ix.as_str();
    let mut ready = false;
    for _ in 0..20 {
        if netsh(&["interface", "ipv4", "show", "interface", &format!("interface={ix}")]).is_ok()
            || netsh(&["interface", "ipv6", "show", "interface", &format!("interface={ix}")]).is_ok()
        {
            ready = true;
            break;
        }
        thread::sleep(Duration::from_millis(500));
    }
    if !ready {
        return Err("Windows did not show the new adapter in time.".into());
    }
    let mtu = cfg.mtu.unwrap_or(1420).to_string();
    let mut first_v4 = true;
    for a in &cfg.addresses {
        let n = parse_net(a).ok_or("Bad address in the tunnel file.")?;
        match n.ip {
            IpAddr::V4(v) => {
                let (verb, extra) = if first_v4 { ("set", "source=static") } else { ("add", "") };
                first_v4 = false;
                let mut args = vec!["interface".to_string(), "ipv4".into(), verb.into(), "address".into(), format!("interface={ix}")];
                if !extra.is_empty() {
                    args.push(extra.into());
                }
                args.extend([format!("address={v}"), format!("mask={}", mask_v4(n.len)), "store=active".into()]);
                let refs: Vec<&str> = args.iter().map(String::as_str).collect();
                netsh(&refs)?
            }
            IpAddr::V6(v) => netsh(&["interface", "ipv6", "add", "address", &format!("interface={ix}"), &format!("address={v}/{}", n.len), "store=active"])?,
        }
    }
    for fam in ["ipv4", "ipv6"] {
        if let Err(e) = netsh(&["interface", fam, "set", "subinterface", &format!("interface={ix}"), &format!("mtu={mtu}"), "store=active"]) {
            log.line(&format!("note: {e}"));
        }
        let _ = netsh(&["interface", fam, "set", "interface", &format!("interface={ix}"), "metric=1"]);
    }
    for p in &cfg.peers {
        for a in &p.allowed_ips {
            let n = parse_net(a).ok_or("Bad allowed address in the tunnel file.")?;
            let hole = endpoints.iter().copied().find(|e| contains(n, *e) && n.len < if e.is_ipv4() { 32 } else { 128 });
            let prefixes: Vec<String> = match (hole, n.ip, n.len) {
                (Some(h), _, _) => without(n, h).into_iter().map(|x| format!("{}/{}", x.ip, x.len)).collect(),
                (None, IpAddr::V4(_), 0) => vec!["0.0.0.0/1".into(), "128.0.0.0/1".into()],
                (None, IpAddr::V6(_), 0) => vec!["::/1".into(), "8000::/1".into()],
                _ => vec![format!("{}/{}", n.ip, n.len)],
            };
            let fam = if n.ip.is_ipv4() { "ipv4" } else { "ipv6" };
            let hop = if n.ip.is_ipv4() { "0.0.0.0" } else { "::" };
            for pre in prefixes {
                netsh(&["interface", fam, "add", "route", &format!("prefix={pre}"), &format!("interface={ix}"), &format!("nexthop={hop}"), "metric=0", "store=active"])?;
            }
        }
    }
    let mut first = [true, true];
    for d in &cfg.dns {
        let Ok(ip) = d.parse::<IpAddr>() else { continue };
        let k = if ip.is_ipv4() { 0 } else { 1 };
        let fam = if k == 0 { "ipv4" } else { "ipv6" };
        let r = if first[k] {
            netsh(&["interface", fam, "set", "dnsservers", &format!("name={ix}"), "source=static", &format!("address={ip}"), "validate=no"])
        } else {
            netsh(&["interface", fam, "add", "dnsservers", &format!("name={ix}"), &format!("address={ip}"), "validate=no"])
        };
        first[k] = false;
        if let Err(e) = r {
            log.line(&format!("note: {e}"));
        }
    }
    Ok(())
}

fn dll_path() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = exe.parent().ok_or("No program folder.")?;
    let mut tries = vec![dir.join("wintun.dll"), dir.join("resources").join("wintun.dll")];
    if cfg!(debug_assertions) {
        tries.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("vendor").join("wintun").join("wintun.dll"));
    }
    tries.into_iter().find(|p| p.is_file()).ok_or_else(|| "wintun.dll is missing from the program folder.".to_string())
}

fn run_tunnel(dir: &Path, name: &str, log: &Log) -> Result<(), String> {
    let text = fs::read_to_string(dir.join(format!("{name}.conf"))).map_err(|_| "The tunnel file could not be read.".to_string())?;
    let cfg = vpnconf::parse(&text)?;
    let secret = StaticSecret::from(decode_key(&cfg.private_key)?);

    // 1. Sockets first, while the normal route to the server still exists.
    let mut peers: Vec<Arc<PeerRun>> = Vec::new();
    for (i, p) in cfg.peers.iter().enumerate() {
        let ep = p.endpoint.as_ref().ok_or("A peer has no Endpoint, so this tunnel cannot connect out.")?;
        let addr = ep
            .to_socket_addrs()
            .map_err(|_| format!("Could not look up the server address {ep}."))?
            .min_by_key(|a| a.is_ipv6())
            .ok_or("The server address did not resolve.")?;
        // One port cannot serve two sockets, so only the first peer uses ListenPort.
        let lp = if i == 0 { cfg.listen_port.unwrap_or(0) } else { 0 };
        let bind: SocketAddr = if addr.is_ipv4() { ([0, 0, 0, 0], lp).into() } else { ([0u16; 8], lp).into() };
        let sock = UdpSocket::bind(bind).map_err(|e| format!("Could not open a network socket: {e}"))?;
        if let Some(ix) = best_interface(addr) {
            pin_to_interface(&sock, addr.is_ipv6(), ix);
        }
        sock.connect(addr).map_err(|e| e.to_string())?;
        sock.set_read_timeout(Some(Duration::from_millis(500))).ok();
        let psk = match &p.preshared_key {
            Some(k) => Some(decode_key(k)?),
            None => None,
        };
        let tunn = Tunn::new(secret.clone(), PublicKey::from(decode_key(&p.public_key)?), psk, p.keepalive, (i as u32 + 1) << 8, None)
            .map_err(|e| e.to_string())?;
        let allowed = p.allowed_ips.iter().filter_map(|a| parse_net(a)).collect();
        peers.push(Arc::new(PeerRun { sent: AtomicU64::new(0), got: AtomicU64::new(0), tunn: Mutex::new(tunn), sock, allowed }));
        log.line(&format!("peer {} resolved", i + 1));
    }

    let mut answered_any = false;
    // Say hello now, before any routes change, so a dead server or a wrong key shows up as a clear message.
    for (i, p) in peers.iter().enumerate() {
        let mut buf = vec![0u8; 2048];
        if let Ok(mut t) = p.tunn.lock() {
            if let TunnResult::WriteToNetwork(d) = t.encapsulate(&[], &mut buf) {
                send_net(p, d);
            }
        }
        let mut inb = vec![0u8; 2048];
        let mut out = vec![0u8; 2048];
        let started = Instant::now();
        let mut answered = false;
        while started.elapsed() < Duration::from_secs(5) && !answered {
            let Ok(n) = p.sock.recv(&mut inb) else { continue };
            let ip = p.sock.peer_addr().map(|a| a.ip()).ok();
            if let Ok(mut t) = p.tunn.lock() {
                if let TunnResult::WriteToNetwork(d) = t.decapsulate(ip, &inb[..n], &mut out) {
                    send_net(p, d);
                    answered = true;
                }
            }
        }
        answered_any |= answered;
        log.line(&format!("peer {}: server {}", i + 1, if answered { "answered the handshake" } else { "did not answer within 5 seconds" }));
    }

    if !answered_any {
        return Err("The server did not answer the handshake. Check the server address and keys.".into());
    }

    // 2. The adapter.
    let dll = dll_path()?;
    // SAFETY: loading the WireGuard project's signed Wintun library from our own program folder.
    let wintun = unsafe { wintun::load_from_path(&dll) }.map_err(|e| format!("Could not load wintun.dll: {e}"))?;
    let adapter = wintun::Adapter::create(&wintun, name, "Network Toolkit", None)
        .map_err(|e| format!("Could not create the network adapter: {e}"))?;
    let session = Arc::new(adapter.start_session(wintun::MAX_RING_CAPACITY).map_err(|e| format!("Could not start the adapter: {e}"))?);
    log.line("adapter created");

    // 3. Address, routes and DNS.
    let eps: Vec<IpAddr> = peers.iter().filter_map(|p| p.sock.peer_addr().ok().map(|a| a.ip())).collect();
    let ifc = adapter.get_adapter_index().map_err(|e| format!("Could not read the adapter index: {e}"))?;
    configure(ifc, &cfg, &eps, log)?;
    log.line("network configured");

    // Kill switch (only when the user turned it on for this tunnel). Filters die with this process.
    let _killswitch = if read_options(dir, name).killswitch {
        let luid = unsafe { adapter.get_luid().Value };
        let ends: Vec<SocketAddr> = peers.iter().filter_map(|p| p.sock.peer_addr().ok()).collect();
        let ks = crate::killswitch::KillSwitch::enable(luid, &ends)?;
        log.line("kill switch on: traffic outside the tunnel is blocked");
        Some(ks)
    } else {
        None
    };
    let kill_on = _killswitch.is_some();

    // 4. The packet loops.
    let stop = Arc::new(AtomicBool::new(false));
    let dead = Arc::new(AtomicBool::new(false));
    for p in &peers {
        // Starts the handshake right away.
        let mut buf = vec![0u8; 2048];
        if let Ok(mut t) = p.tunn.lock() {
            if let TunnResult::WriteToNetwork(d) = t.encapsulate(&[], &mut buf) {
                send_net(p, d);
            }
        }
        // network -> adapter
        let (p2, s2, st2) = (p.clone(), session.clone(), stop.clone());
        thread::spawn(move || {
            let mut inb = vec![0u8; 65535];
            let mut out = vec![0u8; 65535];
            while !st2.load(Ordering::Relaxed) {
                let n = match p2.sock.recv(&mut inb) {
                    Ok(n) => n,
                    Err(_) => continue,
                };
                p2.got.fetch_add(1, Ordering::Relaxed);
                let peer_ip = p2.sock.peer_addr().map(|a| a.ip()).ok();
                let mut data: &[u8] = &inb[..n];
                loop {
                    let Ok(mut t) = p2.tunn.lock() else { break };
                    match t.decapsulate(peer_ip, data, &mut out) {
                        TunnResult::WriteToNetwork(d) => {
                            send_net(&p2, d);
                            data = &[];
                            drop(t);
                            continue;
                        }
                        TunnResult::WriteToTunnelV4(d, src) => {
                            if p2.allowed.iter().any(|a| contains(*a, IpAddr::V4(src))) {
                                if let Ok(mut pk) = s2.allocate_send_packet(d.len() as u16) {
                                    pk.bytes_mut().copy_from_slice(d);
                                    s2.send_packet(pk);
                                }
                            }
                        }
                        TunnResult::WriteToTunnelV6(d, src) => {
                            if p2.allowed.iter().any(|a| contains(*a, IpAddr::V6(src))) {
                                if let Ok(mut pk) = s2.allocate_send_packet(d.len() as u16) {
                                    pk.bytes_mut().copy_from_slice(d);
                                    s2.send_packet(pk);
                                }
                            }
                        }
                        _ => {}
                    }
                    break;
                }
            }
        });
        // timers
        let (p3, st3) = (p.clone(), stop.clone());
        thread::spawn(move || {
            let mut out = vec![0u8; 2048];
            while !st3.load(Ordering::Relaxed) {
                thread::sleep(Duration::from_millis(250));
                if let Ok(mut t) = p3.tunn.lock() {
                    if let TunnResult::WriteToNetwork(d) = t.update_timers(&mut out) {
                        send_net(&p3, d);
                    }
                }
            }
        });
    }
    // adapter -> network
    {
        let (peers2, s2, st2, dead2) = (peers.clone(), session.clone(), stop.clone(), dead.clone());
        thread::spawn(move || {
            let mut out = vec![0u8; 65535];
            while !st2.load(Ordering::Relaxed) {
                let pk = match s2.receive_blocking() {
                    Ok(p) => p,
                    Err(_) => break,
                };
                let data = pk.bytes();
                let Some(dst) = packet_dst(data) else { continue };
                if peers2.iter().any(|p| p.sock.peer_addr().map(|a| a.ip() == dst).unwrap_or(false)) {
                    continue;
                }
                // The most specific range wins.
                let best = peers2
                    .iter()
                    .filter_map(|p| p.allowed.iter().filter(|a| contains(**a, dst)).map(|a| a.len).max().map(|l| (l, p)))
                    .max_by_key(|(l, _)| *l)
                    .map(|(_, p)| p);
                if let Some(p) = best {
                    if let Ok(mut t) = p.tunn.lock() {
                        if let TunnResult::WriteToNetwork(d) = t.encapsulate(data, &mut out) {
                            send_net(p, d);
                        }
                    }
                }
            }
            dead2.store(true, Ordering::Relaxed);
        });
    }

    let _ = fs::write(state_path(dir, name), format!("up {}", std::process::id()));
    log.line("tunnel up");

    // 5. Wait for a stop request.
    let stop_file = stop_path(dir, name);
    let started = Instant::now();
    let mut last_report = Instant::now();
    let mut warned_dead = false;
    loop {
        if stop_file.exists() {
            log.line("stop requested");
            break;
        }
        if dead.load(Ordering::Relaxed) && started.elapsed() > Duration::from_secs(2) {
            if !kill_on {
                log.line("adapter closed unexpectedly");
                break;
            }
            if !warned_dead {
                warned_dead = true;
                log.line("adapter closed unexpectedly; the kill switch keeps traffic blocked until you press Deactivate");
            }
        }
        thread::sleep(Duration::from_millis(250));
        if last_report.elapsed() > Duration::from_secs(5) {
            last_report = Instant::now();
            for (i, p) in peers.iter().enumerate() {
                let hs = p.tunn.lock().ok().and_then(|t| t.time_since_last_handshake()).map(|d| d.as_secs());
                log.line(&format!("peer {}: sent {} datagrams, received {}, last handshake {:?}s ago", i + 1, p.sent.load(Ordering::Relaxed), p.got.load(Ordering::Relaxed), hs));
            }
        }
    }
    stop.store(true, Ordering::Relaxed);
    let _ = session.shutdown();
    thread::sleep(Duration::from_millis(300));
    drop(session);
    drop(adapter);
    Ok(())
}

/// True when the folder, or any folder above it, is a junction or symbolic link. The elevated copy refuses such a
/// folder, because a link could point its log, state and stop files at somewhere the user should not reach.
pub fn has_reparse_point(path: &Path) -> bool {
    use std::os::windows::fs::MetadataExt;
    const REPARSE: u32 = 0x400;
    let mut cur = Some(path);
    while let Some(p) = cur {
        if !p.as_os_str().is_empty() {
            match fs::symlink_metadata(p) {
                Ok(m) if m.file_attributes() & REPARSE != 0 => return true,
                Ok(_) => {}
                Err(_) => return true,
            }
        }
        cur = p.parent();
    }
    false
}

/// Entry point of the elevated copy. Returns the process exit code.
pub fn run(dir: &str, name: &str) -> i32 {
    let dir = PathBuf::from(dir);
    if !vpnconf::valid_name(name) || !dir.is_dir() || has_reparse_point(&dir) {
        return 2;
    }
    let _ = fs::remove_file(stop_path(&dir, name));
    let Ok(file) = fs::File::create(log_path(&dir, name)) else {
        let _ = fs::write(state_path(&dir, name), "error The tunnel log file could not be created.");
        return 2;
    };
    let log = Log(Mutex::new(file));
    let _ = fs::write(state_path(&dir, name), format!("starting {}", std::process::id()));
    let result = run_tunnel(&dir, name, &log);
    let _ = fs::remove_file(stop_path(&dir, name));
    match result {
        Ok(()) => {
            let _ = fs::remove_file(state_path(&dir, name));
            0
        }
        Err(e) => {
            log.line(&format!("error: {e}"));
            let _ = fs::write(state_path(&dir, name), format!("error {e}"));
            1
        }
    }
}

/// For tests: the checked config for a text.
pub fn parse_for_tests(text: &str) -> Result<Config, String> {
    vpnconf::parse(text)
}
