//! Tests for the pcapng reader and writer. All packets here are made up (documentation addresses
//! and counting bytes), so no real traffic is in the repository.
#![allow(dead_code)]

#[path = "../src/pcapfile.rs"]
mod pcapfile;
#[path = "../src/pcapng.rs"]
mod pcapng;
use pcapfile::Rec;
use pcapng::*;

fn rec(ns: u64, n: usize, link: u32, iface: u32) -> Rec {
    Rec { time: ns as f64 / 1e9, ts_ns: ns, data: (0..n).map(|i| (i * 7) as u8).collect(), wire_len: n as u32, link, iface }
}

fn ifaces() -> Vec<IfaceInfo> {
    vec![
        IfaceInfo { link: 1, snaplen: 65535, name: Some("eth0".into()), description: Some("Test Ethernet".into()) },
        IfaceInfo { link: 101, snaplen: 0, name: Some("tun0".into()), description: None },
    ]
}

// Hand-built blocks, so reading is checked against the format and not only against our own writer.
fn pad(v: &mut Vec<u8>) {
    while v.len() % 4 != 0 {
        v.push(0);
    }
}

fn block(big: bool, t: u32, body: &[u8]) -> Vec<u8> {
    let mut b = body.to_vec();
    pad(&mut b);
    let total = (12 + b.len()) as u32;
    let w = |x: u32| if big { x.to_be_bytes() } else { x.to_le_bytes() };
    let mut out = Vec::new();
    out.extend(w(t));
    out.extend(w(total));
    out.extend(b);
    out.extend(w(total));
    out
}

fn opt(big: bool, code: u16, v: &[u8]) -> Vec<u8> {
    let w = |x: u16| if big { x.to_be_bytes() } else { x.to_le_bytes() };
    let mut o = Vec::new();
    o.extend(w(code));
    o.extend(w(v.len() as u16));
    o.extend(v);
    pad(&mut o);
    o
}

fn shb(big: bool, opts: &[u8]) -> Vec<u8> {
    let mut b = Vec::new();
    b.extend(if big { 0x1a2b3c4du32.to_be_bytes() } else { 0x1a2b3c4du32.to_le_bytes() });
    b.extend(if big { [0u8, 1] } else { [1, 0] });
    b.extend([0, 0]);
    b.extend(u64::MAX.to_le_bytes());
    b.extend(opts);
    block(big, 0x0a0d0d0a, &b)
}

fn idb(big: bool, link: u16, snap: u32, opts: &[u8]) -> Vec<u8> {
    let mut b = Vec::new();
    b.extend(if big { link.to_be_bytes() } else { link.to_le_bytes() });
    b.extend([0, 0]);
    b.extend(if big { snap.to_be_bytes() } else { snap.to_le_bytes() });
    b.extend(opts);
    block(big, 1, &b)
}

fn epb(big: bool, iface: u32, ticks: u64, data: &[u8], orig: u32, opts: &[u8]) -> Vec<u8> {
    let w = |x: u32| if big { x.to_be_bytes() } else { x.to_le_bytes() };
    let mut b = Vec::new();
    b.extend(w(iface));
    b.extend(w((ticks >> 32) as u32));
    b.extend(w(ticks as u32));
    b.extend(w(data.len() as u32));
    b.extend(w(orig));
    b.extend(data);
    pad(&mut b);
    b.extend(opts);
    block(big, 6, &b)
}

#[test]
fn round_trip_keeps_bytes_and_exact_timestamps() {
    let recs = vec![rec(1_700_000_000_123_456_789, 60, 1, 0), rec(1_700_000_001_000_000_001, 1501, 1, 0)];
    let file = write(&recs, &ifaces(), "EqSniff test");
    let got = read(&file, 100).unwrap();
    assert_eq!(got.total, 2);
    for (a, b) in recs.iter().zip(&got.recs) {
        assert_eq!(a.data, b.data, "bytes are preserved, including odd lengths");
        assert_eq!(a.ts_ns, b.ts_ns, "nanosecond timestamp is preserved");
        assert_eq!(a.wire_len, b.wire_len);
    }
    assert!(got.info[0].contains("EqSniff test"));
    assert!(got.notes.is_empty(), "{:?}", got.notes);
}

