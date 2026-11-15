//! Tests for reading frames into table rows and for the replay safety check.
#![allow(dead_code)]

#[path = "../src/netaddr.rs"]
mod netaddr;
#[path = "../src/packet.rs"]
mod packet;
use packet::*;
use std::net::IpAddr;

fn eth(ethertype: u16) -> Vec<u8> {
    let mut v = vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    v.extend(ethertype.to_be_bytes());
    v
}

fn ipv4(proto: u8, total: u16, src: [u8; 4], dst: [u8; 4]) -> Vec<u8> {
    let mut v = vec![0x45, 0];
    v.extend(total.to_be_bytes());
    v.extend([0, 0, 0, 0, 64, proto, 0, 0]);
    v.extend(src);
    v.extend(dst);
    v
}

fn ipv6(next: u8, payload_len: u16, src: [u8; 16], dst: [u8; 16]) -> Vec<u8> {
    let mut v = vec![0x60, 0, 0, 0];
    v.extend(payload_len.to_be_bytes());
    v.extend([next, 64]);
    v.extend(src);
    v.extend(dst);
    v
}

fn tcp(sport: u16, dport: u16, payload: &[u8]) -> Vec<u8> {
    let mut v = Vec::new();
    v.extend(sport.to_be_bytes());
    v.extend(dport.to_be_bytes());
    v.extend([0, 0, 0, 1, 0, 0, 0, 0, 0x50, 0x02, 0xff, 0xff, 0, 0, 0, 0]);
    v.extend(payload);
    v
}

fn udp(sport: u16, dport: u16, payload: &[u8]) -> Vec<u8> {
    let mut v = Vec::new();
    v.extend(sport.to_be_bytes());
    v.extend(dport.to_be_bytes());
    v.extend(((8 + payload.len()) as u16).to_be_bytes());
    v.extend([0, 0]);
    v.extend(payload);
    v
}

fn a6(first: u16, last: u16) -> [u8; 16] {
    let mut a = [0u8; 16];
    a[..2].copy_from_slice(&first.to_be_bytes());
    a[14..].copy_from_slice(&last.to_be_bytes());
    a
}

#[test]
fn vlan_tagged_tcp_is_read() {
    let body = b"GET /";
    let mut f = eth(0x8100);
    f.extend([0x00, 0x05]); // VLAN 5
    f.extend(0x0800u16.to_be_bytes());
    f.extend(ipv4(6, (20 + 20 + body.len()) as u16, [192, 168, 1, 2], [93, 184, 216, 34]));
    f.extend(tcp(50000, 80, body));
    let (row, cut) = summarize(&f, f.len() as u32, 1.5).unwrap();
    assert_eq!((row.protocol.as_str(), row.src.as_str(), row.dst.as_str()), ("TCP", "192.168.1.2", "93.184.216.34"));
    assert_eq!((row.src_port, row.dst_port), (Some(50000), Some(80)));
    assert_eq!(row.head, "474554202f");
    assert!(!cut);
}

#[test]
fn ipv6_hop_by_hop_then_udp() {
    let body = [9u8; 4];
    let mut f = eth(0x86dd);
    f.extend(ipv6(0, (8 + 8 + body.len()) as u16, a6(0xfd00, 1), a6(0xfd00, 2)));
    f.extend([17, 0, 1, 4, 0, 0, 0, 0]); // hop-by-hop: next = UDP, PadN
    f.extend(udp(5353, 5353, &body));
    let (row, cut) = summarize(&f, f.len() as u32, 0.0).unwrap();
    assert_eq!(row.protocol, "UDP");
    assert_eq!((row.src.as_str(), row.dst.as_str()), ("fd00::1", "fd00::2"));
    assert_eq!(row.dst_port, Some(5353));
    assert!(!cut);
}

#[test]
fn icmpv6_and_other_ip_protocols_are_named() {
    let mut f = eth(0x86dd);
    f.extend(ipv6(58, 8, a6(0xfe80, 1), a6(0xfe80, 2)));
    f.extend([128, 0, 0, 0, 0, 1, 0, 1]); // echo request
    assert_eq!(summarize(&f, f.len() as u32, 0.0).unwrap().0.protocol, "ICMPv6");

    for (n, name) in [(47u8, "GRE"), (50, "ESP"), (2, "IGMP")] {
        let mut g = eth(0x0800);
        g.extend(ipv4(n, 28, [10, 0, 0, 1], [10, 0, 0, 2]));
        g.extend([0u8; 8]);
        assert_eq!(summarize(&g, g.len() as u32, 0.0).unwrap().0.protocol, name);
    }
    let mut icmp = eth(0x0800);
    icmp.extend(ipv4(1, 28, [10, 0, 0, 1], [10, 0, 0, 2]));
    icmp.extend([8, 0, 0, 0, 0, 1, 0, 1]);
    assert_eq!(summarize(&icmp, icmp.len() as u32, 0.0).unwrap().0.protocol, "ICMP");
}

