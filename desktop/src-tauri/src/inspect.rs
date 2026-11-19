//! Decodes a captured frame into named fields with the byte range each one covers, for the HEX
//! inspector. It only reads the bytes; nothing here changes or copies packet data.

use crate::packet::{ip_offset, LINK_ETHERNET};
use serde::Serialize;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Field {
    pub name: String,
    pub value: String,
    /// Byte offset from the start of the captured frame.
    pub start: usize,
    pub len: usize,
    /// 0 for a header, 1 for a field inside it.
    pub depth: u8,
}

struct Out<'a> {
    data: &'a [u8],
    fields: Vec<Field>,
}

impl Out<'_> {
    /// Adds a field if every byte of it was captured. Returns false when the frame is cut short.
    fn field(&mut self, name: &str, start: usize, len: usize, value: impl FnOnce(&[u8]) -> String) -> bool {
        match self.data.get(start..start + len) {
            Some(b) => {
                self.fields.push(Field { name: name.into(), value: value(b), start, len, depth: 1 });
                true
            }
            None => false,
        }
    }

    fn header(&mut self, name: &str, start: usize, len: usize, value: &str) {
        let len = len.min(self.data.len().saturating_sub(start));
        if len > 0 {
            self.fields.push(Field { name: name.into(), value: value.into(), start, len, depth: 0 });
        }
    }
}

fn be16(b: &[u8]) -> u16 {
    u16::from_be_bytes([b[0], b[1]])
}

fn be32(b: &[u8]) -> u32 {
    u32::from_be_bytes([b[0], b[1], b[2], b[3]])
}

fn mac(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect::<Vec<_>>().join(":")
}

fn v4(b: &[u8]) -> String {
    std::net::Ipv4Addr::new(b[0], b[1], b[2], b[3]).to_string()
}

fn v6(b: &[u8]) -> String {
    let mut a = [0u8; 16];
    a.copy_from_slice(&b[..16]);
    std::net::Ipv6Addr::from(a).to_string()
}

fn ethertype_name(t: u16) -> &'static str {
    match t {
        0x0800 => "IPv4",
        0x86dd => "IPv6",
        0x0806 => "ARP",
        0x8100 => "VLAN",
        0x88a8 => "VLAN (S-tag)",
        _ => "",
    }
}

fn proto_name(p: u8) -> &'static str {
    match p {
        1 => "ICMP",
        2 => "IGMP",
        6 => "TCP",
        17 => "UDP",
        41 => "IPv6",
        47 => "GRE",
        50 => "ESP",
        51 => "AH",
        58 => "ICMPv6",
        _ => "",
    }
}

fn labelled(n: u32, name: &str) -> String {
    if name.is_empty() { format!("{n}") } else { format!("{n} ({name})") }
}

/// The fields of a frame, headers first. A frame cut short just has fewer fields. Frames with an
/// unsupported link type come back empty.
pub fn decode(data: &[u8], link: u32) -> Vec<Field> {
    let mut o = Out { data, fields: Vec::new() };
    let ip_at = if link == LINK_ETHERNET { ethernet(&mut o) } else { other_link(&mut o, link) };
    if let Some(at) = ip_at {
        ip(&mut o, at);
    }
    o.fields
}

/// Ethernet header and any VLAN tags. Returns where the IP header starts, if the frame carries IP.
fn ethernet(o: &mut Out) -> Option<usize> {
    if o.data.len() < 14 {
        return None;
    }
    o.header("Ethernet", 0, 14, "");
    o.field("Destination", 0, 6, |b| mac(b));
    o.field("Source", 6, 6, |b| mac(b));
    let mut at = 12;
    let mut ty = be16(&o.data[12..14]);
    while (ty == 0x8100 || ty == 0x88a8) && o.data.len() >= at + 6 {
        let tci = be16(&o.data[at + 2..at + 4]);
        o.field("VLAN", at + 2, 2, |_| format!("id {}, priority {}", tci & 0x0fff, tci >> 13));
        at += 4;
        ty = be16(&o.data[at..at + 2]);
    }
    o.field("Type", at, 2, |b| {
        let t = be16(b);
        let n = ethertype_name(t);
        if n.is_empty() { format!("0x{t:04x}") } else { format!("0x{t:04x} ({n})") }
    });
    (ty == 0x0800 || ty == 0x86dd).then_some(at + 2)
}