#[test]
fn file_is_aligned_and_well_formed() {
    let file = write(&[rec(5, 61, 1, 0), rec(6, 3, 1, 0)], &ifaces(), "x");
    assert_eq!(file.len() % 4, 0);
    // Walk the blocks the way Wireshark does: every length matches its trailer.
    let mut o = 0;
    let mut types = Vec::new();
    while o < file.len() {
        let t = u32::from_le_bytes(file[o..o + 4].try_into().unwrap());
        let n = u32::from_le_bytes(file[o + 4..o + 8].try_into().unwrap()) as usize;
        assert_eq!(n % 4, 0);
        assert_eq!(u32::from_le_bytes(file[o + n - 4..o + n].try_into().unwrap()) as usize, n);
        types.push(t);
        o += n;
    }
    assert_eq!(o, file.len());
    assert_eq!(types, vec![0x0a0d0d0a, 1, 6, 6]);
}

#[test]
fn multiple_interfaces_and_link_types_survive() {
    let recs = vec![rec(10, 40, 1, 0), rec(11, 20, 101, 1), rec(12, 41, 1, 0), rec(13, 22, 101, 1)];
    let got = read(&write(&recs, &ifaces(), "t"), 100).unwrap();
    assert_eq!(got.ifaces.len(), 2);
    assert_eq!((got.ifaces[0].link, got.ifaces[1].link), (1, 101));
    assert_eq!(got.ifaces[0].name.as_deref(), Some("eth0"));
    assert_eq!(got.ifaces[0].description.as_deref(), Some("Test Ethernet"));
    assert_eq!(got.recs.iter().map(|r| (r.iface, r.link)).collect::<Vec<_>>(), vec![(0, 1), (1, 101), (0, 1), (1, 101)]);
}

#[test]
fn exporting_one_interface_renumbers_it() {
    // Only interface 1 is used, so the file holds one interface block and the packets point at it.
    let got = read(&write(&[rec(1, 20, 101, 1)], &ifaces(), "t"), 10).unwrap();
    assert_eq!(got.ifaces.len(), 1);
    assert_eq!(got.ifaces[0].name.as_deref(), Some("tun0"));
    assert_eq!(got.recs[0].iface, 0);
}

#[test]
fn snaplen_is_never_shorter_than_a_stored_packet() {
    let small = vec![IfaceInfo { link: 1, snaplen: 10, name: None, description: None }];
    let got = read(&write(&[rec(1, 100, 1, 0)], &small, "t"), 10).unwrap();
    assert!(got.ifaces[0].snaplen >= 100);
}

#[test]
fn empty_capture_is_an_error_not_a_panic() {
    let file = write(&[], &[], "t");
    assert!(read(&file, 10).unwrap_err().contains("no packets"));
    // A section header and an interface but no packets.
    let hand = [shb(false, &[]), idb(false, 1, 0, &[])].concat();
    assert!(read(&hand, 10).unwrap_err().contains("no packets"));
}

#[test]
fn reads_a_big_endian_file() {
    let data = [0xde, 0xad, 0xbe, 0xef, 1];
    let file = [shb(true, &[]), idb(true, 1, 65535, &[]), epb(true, 0, 1_500_000, &data, 5, &[])].concat();
    let got = read(&file, 10).unwrap();
    assert_eq!(got.recs[0].data, data);
    assert_eq!(got.recs[0].ts_ns, 1_500_000_000, "default resolution is microseconds");
}

#[test]
fn timestamp_resolutions() {
    let mk = |resol: u8, ticks: u64, extra: &[u8]| {
        let opts = [opt(false, 9, &[resol]), extra.to_vec()].concat();
        let file = [shb(false, &[]), idb(false, 1, 0, &opts), epb(false, 0, ticks, &[1, 2, 3], 3, &[])].concat();
        read(&file, 5).unwrap().recs[0].ts_ns
    };
    assert_eq!(mk(3, 1_234, &[]), 1_234_000_000, "milliseconds");
    assert_eq!(mk(9, 1_700_000_000_000_000_001, &[]), 1_700_000_000_000_000_001, "nanoseconds are exact");
    assert_eq!(mk(0x80 | 10, 1024 * 3, &[]), 3_000_000_000, "binary resolution 2^-10");
    assert_eq!(mk(12, 5_000, &[]), 5, "finer than a nanosecond is cut");
    // if_tsoffset adds seconds.
    assert_eq!(mk(6, 1_000_000, &opt(false, 14, &100i64.to_le_bytes())), 101_000_000_000);
}

