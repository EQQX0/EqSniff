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
fn refuses_non_ethernet() {
    let mut bytes = write(&[rec(1.0, 20)]);
    bytes[20] = 101; // raw IP
    assert!(read(&bytes, 5).unwrap_err().contains("Ethernet"));
}
