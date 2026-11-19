//! Reads one captured frame into a table row, and decides whether a frame may be replayed.
//! Kept free of window and driver code so the tests can build it on its own.

use crate::netaddr::{is_local_v4, is_local_v6};
use etherparse::{IpNumber, LaxNetSlice, LaxSlicedPacket, TransportSlice};
use serde::Serialize;

#[derive(Serialize, Clone, Debug)]
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

fn hex_head(bytes: &[u8]) -> String {
    bytes.iter().take(32).map(|b| format!("{b:02x}")).collect()
}

/// Name for an IP payload that has no TCP, UDP or ICMP part we read.
fn ip_payload_name(n: IpNumber, fallback: &'static str) -> &'static str {
    match n {
        IpNumber::IGMP => "IGMP",
        IpNumber::GRE => "GRE",
        IpNumber::ENCAPSULATING_SECURITY_PAYLOAD => "ESP",
        IpNumber::AUTHENTICATION_HEADER => "AH",
        _ => fallback,
    }
}

pub const LINK_ETHERNET: u32 = 1;

/// Name of a capture link type, as Wireshark lists them.
pub fn link_name(link: u32) -> String {
    match link {
        0 => "BSD loopback".into(),
        1 => "Ethernet".into(),
        12 | 14 | 101 => "Raw IP".into(),
        108 => "OpenBSD loopback".into(),
        113 => "Linux cooked (SLL)".into(),
        228 => "Raw IPv4".into(),
        229 => "Raw IPv6".into(),
        276 => "Linux cooked v2 (SLL2)".into(),
        105 => "IEEE 802.11 Wi-Fi".into(),
        n => format!("link type {n}"),
    }
}

/// Link types the app can read IP packets from.
pub fn link_supported(link: u32) -> bool {
    matches!(link, 0 | 1 | 12 | 14 | 101 | 108 | 113 | 228 | 229 | 276)
}

/// Where the IP header starts in a frame of this link type. `None` when the frame carries no IP packet
/// (or the link type is not supported). Ethernet is handled by the Ethernet parser, which also skips VLAN tags.
pub fn ip_offset(data: &[u8], link: u32) -> Option<usize> {
    let version_at = |o: usize| data.get(o).map(|b| b >> 4).filter(|v| *v == 4 || *v == 6).map(|_| o);
    match link {
        0 | 108 => version_at(4),
        12 | 14 | 101 | 228 | 229 => version_at(0),
        113 => version_at(16),
        276 => version_at(20),
        _ => None,
    }
}

/// Parses a frame of any supported link type.
fn parse_lax(data: &[u8], link: u32) -> Option<LaxSlicedPacket<'_>> {
    if link == LINK_ETHERNET {
        LaxSlicedPacket::from_ethernet(data).ok()
    } else {
        LaxSlicedPacket::from_ip(data.get(ip_offset(data, link)?..)?).ok()
    }
}

/// Returns the row and whether the frame is cut short (its IP header promises more bytes than
/// are present). Frames that are not IPv4 or IPv6 (ARP, for example) give `None`.
/// Parsing is lax: frames cut at the snap length, or captured before the network card filled in
/// the IP length (large-send offload), still show up.
#[allow(dead_code)]
pub fn summarize(data: &[u8], wire_len: u32, time: f64) -> Option<(PacketRow, bool)> {
    summarize_link(data, LINK_ETHERNET, wire_len, time)
}

/// Same as `summarize` for a frame from an interface with this link type.
pub fn summarize_link(data: &[u8], link: u32, wire_len: u32, time: f64) -> Option<(PacketRow, bool)> {
    let parsed = parse_lax(data, link)?;
    let (src, dst, ip_proto, payload) = match parsed.net.as_ref()? {
        LaxNetSlice::Ipv4(ip) => {
            let h = ip.header();
            (h.source_addr().to_string(), h.destination_addr().to_string(), "IPv4", ip.payload())
        }
        LaxNetSlice::Ipv6(ip) => {
            let h = ip.header();
            (h.source_addr().to_string(), h.destination_addr().to_string(), "IPv6", ip.payload())
        }
        _ => return None,
    };
    let (protocol, src_port, dst_port) = match parsed.transport.as_ref() {
        Some(TransportSlice::Tcp(t)) => ("TCP", Some(t.source_port()), Some(t.destination_port())),
        Some(TransportSlice::Udp(u)) => ("UDP", Some(u.source_port()), Some(u.destination_port())),
        Some(TransportSlice::Icmpv4(_)) => ("ICMP", None, None),
        Some(TransportSlice::Icmpv6(_)) => ("ICMPv6", None, None),
        None => (ip_payload_name(payload.ip_number, ip_proto), None, None),
    };
    let body: &[u8] = match parsed.transport.as_ref() {
        Some(TransportSlice::Tcp(t)) => t.payload(),
        Some(TransportSlice::Udp(u)) => u.payload(),
        _ => &[],
    };
    let row = PacketRow { id: 0, time, src, dst, src_port, dst_port, protocol: protocol.into(), length: wire_len, head: hex_head(body) };
    Some((row, payload.incomplete))
}

/// Replay is for testing your own network, so both ends of the packet must be devices inside it.
/// A packet from or to an internet address is refused, so the app cannot put forged internet
/// traffic onto your network.
pub fn both_ends_local(data: &[u8]) -> Result<(), String> {
    let parsed = LaxSlicedPacket::from_ethernet(data).map_err(|_| "This packet cannot be read, so it was not sent.".to_string())?;
    let ok = match parsed.net.as_ref() {
        Some(LaxNetSlice::Ipv4(ip)) => is_local_v4(ip.header().source_addr()) && is_local_v4(ip.header().destination_addr()),
        Some(LaxNetSlice::Ipv6(ip)) => is_local_v6(ip.header().source_addr()) && is_local_v6(ip.header().destination_addr()),
        _ => false,
    };
    if ok { Ok(()) } else { Err("Replay only works for packets between two devices on your own network. This one involves an address outside it.".into()) }
}
