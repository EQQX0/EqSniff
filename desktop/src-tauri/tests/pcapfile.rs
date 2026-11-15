//! Tests for the capture-file reader and writer. They live here, not inside the app, so they build
//! without the window libraries (the app's own test program crashes at start-up on some machines).
#![allow(dead_code)]

#[path = "../src/pcapfile.rs"]
mod pcapfile;
use pcapfile::*;


fn rec(t: f64, n: usize) -> Rec {
    Rec { time: t, data: (0..n).map(|i| i as u8).collect(), wire_len: n as u32 }
}

#[test]
fn round_trip() {
    let bytes = write(&[rec(1_700_000_000.25, 60), rec(1_700_000_001.5, 1500)]);
    let (back, total) = read(&bytes, 10).unwrap();
    assert_eq!(total, 2);
    assert_eq!(back[1].data.len(), 1500);
    assert!((back[0].time - 1_700_000_000.25).abs() < 1e-5);
}

#[test]
fn respects_max_but_counts_all() {
    let bytes = write(&[rec(1.0, 20), rec(2.0, 20), rec(3.0, 20)]);
    let (back, total) = read(&bytes, 2).unwrap();
    assert_eq!((back.len(), total), (2, 3));
}

#[test]
fn truncated_file_reads_what_is_there() {
    let mut bytes = write(&[rec(1.0, 40), rec(2.0, 40)]);
    bytes.truncate(bytes.len() - 10);
    assert_eq!(read(&bytes, 10).unwrap().1, 1);
}

#[test]
fn refuses_other_formats() {
    assert!(read(&[0x0a, 0x0d, 0x0d, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 5).unwrap_err().contains("pcapng"));
    assert!(read(&[b'x'; 40], 5).is_err());
    assert!(read(&[1, 2, 3], 5).is_err());
}

#[test]
fn record_claiming_a_huge_length_does_not_panic() {
    let mut bytes = write(&[rec(1.0, 20)]);
    bytes[24 + 8..24 + 12].copy_from_slice(&0xFFFF_FFFFu32.to_le_bytes());
    // The only record is unreadable, so there is nothing to show, but no panic or overflow.
    assert!(read(&bytes, 5).unwrap_err().contains("no packets"));
    let mut two = write(&[rec(1.0, 20), rec(2.0, 20)]);
    let second = 24 + 16 + 20;
    two[second + 8..second + 12].copy_from_slice(&0xFFFF_FFFFu32.to_le_bytes());
    assert_eq!(read(&two, 5).unwrap().1, 1, "reads up to the bad record");
}

#[test]
fn short_files_are_errors() {
    for n in [0usize, 1, 23] {
        let e = read(&vec![0xd4u8; n], 5).unwrap_err();
        assert!(e.contains("too short"), "{n}: {e}");
    }
    let hdr = write(&[]);
    assert_eq!(hdr.len(), 24);
    assert!(read(&hdr, 5).unwrap_err().contains("no packets"));
}

#[test]
fn pcapng_gets_its_own_message() {
    let mut ng = vec![0x0a, 0x0d, 0x0d, 0x0a];
    ng.extend([0u8; 40]);
    let e = read(&ng, 5).unwrap_err();
    assert!(e.contains("pcapng") && e.contains("Save As"), "{e}");
}

#[test]
fn big_endian_files_are_read() {
    let mut be = Vec::new();
    be.extend(0xa1b2_c3d4u32.to_be_bytes());
    be.extend([0, 2, 0, 4]);
    be.extend([0u8; 8]);
    be.extend(65535u32.to_be_bytes());
    be.extend(1u32.to_be_bytes());
    be.extend(10u32.to_be_bytes());
    be.extend(500_000u32.to_be_bytes());
    be.extend(2u32.to_be_bytes());
    be.extend(2u32.to_be_bytes());
    be.extend([0xaa, 0xbb]);
    let (r, t) = read(&be, 5).unwrap();
    assert_eq!((t, r[0].data.clone()), (1, vec![0xaa, 0xbb]));
    assert!((r[0].time - 10.5).abs() < 1e-9);
}

#[test]
fn upload_size_limits() {
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD;
    let small = b64.encode([1u8, 2, 3]);
    assert_eq!(decode_upload(&format!("  {small}\n")).unwrap(), vec![1, 2, 3]);
    assert!(decode_upload("!!!not base64").unwrap_err().contains("could not be read"));
    // Too long as text: refused before anything is decoded.
    assert!(decode_upload(&"A".repeat(MAX_FILE_B64 + 4)).unwrap_err().contains("too large"));
    // Small enough as text but one byte over the byte limit.
    assert!(decode_upload(&b64.encode(vec![0u8; MAX_FILE + 1])).unwrap_err().contains("too large"));
    assert_eq!(decode_upload(&b64.encode(vec![0u8; MAX_FILE])).unwrap().len(), MAX_FILE);
}

#[test]
fn refuses_non_ethernet() {
    let mut bytes = write(&[rec(1.0, 20)]);
    bytes[20] = 101; // raw IP
    assert!(read(&bytes, 5).unwrap_err().contains("Ethernet"));
}