#[test]
fn arp_gives_no_row() {
    let mut f = eth(0x0806);
    f.extend([0, 1, 8, 0, 6, 4, 0, 1]);
    f.extend([0u8; 20]);
    assert!(summarize(&f, f.len() as u32, 0.0).is_none());
}

#[test]
fn cut_short_ipv4_still_shows_and_is_marked() {
    // The header promises 1500 bytes but the driver kept far fewer.
    let mut f = eth(0x0800);
    f.extend(ipv4(17, 1500, [192, 168, 1, 2], [192, 168, 1, 3]));
    f.extend(udp(4000, 5000, &[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
    let (row, cut) = summarize(&f, 1514, 0.0).unwrap();
    assert!(cut, "marked as cut");
    assert_eq!((row.protocol.as_str(), row.src_port, row.dst_port), ("UDP", Some(4000), Some(5000)));
    assert_eq!(row.length, 1514);
}

#[test]
fn offload_frame_with_zero_length_field_still_shows() {
    let mut f = eth(0x0800);
    f.extend(ipv4(6, 0, [192, 168, 1, 2], [192, 168, 1, 3]));
    f.extend(tcp(1234, 443, &[0xde, 0xad]));
    let (row, _) = summarize(&f, f.len() as u32, 0.0).unwrap();
    assert_eq!((row.protocol.as_str(), row.dst_port), ("TCP", Some(443)));
}

#[test]
fn short_garbage_gives_none_not_a_panic() {
    assert!(summarize(&[], 0, 0.0).is_none());
    assert!(summarize(&[1, 2, 3], 3, 0.0).is_none());
}

fn frame4(src: [u8; 4], dst: [u8; 4]) -> Vec<u8> {
    let mut f = eth(0x0800);
    f.extend(ipv4(17, 28, src, dst));
    f.extend(udp(1, 2, &[]));
    f
}

#[test]
fn replay_only_between_local_addresses() {
    assert!(both_ends_local(&frame4([192, 168, 1, 2], [192, 168, 1, 3])).is_ok());
    assert!(both_ends_local(&frame4([8, 8, 8, 8], [192, 168, 1, 2])).is_err());
    assert!(both_ends_local(&frame4([192, 168, 1, 2], [8, 8, 8, 8])).is_err());
    assert!(both_ends_local(&frame4([192, 168, 1, 2], [224, 0, 0, 251])).is_err());
    assert!(both_ends_local(&frame4([192, 168, 1, 2], [224, 0, 0, 251])).unwrap_err().contains("outside"));

    let mut f = eth(0x86dd);
    f.extend(ipv6(17, 8, a6(0xfe80, 1), a6(0xfd00, 2)));
    f.extend(udp(1, 2, &[]));
    assert!(both_ends_local(&f).is_ok(), "link-local to unique-local is fine");
    let mut g = eth(0x86dd);
    g.extend(ipv6(17, 8, a6(0x2001, 1), a6(0xfd00, 2)));
    g.extend(udp(1, 2, &[]));
    assert!(both_ends_local(&g).is_err());
}

#[test]
fn replay_refuses_unreadable_and_non_ip() {
    assert!(both_ends_local(&[0u8; 5]).is_err());
    let mut arp = eth(0x0806);
    arp.extend([0u8; 28]);
    assert!(both_ends_local(&arp).is_err());
}

#[test]
fn is_public_rules() {
    let p = |s: &str| netaddr::is_public(s.parse::<IpAddr>().unwrap());
    for yes in ["8.8.8.8", "93.184.216.34", "2001:4860:4860::8888", "2606:4700::1111"] {
        assert!(p(yes), "{yes}");
    }
    for no in ["10.1.2.3", "172.16.0.1", "192.168.1.1", "127.0.0.1", "169.254.1.1", "224.0.0.251", "255.255.255.255", "0.0.0.0", "::1", "::", "fe80::1", "fd00::2", "fc00::1", "ff02::1"] {
        assert!(!p(no), "{no}");
    }
}