fn other_link(o: &mut Out, link: u32) -> Option<usize> {
    let at = ip_offset(o.data, link)?;
    let name = crate::packet::link_name(link);
    if at > 0 {
        o.header(&name, 0, at, "");
        o.field("Link header", 0, at, |b| format!("{} bytes", b.len()));
    }
    Some(at)
}

fn ip(o: &mut Out, at: usize) {
    match o.data.get(at).map(|b| b >> 4) {
        Some(4) => ipv4(o, at),
        Some(6) => ipv6(o, at),
        _ => {}
    }
}

fn ipv4(o: &mut Out, at: usize) {
    if o.data.len() < at + 20 {
        o.header("IPv4", at, 20, "cut short");
        return;
    }
    let ihl = (o.data[at] & 0x0f) as usize * 4;
    o.header("IPv4", at, ihl.max(20), "");
    o.field("Version / header length", at, 1, |b| format!("{}, {} bytes", b[0] >> 4, (b[0] & 0x0f) as usize * 4));
    o.field("Type of service", at + 1, 1, |b| format!("0x{:02x}", b[0]));
    o.field("Total length", at + 2, 2, |b| be16(b).to_string());
    o.field("Identification", at + 4, 2, |b| format!("0x{:04x}", be16(b)));
    o.field("Flags / fragment offset", at + 6, 2, |b| {
        let w = be16(b);
        let flags = [(w & 0x4000 != 0, "DF"), (w & 0x2000 != 0, "MF")].iter().filter(|(on, _)| *on).map(|(_, n)| *n).collect::<Vec<_>>().join(" ");
        format!("{}offset {}", if flags.is_empty() { String::new() } else { format!("{flags}, ") }, (w & 0x1fff) * 8)
    });
    o.field("Time to live", at + 8, 1, |b| b[0].to_string());
    let proto = o.data[at + 9];
    o.field("Protocol", at + 9, 1, |b| labelled(b[0] as u32, proto_name(b[0])));
    o.field("Header checksum", at + 10, 2, |b| format!("0x{:04x}", be16(b)));
    o.field("Source", at + 12, 4, |b| v4(b));
    o.field("Destination", at + 16, 4, |b| v4(b));
    if ihl > 20 {
        o.field("Options", at + 20, ihl - 20, |b| format!("{} bytes", b.len()));
    }
    let frag = be16(&o.data[at + 6..at + 8]) & 0x1fff;
    if ihl >= 20 && frag == 0 {
        transport(o, at + ihl, proto);
    } else if ihl >= 20 {
        payload(o, at + ihl, "Fragment data");
    }
}

fn ipv6(o: &mut Out, at: usize) {
    if o.data.len() < at + 40 {
        o.header("IPv6", at, 40, "cut short");
        return;
    }
    o.header("IPv6", at, 40, "");
    o.field("Version / class / flow", at, 4, |b| format!("version {}, flow 0x{:05x}", b[0] >> 4, be32(b) & 0xfffff));
    o.field("Payload length", at + 4, 2, |b| be16(b).to_string());
    let next = o.data[at + 6];
    o.field("Next header", at + 6, 1, |b| labelled(b[0] as u32, proto_name(b[0])));
    o.field("Hop limit", at + 7, 1, |b| b[0].to_string());
    o.field("Source", at + 8, 16, |b| v6(b));
    o.field("Destination", at + 24, 16, |b| v6(b));
    if matches!(next, 6 | 17 | 58) {
        transport(o, at + 40, next);
    } else {
        payload(o, at + 40, "Extension headers and payload");
    }
}

