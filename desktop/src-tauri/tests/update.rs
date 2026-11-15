//! Tests for the update check's version handling.
#![allow(dead_code)]

#[path = "../src/updatever.rs"]
mod updatever;
use updatever::*;

fn v(s: &str) -> Version {
    parse(s).unwrap_or_else(|| panic!("{s} should parse"))
}

#[test]
fn reads_common_shapes() {
    assert_eq!(v("v1.2").core, (1, 2, 0));
    assert_eq!(v("1.2.3").core, (1, 2, 3));
    assert_eq!(v(" 1.2.3 ").core, (1, 2, 3));
    assert_eq!(v("7").core, (7, 0, 0));
    let rc = v("1.2.3-rc1");
    assert_eq!((rc.core, rc.pre.as_deref()), ((1, 2, 3), Some("rc1")));
    assert_eq!(v("1.2.3+meta"), v("1.2.3"));
    assert_eq!(v("1.2.3-rc1+meta"), v("1.2.3-rc1"));
}

#[test]
fn rejects_junk() {
    for bad in ["x.y", "", "v", "1.x", "1.2.3.4", "1.2.3-", "-1.2", "1..2", "latest"] {
        assert!(parse(bad).is_none(), "{bad}");
    }
}

#[test]
fn a_beta_is_older_than_its_release() {
    assert!(v("1.0.0-beta") < v("1.0.0"));
    assert!(v("1.0.0") > v("1.0.0-rc.9"));
    assert!(v("1.0.0-alpha") < v("1.0.0-beta"));
    assert!(v("1.0.0-beta.2") < v("1.0.0-beta.10"));
    assert!(v("1.0.0-beta") < v("1.0.0-beta.1"));
    assert!(v("1.0.1-beta") > v("1.0.0"));
    assert!(v("2.0") > v("1.9.9"));
    assert_eq!(v("1.0"), v("1.0.0"));
}

#[test]
fn shown_version_is_short_and_plain() {
    assert_eq!(display(&"9".repeat(100)).len(), 32);
    assert_eq!(display("1.2.3\n<script>"), "1.2.3script");
    assert_eq!(display(" v1.2.3-rc1 "), "v1.2.3-rc1");
}

#[test]
fn only_https_overrides_are_used() {
    const D: &str = "https://example.test/update.json";
    assert_eq!(choose_url(None, D), D);
    assert_eq!(choose_url(Some("http://evil.test/x".into()), D), D);
    assert_eq!(choose_url(Some("ftp://x".into()), D), D);
    assert_eq!(choose_url(Some("".into()), D), D);
    assert_eq!(choose_url(Some(" HTTPS://mirror.test/u.json ".into()), D), "HTTPS://mirror.test/u.json");
}

#[test]
fn installer_must_come_from_the_feed_host() {
    let feed = "https://updates.eqqx2.com/update.json";
    assert!(same_host(feed, "https://updates.eqqx2.com/NetworkToolkit-setup.exe"));
    assert!(same_host(feed, "https://UPDATES.eqqx2.com:443/x.exe"));
    assert!(!same_host(feed, "https://evil.example/x.exe"));
    assert!(!same_host(feed, "https://updates.eqqx2.com.evil.example/x.exe"));
    assert!(!same_host(feed, "https://user@updates.eqqx2.com/x.exe"));
    assert!(!same_host(feed, "http://updates.eqqx2.com/x.exe"));
}

#[test]
fn sha256_must_be_64_hex_digits() {
    let good = "A".repeat(64);
    assert_eq!(clean_sha256(&good), Some("a".repeat(64)));
    assert!(clean_sha256("abc").is_none());
    assert!(clean_sha256(&"g".repeat(64)).is_none());
}
