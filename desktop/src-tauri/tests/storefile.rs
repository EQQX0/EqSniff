//! Tests for reading the small JSON files. A damaged file is moved aside, never deleted.
#![allow(dead_code)]

#[path = "../src/storefile.rs"]
mod storefile;
use std::fs;

fn dir(name: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("nt-storefile-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&d);
    fs::create_dir_all(&d).unwrap();
    d
}

#[test]
fn missing_file_is_null() {
    let d = dir("missing");
    assert!(storefile::read_json(&d.join("x.json"), "damaged").unwrap().is_null());
}

#[test]
fn good_file_is_read() {
    let d = dir("good");
    fs::write(d.join("x.json"), r#"{"a":1}"#).unwrap();
    assert_eq!(storefile::read_json(&d.join("x.json"), "damaged").unwrap()["a"], 1);
    assert!(d.join("x.json").exists());
}

#[test]
fn damaged_file_is_kept_as_bak() {
    let d = dir("bad");
    let p = d.join("filters.json");
    fs::write(&p, "{ not json").unwrap();
    let err = storefile::read_json(&p, "Your file is damaged.").unwrap_err();
    assert!(err.starts_with("Your file is damaged."));
    assert!(!p.exists(), "moved away so a save cannot clobber it");
    assert_eq!(fs::read_to_string(d.join("filters.json.bak")).unwrap(), "{ not json");
    // After the move the store reads as never saved, and a second bad file gets its own name.
    assert!(storefile::read_json(&p, "damaged").unwrap().is_null());
    fs::write(&p, "also bad").unwrap();
    assert!(storefile::read_json(&p, "damaged").is_err());
    assert_eq!(fs::read_to_string(d.join("filters.json.bak")).unwrap(), "{ not json");
    assert_eq!(fs::read_to_string(d.join("filters.json.bak2")).unwrap(), "also bad");
}
