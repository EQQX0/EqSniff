//! Reading the app's small JSON files. A file that exists but will not parse is moved aside
//! (never deleted), so a later save cannot overwrite data that might still be recovered.

use std::{fs, io::ErrorKind, path::{Path, PathBuf}};

/// Renames `p` to `<name>.bak` (or `<name>.bak2`, `.bak3`, ... if one is already there).
pub fn quarantine(p: &Path) -> std::io::Result<PathBuf> {
    let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let mut i = 1u32;
    loop {
        let suffix = if i == 1 { ".bak".to_string() } else { format!(".bak{i}") };
        let target = p.with_file_name(format!("{name}{suffix}"));
        if !target.exists() {
            fs::rename(p, &target)?;
            return Ok(target);
        }
        i += 1;
    }
}

/// `Ok(Null)` when the file has never been saved.
pub fn read_json(p: &Path, damaged: &str) -> Result<serde_json::Value, String> {
    match fs::read_to_string(p) {
        Ok(s) => serde_json::from_str(&s).map_err(|_| match quarantine(p) {
            Ok(b) => format!("{damaged} It was kept as {}.", b.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()),
            Err(_) => damaged.to_string(),
        }),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(serde_json::Value::Null),
        Err(e) => Err(format!("{damaged} ({e})")),
    }
}