#[test]
fn text_options_and_section_info() {
    let opts = [opt(false, 2, b"Wi-Fi"), opt(false, 3, b"Home network"), opt(false, 12, b"filter")].concat();
    let section = [opt(false, 3, b"Windows 11"), opt(false, 4, b"Wireshark 4.2")].concat();
    let file = [shb(false, &section), idb(false, 1, 0, &opts), epb(false, 0, 1, &[0; 8], 8, &[])].concat();
    let got = read(&file, 5).unwrap();
    assert_eq!(got.ifaces[0].name.as_deref(), Some("Wi-Fi"));
    assert_eq!(got.ifaces[0].description.as_deref(), Some("Home network"));
    assert!(got.info[0].contains("Wireshark 4.2") && got.info[0].contains("Windows 11"), "{:?}", got.info);
    assert!(got.notes.iter().any(|n| n.contains("interface option")), "unsupported metadata is reported: {:?}", got.notes);
}

#[test]
fn unsupported_blocks_and_options_are_reported_not_hidden() {
    let comment = opt(false, 1, b"a note");
    let file = [
        shb(false, &[]),
        idb(false, 1, 0, &[]),
        block(false, 4, &[0; 16]),          // name resolution
        epb(false, 0, 1, &[1; 10], 10, &comment),
        block(false, 5, &[0; 24]),          // interface statistics
        block(false, 0x0a, &[0; 8]),        // decryption secrets
        block(false, 0x4000_0bad, &[0; 8]), // custom
        block(false, 0x7777, &[0; 8]),      // unknown
    ]
    .concat();
    let got = read(&file, 5).unwrap();
    assert_eq!(got.total, 1);
    let all = got.notes.join(" | ");
    for want in ["name resolution", "interface statistics", "decryption secrets", "custom", "unknown", "comment"] {
        assert!(all.contains(want), "missing {want}: {all}");
    }
}

#[test]
fn simple_packet_blocks_are_read_and_flagged() {
    let mut body = Vec::new();
    body.extend(6u32.to_le_bytes());
    body.extend([9, 8, 7, 6, 5, 4]);
    let file = [shb(false, &[]), idb(false, 1, 0, &[]), block(false, 3, &body)].concat();
    let got = read(&file, 5).unwrap();
    assert_eq!(got.recs[0].data, vec![9, 8, 7, 6, 5, 4]);
    assert!(got.notes.iter().any(|n| n.contains("simple packet")));
}

#[test]
fn several_sections_keep_their_own_interfaces() {
    let one = [shb(false, &[]), idb(false, 1, 0, &[]), epb(false, 0, 1, &[1, 1], 2, &[])].concat();
    let two = [shb(true, &[]), idb(true, 101, 0, &[]), epb(true, 0, 2, &[2, 2, 2], 3, &[])].concat();
    let got = read(&[one, two].concat(), 10).unwrap();
    assert_eq!(got.total, 2);
    assert_eq!(got.recs.iter().map(|r| r.link).collect::<Vec<_>>(), vec![1, 101]);
    assert_eq!(got.recs.iter().map(|r| r.iface).collect::<Vec<_>>(), vec![0, 1]);
}

#[test]
fn max_limits_kept_packets_but_counts_all() {
    let recs: Vec<Rec> = (0..10).map(|i| rec(i, 20, 1, 0)).collect();
    let got = read(&write(&recs, &ifaces(), "t"), 3).unwrap();
    assert_eq!((got.recs.len(), got.total), (3, 10));
}

