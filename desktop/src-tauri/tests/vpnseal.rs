//! Tests for locking tunnel files with a sync passphrase.
#![allow(dead_code)]

#[path = "../src/vpnseal.rs"]
mod vpnseal;
use vpnseal::*;

const CONF: &str = "[Interface]\nPrivateKey = aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa=\nAddress = 10.0.0.2/32\n";

#[test]
fn round_trip() {
    let s = seal(CONF, "correct horse battery").unwrap();
    assert!(s.starts_with("v1.300000."));
    assert_eq!(open(&s, "correct horse battery").unwrap(), CONF);
}

#[test]
fn sealed_text_hides_the_key() {
    let s = seal(CONF, "correct horse battery").unwrap();
    assert!(!s.contains("PrivateKey") && !s.contains("aaaaaaaaaaaa"));
}

#[test]
fn wrong_passphrase_is_refused() {
    let s = seal(CONF, "correct horse battery").unwrap();
    assert!(open(&s, "wrong horse battery").unwrap_err().contains("Wrong sync passphrase"));
}

#[test]
fn every_seal_is_different_but_opens() {
    let a = seal(CONF, "correct horse battery").unwrap();
    let b = seal(CONF, "correct horse battery").unwrap();
    assert_ne!(a, b);
    assert_eq!(open(&b, "correct horse battery").unwrap(), CONF);
}

#[test]
fn tampering_is_detected() {
    let s = seal(CONF, "correct horse battery").unwrap();
    let mut chars: Vec<char> = s.chars().collect();
    let i = chars.len() - 6;
    chars[i] = if chars[i] == 'A' { 'B' } else { 'A' };
    let t: String = chars.into_iter().collect();
    assert!(open(&t, "correct horse battery").is_err());
}

#[test]
fn short_passphrase_and_junk_are_refused() {
    assert!(seal(CONF, "short").is_err());
    assert!(open("nonsense", "correct horse battery").is_err());
    assert!(open("v1.1.AAAA", "correct horse battery").is_err());
    assert!(open("v1.300000.AAAA", "correct horse battery").is_err());
}

#[test]
fn fingerprint_changes_with_the_file() {
    assert_eq!(fingerprint(CONF), fingerprint(CONF));
    assert_ne!(fingerprint(CONF), fingerprint(&CONF.replace("10.0.0.2", "10.0.0.3")));
    assert_eq!(fingerprint(CONF).len(), 32);
}
