//! Reads and checks WireGuard tunnel files (.conf). The file is parsed, every value is validated, and a clean
//! copy is written back out, so nothing the parser did not understand ever reaches the engine.
//! Settings that run commands (PreUp, PostUp, PreDown, PostDown) are refused: the engine runs with administrator rights.

use base64::{engine::general_purpose::STANDARD, Engine};

#[derive(Debug, Default, Clone, PartialEq)]
pub struct Peer {
    pub public_key: String,
    pub preshared_key: Option<String>,
    pub allowed_ips: Vec<String>,
    pub endpoint: Option<String>,
    pub keepalive: Option<u16>,
}

#[derive(Debug, Default, Clone, PartialEq)]
pub struct Config {
    pub private_key: String,
    pub addresses: Vec<String>,
    pub dns: Vec<String>,
    pub mtu: Option<u16>,
    pub listen_port: Option<u16>,
    pub peers: Vec<Peer>,
}

pub const MAX_CONF_BYTES: usize = 16 * 1024;

/// True for names Windows reserves for devices (CON, PRN, AUX, NUL, COM1-9, LPT1-9), with or without an extension.
fn is_reserved_device(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or("").trim_end().to_ascii_lowercase();
    matches!(stem.as_str(), "con" | "prn" | "aux" | "nul")
        || (stem.len() == 4 && (stem.starts_with("com") || stem.starts_with("lpt")) && matches!(stem.as_bytes()[3], b'1'..=b'9'))
}

/// WireGuard's own rule for tunnel names, which are also the Windows service names, minus Windows device names.
pub fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 32
        && name.chars().all(|c| c.is_ascii_alphanumeric() || "_=+.-".contains(c))
        && !is_reserved_device(name)
}

fn key(v: &str, what: &str) -> Result<String, String> {
    let v = v.trim();
    match STANDARD.decode(v) {
        Ok(b) if b.len() == 32 && v.len() == 44 => Ok(v.to_string()),
        _ => Err(format!("{what} is not a valid WireGuard key (44 characters ending in =).")),
    }
}

fn port(v: &str, what: &str) -> Result<u16, String> {
    match v.trim().parse::<u16>() {
        Ok(p) if p >= 1 => Ok(p),
        _ => Err(format!("{what} must be a number from 1 to 65535.")),
    }
}

fn ip(v: &str) -> bool {
    v.parse::<std::net::IpAddr>().is_ok()
}

fn cidr(v: &str, what: &str) -> Result<String, String> {
    let v = v.trim();
    let (addr, bits) = match v.split_once('/') {
        Some((a, b)) => (a, Some(b)),
        None => (v, None),
    };
    let parsed: std::net::IpAddr = addr.parse().map_err(|_| format!("{what} has an address that is not valid: {v}"))?;
    if let Some(b) = bits {
        let max = if parsed.is_ipv4() { 32 } else { 128 };
        match b.parse::<u8>() {
            Ok(n) if n <= max => {}
            _ => return Err(format!("{what} has a prefix length that is not valid: {v}")),
        }
    }
    Ok(v.to_string())
}

