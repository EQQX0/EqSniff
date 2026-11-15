//! Tests for the scan's address arithmetic and ARP text parsing.
#![allow(dead_code)]

#[path = "../src/scannet.rs"]
mod scannet;
use scannet::*;
use std::net::Ipv4Addr;

const OWN: Ipv4Addr = Ipv4Addr::new(192, 168, 1, 77);

#[test]
fn whole_network_is_dot_1_to_dot_254() {
    for text in ["", "   ", "\t\n"] {
        let t = targets(OWN, 24, text).unwrap();
        assert_eq!(t.len(), 254, "{text:?}");
        assert_eq!(t[0], Ipv4Addr::new(192, 168, 1, 1));
        assert_eq!(t[253], Ipv4Addr::new(192, 168, 1, 254));
    }
}

#[test]
fn a_28_inside_the_24_is_14_hosts() {
    let t = targets(OWN, 24, "192.168.1.16/28").unwrap();
    assert_eq!(t.len(), 14);
    assert_eq!(t[0], Ipv4Addr::new(192, 168, 1, 17));
    assert_eq!(t[13], Ipv4Addr::new(192, 168, 1, 30));
}

#[test]
fn spaces_around_the_input_are_ignored() {
    assert_eq!(targets(OWN, 24, "  192.168.1.5  ").unwrap(), vec![Ipv4Addr::new(192, 168, 1, 5)]);
    assert_eq!(targets(OWN, 24, " 192.168.1.16 / 28 ").unwrap().len(), 14);
}

#[test]
fn outside_the_subnet_is_refused() {
    assert!(targets(OWN, 24, "192.168.2.5").unwrap_err().contains("network this computer is on"));
    assert!(targets(OWN, 24, "192.168.2.0/28").is_err());
    assert!(targets(OWN, 24, "8.8.8.8").is_err());
    assert!(targets(OWN, 28, "192.168.1.200").is_err());
}

#[test]
fn ranges_wider_than_24_are_refused() {
    assert!(targets(OWN, 24, "192.168.0.0/23").unwrap_err().contains("/24"));
    assert!(targets(OWN, 24, "192.168.1.0/8").is_err());
    assert!(targets(OWN, 24, "192.168.1.0/x").is_err());
    assert!(targets(OWN, 24, "banana").is_err());
}

#[test]
fn network_or_broadcast_address_is_an_error_not_an_empty_scan() {
    assert!(targets(OWN, 24, "192.168.1.0").is_err());
    assert!(targets(OWN, 24, "192.168.1.255").is_err());
}

#[test]
fn a_30_network_has_two_hosts_and_no_shift_overflow() {
    let t = targets(Ipv4Addr::new(10, 0, 0, 5), 30, "").unwrap();
    assert_eq!(t, vec![Ipv4Addr::new(10, 0, 0, 5), Ipv4Addr::new(10, 0, 0, 6)]);
    let _ = targets(OWN, 0, ""); // must not panic
    let _ = targets(OWN, 32, "");
}

#[test]
fn tunnel_sized_prefixes_are_errors() {
    assert!(pick_prefix(Some(32)).unwrap_err().contains("VPN"));
    assert!(pick_prefix(Some(31)).is_err());
    assert_eq!(pick_prefix(Some(30)).unwrap(), 30);
    assert_eq!(pick_prefix(Some(16)).unwrap(), 24);
    assert_eq!(pick_prefix(None).unwrap(), 24);
}

#[test]
fn arp_parsing_ignores_language_and_skips_junk() {
    let text = "\
Interface: 192.168.1.77 --- 0x9\r\n\
  Internet Address      Physical Address      Type\r\n\
  192.168.1.1           aa-bb-cc-dd-ee-ff     dynamic\r\n\
  192.168.1.20          11-22-33-44-55-66     dinamico\r\n\
  192.168.1.21          11-22-33-44-55-67     \u{52a8}\u{6001}\r\n\
  192.168.1.30          00-00-00-00-00-00     invalid\r\n\
  192.168.1.31          11-22-33-44-55-68     invalid\r\n\
  192.168.1.255         ff-ff-ff-ff-ff-ff     static\r\n\
  224.0.0.22            01-00-5e-00-00-16     static\r\n\
  192.168.1.40          not-a-mac             dynamic\r\n";
    let got = parse_arp(text);
    let ips: Vec<String> = got.iter().map(|(ip, _)| ip.to_string()).collect();
    assert_eq!(ips, ["192.168.1.1", "192.168.1.20", "192.168.1.21", "224.0.0.22"]);
    assert_eq!(got[0].1, "aa-bb-cc-dd-ee-ff");
}