#[test]
fn truncated_file_reads_what_is_complete() {
    let mut file = write(&[rec(1, 40, 1, 0), rec(2, 40, 1, 0), rec(3, 40, 1, 0)], &ifaces(), "t");
    file.truncate(file.len() - 9);
    let got = read(&file, 10).unwrap();
    assert_eq!(got.total, 2);
    assert!(got.notes.iter().any(|n| n.contains("cut short")), "{:?}", got.notes);
}

#[test]
fn corrupted_files_give_errors_and_never_panic() {
    assert!(read(&[0x0a, 0x0d, 0x0d, 0x0a, 0, 0, 0, 0, 0, 0], 5).unwrap_err().contains("too short"));
    assert!(read(b"not a capture file at all, but long enough", 5).is_err());
    // Wrong byte-order marker.
    let mut bad = write(&[rec(1, 20, 1, 0)], &ifaces(), "t");
    bad[8..12].copy_from_slice(&[1, 2, 3, 4]);
    assert!(read(&bad, 5).unwrap_err().contains("byte-order"));
    // Unsupported major version.
    let mut v2 = write(&[rec(1, 20, 1, 0)], &ifaces(), "t");
    v2[12] = 2;
    assert!(read(&v2, 5).unwrap_err().contains("version 2.0"));
    // First block is not a section header.
    let mut not_shb = write(&[rec(1, 20, 1, 0)], &ifaces(), "t");
    not_shb[0] = 1;
    assert!(read(&not_shb, 5).is_err());
    // Packet that claims more data than its block holds is skipped, the rest still reads.
    let mut over = write(&[rec(1, 20, 1, 0), rec(2, 20, 1, 0)], &ifaces(), "t");
    let first_epb = over.windows(4).position(|w| w == 6u32.to_le_bytes()).unwrap();
    over[first_epb + 8 + 12..first_epb + 8 + 16].copy_from_slice(&5000u32.to_le_bytes());
    let got = read(&over, 5).unwrap();
    assert_eq!(got.total, 1);
    assert!(got.notes.iter().any(|n| n.contains("unreadable")));
    // Packet pointing at an interface that does not exist.
    let ghost = [shb(false, &[]), idb(false, 1, 0, &[]), epb(false, 9, 1, &[1, 2], 2, &[])].concat();
    assert!(read(&ghost, 5).unwrap_err().contains("no packets"));
    // Block length lies.
    let mut lie = write(&[rec(1, 20, 1, 0)], &ifaces(), "t");
    let n = lie.len();
    lie[n - 4..].copy_from_slice(&999u32.to_le_bytes());
    assert!(read(&lie, 5).unwrap_err().contains("damaged"), "the only packet is unreadable");
}

#[test]
fn every_truncation_and_bit_flip_is_safe() {
    let file = write(&(0..4).map(|i| rec(i, 30 + i as usize, 1, (i % 2) as u32)).collect::<Vec<_>>(), &ifaces(), "t");
    for n in 0..file.len() {
        let _ = read(&file[..n], 10);
    }
    for i in 0..file.len() {
        let mut f = file.clone();
        f[i] ^= 0xff;
        let _ = read(&f, 10);
    }
}

#[test]
fn read_any_opens_both_formats() {
    let classic = pcapfile::write(&[Rec::new(1.5, vec![1, 2, 3], 3)]);
    let a = read_any(&classic, 5).unwrap();
    assert!(!a.pcapng);
    assert_eq!(a.recs[0].data, vec![1, 2, 3]);
    let ng = write(&[rec(1, 20, 1, 0)], &ifaces(), "t");
    assert!(read_any(&ng, 5).unwrap().pcapng);
    assert!(read_any(b"hello", 5).is_err());
}

#[test]
fn large_packet_round_trips() {
    let big = rec(77, 200_000, 1, 0);
    let got = read(&write(&[big.clone()], &ifaces(), "t"), 5).unwrap();
    assert_eq!(got.recs[0].data, big.data);
    // Over the per-packet limit: skipped with a count, not a crash.
    let huge = [shb(false, &[]), idb(false, 1, 0, &[]), epb(false, 0, 1, &vec![0u8; pcapfile::MAX_RECORD + 4], 1, &[])].concat();
    assert!(read(&huge, 5).unwrap_err().contains("no packets"));
}