fn host(h: &str) -> bool {
    !h.is_empty()
        && h.len() <= 253
        && h.split('.').all(|l| !l.is_empty() && l.len() <= 63 && l.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'))
}

fn endpoint(v: &str) -> Result<String, String> {
    let v = v.trim();
    let bad = || format!("Endpoint must look like host:port or [ipv6]:port, not {v}.");
    let (h, p) = if let Some(rest) = v.strip_prefix('[') {
        let (h, p) = rest.split_once("]:").ok_or_else(bad)?;
        if !ip(h) {
            return Err(bad());
        }
        (h, p)
    } else {
        let (h, p) = v.rsplit_once(':').ok_or_else(bad)?;
        if !(ip(h) || host(h)) {
            return Err(bad());
        }
        (h, p)
    };
    let p = port(p, "The endpoint port")?;
    Ok(if h.contains(':') { format!("[{h}]:{p}") } else { format!("{h}:{p}") })
}

fn list(v: &str) -> Vec<&str> {
    v.split(',').map(str::trim).filter(|s| !s.is_empty()).collect()
}

pub fn parse(text: &str) -> Result<Config, String> {
    if text.len() > MAX_CONF_BYTES {
        return Err("That file is too large to be a WireGuard tunnel.".into());
    }
    let mut cfg = Config::default();
    let mut section = "";
    let mut have_interface = false;
    let mut have_key = false;
    for (n, raw) in text.lines().enumerate() {
        let line = raw.split('#').next().unwrap_or("").trim();
        if line.is_empty() {
            continue;
        }
        let at = |m: String| format!("Line {}: {m}", n + 1);
        if line.starts_with('[') {
            section = match line.to_ascii_lowercase().as_str() {
                "[interface]" => {
                    if have_interface {
                        return Err(at("There can be only one [Interface] section.".into()));
                    }
                    have_interface = true;
                    "interface"
                }
                "[peer]" => {
                    cfg.peers.push(Peer::default());
                    "peer"
                }
                _ => return Err(at(format!("Unknown section {line}."))),
            };
            continue;
        }
        let (k, v) = line.split_once('=').ok_or_else(|| at("Expected name = value.".into()))?;
        let (k, v) = (k.trim().to_ascii_lowercase(), v.trim());
        match (section, k.as_str()) {
            ("", _) => return Err(at("A setting appears before any section.".into())),
            ("interface", "privatekey") => {
                cfg.private_key = key(v, "PrivateKey").map_err(&at)?;
                have_key = true;
            }
            ("interface", "address") => {
                for a in list(v) {
                    cfg.addresses.push(cidr(a, "Address").map_err(&at)?);
                }
            }
            ("interface", "dns") => {
                for d in list(v) {
                    if !(ip(d) || host(d)) {
                        return Err(at(format!("DNS entry is not valid: {d}")));
                    }
                    cfg.dns.push(d.to_string());
                }
            }
            ("interface", "mtu") => match v.parse::<u16>() {
                Ok(m) if (576..=9000).contains(&m) => cfg.mtu = Some(m),
                _ => return Err(at("MTU must be a number from 576 to 9000.".into())),
            },
            ("interface", "listenport") => cfg.listen_port = Some(port(v, "ListenPort").map_err(&at)?),
            ("interface", "preup" | "postup" | "predown" | "postdown") => {
                return Err(at(format!(
                    "{} runs a command with full system rights, so this app refuses it. Remove that line, or add the tunnel in the WireGuard app itself.",
                    k
                )))
            }
            ("peer", "publickey") => cfg.peers.last_mut().unwrap().public_key = key(v, "PublicKey").map_err(&at)?,
            ("peer", "presharedkey") => cfg.peers.last_mut().unwrap().preshared_key = Some(key(v, "PresharedKey").map_err(&at)?),
            ("peer", "allowedips") => {
                for a in list(v) {
                    cfg.peers.last_mut().unwrap().allowed_ips.push(cidr(a, "AllowedIPs").map_err(&at)?);
                }
            }
            ("peer", "endpoint") => cfg.peers.last_mut().unwrap().endpoint = Some(endpoint(v).map_err(&at)?),
            ("peer", "persistentkeepalive") => match v.to_ascii_lowercase().as_str() {
                "off" => cfg.peers.last_mut().unwrap().keepalive = None,
                s => match s.parse::<u16>() {
                    Ok(p) => cfg.peers.last_mut().unwrap().keepalive = Some(p),
                    _ => return Err(at("PersistentKeepalive must be a number of seconds, or off.".into())),
                },
            },
            (s, other) => return Err(at(format!("The setting {other} is not supported in the [{s}] section."))),
        }
    }
    if !have_interface || !have_key {
        return Err("The file needs an [Interface] section with a PrivateKey.".into());
    }
    if cfg.addresses.is_empty() {
        return Err("The [Interface] section needs an Address.".into());
    }
    if cfg.peers.is_empty() {
        return Err("The file needs at least one [Peer] section.".into());
    }
    if cfg.peers.iter().any(|p| p.public_key.is_empty()) {
        return Err("Every [Peer] needs a PublicKey.".into());
    }
    Ok(cfg)
}

/// A clean file built only from the checked values.
pub fn render(c: &Config) -> String {
    let mut s = String::from("[Interface]\n");
    s += &format!("PrivateKey = {}\n", c.private_key);
    s += &format!("Address = {}\n", c.addresses.join(", "));
    if !c.dns.is_empty() {
        s += &format!("DNS = {}\n", c.dns.join(", "));
    }
    if let Some(m) = c.mtu {
        s += &format!("MTU = {m}\n");
    }
    if let Some(p) = c.listen_port {
        s += &format!("ListenPort = {p}\n");
    }
    for p in &c.peers {
        s += &format!("\n[Peer]\nPublicKey = {}\n", p.public_key);
        if let Some(k) = &p.preshared_key {
            s += &format!("PresharedKey = {k}\n");
        }
        if !p.allowed_ips.is_empty() {
            s += &format!("AllowedIPs = {}\n", p.allowed_ips.join(", "));
        }
        if let Some(e) = &p.endpoint {
            s += &format!("Endpoint = {e}\n");
        }
        if let Some(k) = p.keepalive {
            s += &format!("PersistentKeepalive = {k}\n");
        }
    }
    s
}
