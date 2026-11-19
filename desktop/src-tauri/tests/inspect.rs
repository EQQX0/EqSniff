//! Tests for the HEX inspector backend: decoded fields with byte ranges, hex dump text, and
//! reading frames from other link types. Frames are made up (documentation addresses).
#![allow(dead_code)]

#[path = "../src/netaddr.rs"]
mod netaddr;
#[path = "../src/packet.rs"]
mod packet;
#[path = "../src/inspect.rs"]
mod inspect;
use inspect::*;
use packet::*;

const SRC: [u8; 4] = [192, 0, 2, 1];
const DST: [u8; 4] = [192, 0, 2, 2];

fn ipv4_udp(payload: &[u8]) -> Vec<u8> {
    let total = (20 + 8 + payload.len()) as u16;
    let mut v = vec![0x45, 0];
    v.extend(total.to_be_bytes());
    v.extend([0x12, 0x34, 0x40, 0x00, 64, 17, 0, 0]);
    v.extend(SRC);
    v.extend(DST);
    v.extend(5353u16.to_be_bytes());
    v.extend(53u16.to_be_bytes());
    v.extend(((8 + payload.len()) as u16).to_be_bytes());
    v.extend([0, 0]);
    v.extend(payload);
    v
}

fn eth_frame(ip: &[u8]) -> Vec<u8> {
    let mut v = vec![0xaa, 0xbb, 0xcc, 0, 0, 1, 0xaa, 0xbb, 0xcc, 0, 0, 2, 0x08, 0x00];
    v.extend(ip);
    v
}

fn find<'a>(f: &'a [Field], name: &str, depth: u8) -> &'a Field {
    f.iter().find(|x| x.name == name && x.depth == depth).unwrap_or_else(|| panic!("no field {name}: {f:?}"))
}

#[test]
fn ethernet_ipv4_udp_fields_have_the_right_byte_ranges() {
    let frame = eth_frame(&ipv4_udp(b"hello"));
    let f = decode(&frame, 1);
    assert_eq!((find(&f, "Ethernet", 0).start, find(&f, "Ethernet", 0).len), (0, 14));
    let ip = find(&f, "IPv4", 0);
    assert_eq!((ip.start, ip.len), (14, 20));
    let src = f.iter().find(|x| x.name == "Source" && x.start == 14 + 12).unwrap();
    assert_eq!((src.value.as_str(), src.len), ("192.0.2.1", 4));
    let dst = f.iter().find(|x| x.name == "Destination" && x.start == 14 + 16).unwrap();
    assert_eq!(dst.value, "192.0.2.2");
    assert_eq!(find(&f, "Protocol", 1).value, "17 (UDP)");
    assert_eq!(find(&f, "Flags / fragment offset", 1).value, "DF, offset 0");
    let udp = find(&f, "UDP", 0);
    assert_eq!((udp.start, udp.len), (34, 8));
    assert_eq!(find(&f, "Source port", 1).value, "5353");
    assert_eq!(find(&f, "Destination port", 1).value, "53");
    let pl = find(&f, "Payload", 0);
    assert_eq!((pl.start, pl.len), (42, 5));
    assert_eq!(&frame[pl.start..pl.start + pl.len], b"hello");
    // Every field lies inside the frame.
    assert!(f.iter().all(|x| x.start + x.len <= frame.len()));
}

#[test]
fn tcp_flags_and_numbers() {
    let mut tcp = Vec::new();
    tcp.extend(443u16.to_be_bytes());
    tcp.extend(50000u16.to_be_bytes());
    tcp.extend(1000u32.to_be_bytes());
    tcp.extend(2000u32.to_be_bytes());
    tcp.extend([0x50, 0x12]); // header 20 bytes, SYN+ACK
    tcp.extend([0xff, 0xff, 0, 0, 0, 0]);
    let mut ip = vec![0x45, 0];
    ip.extend(((20 + tcp.len()) as u16).to_be_bytes());
    ip.extend([0, 0, 0, 0, 64, 6, 0, 0]);
    ip.extend(SRC);
    ip.extend(DST);
    ip.extend(tcp);
    let f = decode(&eth_frame(&ip), 1);
    assert_eq!(find(&f, "Sequence number", 1).value, "1000");
    assert_eq!(find(&f, "Acknowledgment number", 1).value, "2000");
    assert!(find(&f, "Header length / flags", 1).value.contains("SYN ACK"));
}

#[test]
fn a_frame_cut_short_has_fewer_fields_and_never_panics() {
    let frame = eth_frame(&ipv4_udp(b"hello"));
    for n in 0..frame.len() {
        let f = decode(&frame[..n], 1);
        assert!(f.iter().all(|x| x.start + x.len <= n), "cut at {n}: {f:?}");
    }
    assert!(decode(&frame[..30], 1).iter().any(|x| x.name == "IPv4"));
}