fn transport(o: &mut Out, at: usize, proto: u8) {
    match proto {
        6 => tcp(o, at),
        17 => udp(o, at),
        1 | 58 => icmp(o, at, if proto == 1 { "ICMP" } else { "ICMPv6" }),
        _ => payload(o, at, "Payload"),
    }
}

fn tcp(o: &mut Out, at: usize) {
    if o.data.len() < at + 20 {
        o.header("TCP", at, 20, "cut short");
        return;
    }
    let off = ((o.data[at + 12] >> 4) as usize * 4).max(20);
    o.header("TCP", at, off, "");
    o.field("Source port", at, 2, |b| be16(b).to_string());
    o.field("Destination port", at + 2, 2, |b| be16(b).to_string());
    o.field("Sequence number", at + 4, 4, |b| be32(b).to_string());
    o.field("Acknowledgment number", at + 8, 4, |b| be32(b).to_string());
    o.field("Header length / flags", at + 12, 2, |b| {
        let f = b[1];
        let names = [(0x02, "SYN"), (0x10, "ACK"), (0x08, "PSH"), (0x01, "FIN"), (0x04, "RST"), (0x20, "URG"), (0x40, "ECE"), (0x80, "CWR")];
        let set: Vec<&str> = names.iter().filter(|(m, _)| f & m != 0).map(|(_, n)| *n).collect();
        format!("{} bytes, {}", (b[0] >> 4) as usize * 4, if set.is_empty() { "no flags".into() } else { set.join(" ") })
    });
    o.field("Window", at + 14, 2, |b| be16(b).to_string());
    o.field("Checksum", at + 16, 2, |b| format!("0x{:04x}", be16(b)));
    o.field("Urgent pointer", at + 18, 2, |b| be16(b).to_string());
    if off > 20 {
        o.field("Options", at + 20, off - 20, |b| format!("{} bytes", b.len()));
    }
    payload(o, at + off, "Payload");
}

fn udp(o: &mut Out, at: usize) {
    if o.data.len() < at + 8 {
        o.header("UDP", at, 8, "cut short");
        return;
    }
    o.header("UDP", at, 8, "");
    o.field("Source port", at, 2, |b| be16(b).to_string());
    o.field("Destination port", at + 2, 2, |b| be16(b).to_string());
    o.field("Length", at + 4, 2, |b| be16(b).to_string());
    o.field("Checksum", at + 6, 2, |b| format!("0x{:04x}", be16(b)));
    payload(o, at + 8, "Payload");
}

fn icmp(o: &mut Out, at: usize, name: &str) {
    if o.data.len() < at + 4 {
        o.header(name, at, 4, "cut short");
        return;
    }
    o.header(name, at, 4, "");
    o.field("Type", at, 1, |b| b[0].to_string());
    o.field("Code", at + 1, 1, |b| b[0].to_string());
    o.field("Checksum", at + 2, 2, |b| format!("0x{:04x}", be16(b)));
    payload(o, at + 4, "Payload");
}

fn payload(o: &mut Out, at: usize, name: &str) {
    if at < o.data.len() {
        let n = o.data.len() - at;
        o.header(name, at, n, &format!("{n} bytes"));
    }
}

/// A hex dump like Wireshark's: eight-digit offset, 16 bytes per line, then the printable characters.
pub fn hexdump(data: &[u8]) -> String {
    let mut out = String::with_capacity(data.len() / 16 * 78 + 78);
    for (i, line) in data.chunks(16).enumerate() {
        out.push_str(&format!("{:08x}  ", i * 16));
        for j in 0..16 {
            match line.get(j) {
                Some(b) => out.push_str(&format!("{b:02x} ")),
                None => out.push_str("   "),
            }
            if j == 7 {
                out.push(' ');
            }
        }
        out.push(' ');
        out.extend(line.iter().map(|&b| if (0x20..0x7f).contains(&b) { b as char } else { '.' }));
        out.push('\n');
    }
    out
}
