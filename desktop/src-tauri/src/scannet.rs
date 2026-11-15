//! The address arithmetic and text parsing behind the network scan. No sockets and no window
//! code, so the tests can build it on its own.

use std::net::Ipv4Addr;

pub const MAX_HOSTS: u32 = 256;

fn mask_of(prefix: u8) -> u32 {
    (!0u32).checked_shl(32 - u32::from(prefix.min(32))).unwrap_or(0)
}

/// Decides the subnet size to scan from the prefix of the connected adapter (`None` = unknown,
/// assume a /24). A /31 or /32 is how tunnels and VPN adapters look, and there is nothing
/// useful to scan there, so that is an error rather than a made-up network.
pub fn pick_prefix(found: Option<u8>) -> Result<u8, String> {
    match found {
        None => Ok(24),
        Some(p) if p > 30 => Err(
            "The connected network adapter has a single-address network (typical of a VPN or tunnel), so there is nothing to scan. Disconnect the VPN, or connect to your home or office network.".into(),
        ),
        Some(p) => Ok(p.clamp(24, 30)), // never wider than a /24
    }
}

/// Turns the user's optional target ("" , "192.168.0.7" or "192.168.0.0/28") into addresses,
/// and refuses anything outside the local subnet.
pub fn targets(own: Ipv4Addr, prefix: u8, text: &str) -> Result<Vec<Ipv4Addr>, String> {
    let text = text.trim();
    let mask = mask_of(prefix);
    let net = u32::from(own) & mask;
    let bcast = net | !mask;
    // Addresses that are not devices: the network's own first and last address, and for a
    // typed range also that range's first and last address.
    let mut skip = vec![net, bcast];
    let (start, end) = if text.is_empty() {
        (net.saturating_add(1), bcast.saturating_sub(1))
    } else if let Some((ip, bits)) = text.split_once('/') {
        let ip: Ipv4Addr = ip.trim().parse().map_err(|_| "That is not a valid address range.".to_string())?;
        let bits: u8 = bits.trim().parse().map_err(|_| "That is not a valid address range.".to_string())?;
        if !(24..=32).contains(&bits) {
            return Err("Use a range of /24 or smaller (at most 256 addresses).".into());
        }
        let m = mask_of(bits);
        let (s, e) = (u32::from(ip) & m, (u32::from(ip) & m) | !m);
        if bits <= 30 {
            skip.extend([s, e]);
        }
        (s, e)
    } else {
        let ip: Ipv4Addr = text.parse().map_err(|_| "That is not a valid address.".to_string())?;
        (u32::from(ip), u32::from(ip))
    };
    if start < net || end > bcast {
        return Err("You can only scan the network this computer is on.".into());
    }
    if i64::from(end) - i64::from(start) + 1 > i64::from(MAX_HOSTS) {
        return Err("A scan is limited to 256 addresses.".into());
    }
    let list: Vec<Ipv4Addr> = (start..=end).filter(|a| !skip.contains(a)).map(Ipv4Addr::from).collect();
    if list.is_empty() {
        return Err("That address is the network's first or last address, not a device. Pick a device address.".into());
    }
    Ok(list)
}

/// IPv4 -> MAC pairs from the text of `arp -a`. Does not depend on the Windows display language:
/// a line counts when it starts with an IPv4 address followed by a MAC written as six hex pairs.
/// Entries Windows marks "invalid", all-zero and broadcast MACs are skipped.
pub fn parse_arp(text: &str) -> Vec<(Ipv4Addr, String)> {
    text.lines()
        .filter_map(|l| {
            let mut it = l.split_whitespace();
            let ip: Ipv4Addr = it.next()?.parse().ok()?;
            let mac = it.next()?;
            if !is_mac(mac) {
                return None;
            }
            if it.any(|w| w.eq_ignore_ascii_case("invalid")) {
                return None;
            }
            let digits: String = mac.chars().filter(|c| c.is_ascii_hexdigit()).collect::<String>().to_ascii_lowercase();
            if digits == "000000000000" || digits == "ffffffffffff" {
                return None;
            }
            Some((ip, mac.to_string()))
        })
        .collect()
}

fn is_mac(s: &str) -> bool {
    let sep = if s.contains('-') { '-' } else { ':' };
    let parts: Vec<&str> = s.split(sep).collect();
    parts.len() == 6 && parts.iter().all(|p| p.len() == 2 && p.chars().all(|c| c.is_ascii_hexdigit()))
}
