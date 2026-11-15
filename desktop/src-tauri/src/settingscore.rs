//! What the app remembers, and how a settings file is read. No window code, so tests can build it.

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub update_check: bool,
    pub last_adapter: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self { update_check: true, last_adapter: None }
    }
}

impl Settings {
    /// Used when the file exists but cannot be trusted. Nothing is sent over the network.
    pub fn failed_closed() -> Self {
        Self { update_check: false, last_adapter: None }
    }
}

/// Turns the result of reading `settings.json` into settings. A missing file is a first run and
/// gets the defaults. A file that cannot be read or understood fails closed: the update check
/// stays off, so a damaged file can never cause a network request.
pub fn from_read(read: std::io::Result<String>) -> Settings {
    match read {
        Ok(text) => serde_json::from_str(&text).unwrap_or_else(|_| Settings::failed_closed()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Settings::default(),
        Err(_) => Settings::failed_closed(),
    }
}