#[test]
fn vlan_tag_is_decoded() {
    let ip = ipv4_udp(b"x");
    let mut v = vec![0xaa, 0xbb, 0xcc, 0, 0, 1, 0xaa, 0xbb, 0xcc, 0, 0, 2, 0x81, 0x00, 0x20, 0x64, 0x08, 0x00];
    v.extend(&ip);
    let f = decode(&v, 1);
    assert_eq!(find(&f, "VLAN", 1).value, "id 100, priority 1");
    assert_eq!(find(&f, "IPv4", 0).start, 18);
}

#[test]
fn ipv6_udp() {
    let mut v = vec![0x60, 0, 0, 0, 0, 10, 17, 64];
    v.extend([0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    v.extend([0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2]);
    v.extend([0, 53, 0, 54, 0, 10, 0, 0, 1, 2]);
    let mut frame = vec![0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0x86, 0xdd];
    frame.extend(v);
    let f = decode(&frame, 1);
    assert!(f.iter().any(|x| x.name == "Source" && x.value == "2001:db8::1"));
    assert_eq!(find(&f, "Source port", 1).value, "53");
}

#[test]
fn other_link_types_find_the_ip_header() {
    let ip = ipv4_udp(b"abc");
    // Raw IP: the frame is the IP packet.
    assert_eq!(ip_offset(&ip, 101), Some(0));
    assert_eq!(ip_offset(&ip, 228), Some(0));
    // BSD loopback: a 4-byte family, then IP.
    let mut lo = vec![2, 0, 0, 0];
    lo.extend(&ip);
    assert_eq!(ip_offset(&lo, 0), Some(4));
    let mut lo_be = vec![0, 0, 0, 2];
    lo_be.extend(&ip);
    assert_eq!(ip_offset(&lo_be, 108), Some(4));
    // Linux cooked v1 (16-byte header) and v2 (20-byte header).
    let mut sll = vec![0; 14];
    sll.extend([0x08, 0x00]);
    sll.extend(&ip);
    assert_eq!(ip_offset(&sll, 113), Some(16));
    let mut sll2 = vec![0x08, 0x00];
    sll2.extend([0; 18]);
    sll2.extend(&ip);
    assert_eq!(ip_offset(&sll2, 276), Some(20));
    // Not IP, or an unsupported type.
    assert_eq!(ip_offset(&[0x00; 30], 101), None);
    assert_eq!(ip_offset(&ip, 105), None);
    assert_eq!(ip_offset(&[], 101), None);

    for (frame, link) in [(&ip, 101u32), (&lo, 0), (&lo_be, 108), (&sll, 113), (&sll2, 276)] {
        let (row, _) = summarize_link(frame, link, frame.len() as u32, 1.0).unwrap_or_else(|| panic!("link {link}"));
        assert_eq!((row.src.as_str(), row.dst.as_str(), row.protocol.as_str()), ("192.0.2.1", "192.0.2.2", "UDP"), "link {link}");
        assert_eq!((row.src_port, row.dst_port), (Some(5353), Some(53)));
        let f = decode(frame, link);
        let src = f.iter().find(|x| x.name == "Source" && x.depth == 1 && x.value == "192.0.2.1").unwrap_or_else(|| panic!("link {link}: {f:?}"));
        assert_eq!(src.start, ip_offset(frame, link).unwrap() + 12);
    }
    assert!(summarize_link(&ip, 105, 10, 1.0).is_none());
    assert!(link_supported(113) && !link_supported(105));
}

#[test]
fn hexdump_layout() {
    let data: Vec<u8> = (0..20u8).collect();
    let d = hexdump(&data);
    let lines: Vec<&str> = d.lines().collect();
    assert_eq!(lines.len(), 2);
    assert!(lines[0].starts_with("00000000  00 01 02 03 04 05 06 07  08 09 0a 0b 0c 0d 0e 0f  "));
    assert!(lines[1].starts_with("00000010  10 11 12 13 "));
    assert!(lines[0].ends_with("................"));
    // Short last line is padded so the ASCII column lines up.
    assert_eq!(lines[1].find("....").unwrap(), lines[0].find("................").unwrap());
}

#[test]
fn hexdump_ascii_shows_printable_only() {
    let d = hexdump(b"Hello, world!\x00\x7f\xff");
    assert!(d.trim_end().ends_with("Hello, world!..."), "{d}");
    assert_eq!(hexdump(&[]), "");
}

#[test]
fn large_packet_decodes_and_dumps_quickly() {
    let payload = vec![0x41u8; 60_000];
    let frame = eth_frame(&ipv4_udp(&payload));
    let t = std::time::Instant::now();
    let f = decode(&frame, 1);
    let d = hexdump(&frame);
    assert!(t.elapsed().as_millis() < 500);
    assert_eq!(find(&f, "Payload", 0).len, 60_000);
    assert_eq!(d.lines().count(), frame.len().div_ceil(16));
}
