//! Tests for reading the settings file. A damaged file must never switch the update check on.
#![allow(dead_code)]

#[path = "../src/settingscore.rs"]
mod settingscore;
use settingscore::*;
use std::io::{Error, ErrorKind};

#[test]
fn first_run_uses_defaults() {
    let s = from_read(Err(Error::from(ErrorKind::NotFound)));
    assert!(s.update_check);
    assert!(s.last_adapter.is_none());
}

#[test]
fn good_file_is_read() {
    let s = from_read(Ok(r#"{"updateCheck": false, "lastAdapter": "eth0"}"#.into()));
    assert!(!s.update_check);
    assert_eq!(s.last_adapter.as_deref(), Some("eth0"));
    assert!(from_read(Ok("{}".into())).update_check, "missing keys take the default");
}

#[test]
fn corrupt_file_fails_closed() {
    for bad in ["", "{", "not json", "[1,2]", r#"{"updateCheck": "yes"}"#, "\u{0}\u{0}"] {
        assert!(!from_read(Ok(bad.into())).update_check, "{bad:?}");
    }
}

#[test]
fn unreadable_file_fails_closed() {
    for kind in [ErrorKind::PermissionDenied, ErrorKind::InvalidData, ErrorKind::Other] {
        assert!(!from_read(Err(Error::from(kind))).update_check, "{kind:?}");
    }
}
