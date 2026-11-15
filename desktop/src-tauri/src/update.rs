//! The one place the app talks to the internet: a small version file, fetched only when
//! the update check is on. It sends no account, no device id and no usage data.

use serde::{Deserialize, Serialize};
use std::{io::Read, time::Duration};
use crate::updatever;
use std::sync::Mutex;
use tauri::AppHandle;
use sha2::{Digest, Sha256};

const DEFAULT_URL: &str = "https://updates.eqqx2.com/update.json";
const MAX_BYTES: u64 = 64 * 1024;
/// Largest installer the app will download.
const MAX_INSTALLER: u64 = 128 * 1024 * 1024;

/// The installer found by the last check: its address and the SHA-256 the version file promised.
static PENDING: Mutex<Option<(String, String)>> = Mutex::new(None);

#[derive(Deserialize)]
struct Remote {
    version: String,
    url: Option<String>,
    notes: Option<String>,
    sha256: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    /// "disabled", "up-to-date", "available" or "unreachable"
    pub status: &'static str,
    pub current: String,
    pub latest: Option<String>,
    pub url: Option<String>,
    pub notes: Option<String>,
    /// True when the app can download and start the installer itself.
    pub can_install: bool,
    pub message: String,
}

#[tauri::command(async)]
pub fn check_update(app: AppHandle) -> UpdateInfo {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let base = |status: &'static str, message: &str| UpdateInfo {
        status,
        current: current.clone(),
        latest: None,
        url: None,
        notes: None,
        can_install: false,
        message: message.to_string(),
    };

    // The off switch comes first: with it off, no request is made.
    if !crate::settings::read(&app).update_check {
        return base("disabled", "Update check is turned off. No request was made.");
    }

    // A test override is honoured only when it is https; anything else falls back to the real address.
    let url = updatever::choose_url(std::env::var("NT_UPDATE_URL").ok(), DEFAULT_URL);
    let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(8)).user_agent("NetworkToolkit-update-check").build();
    let body = match agent.get(&url).call() {
        Ok(resp) => {
            let mut text = String::new();
            if resp.into_reader().take(MAX_BYTES).read_to_string(&mut text).is_err() {
                return base("unreachable", "The update file could not be read.");
            }
            text
        }
        Err(ureq::Error::Status(404, _)) => return base("unreachable", "No update information has been published yet."),
        Err(ureq::Error::Status(code, _)) => {
            return base("unreachable", &format!("The update server answered with an error (HTTP {code}). Try again later."))
        }
        Err(_) => return base("unreachable", "Could not reach the update server. You may be offline."),
    };

    let Ok(remote) = serde_json::from_str::<Remote>(&body) else {
        return base("unreachable", "The update file is not in the expected format.");
    };
    let (Some(now), Some(latest)) = (updatever::parse(&current), updatever::parse(&remote.version)) else {
        return base("unreachable", "The update file has an unreadable version number.");
    };

    // Only show a link that uses https, so a bad file cannot point at something else.
    let link = remote.url.filter(|u| u.starts_with("https://"));
    let notes = remote.notes.map(|n| n.chars().take(500).collect::<String>());
    let shown = updatever::display(&remote.version);
    if latest > now {
        // The app installs by itself only when the installer is on the same host as the version
        // file and the file names its SHA-256. Otherwise the link is shown for the person to open.
        let sha = remote.sha256.as_deref().and_then(updatever::clean_sha256);
        let installable = match (&link, &sha) {
            (Some(l), Some(_)) => updatever::same_host(&url, l),
            _ => false,
        };
        *PENDING.lock().unwrap() = match (&link, sha) {
            (Some(l), Some(h)) if installable => Some((l.clone(), h)),
            _ => None,
        };
        UpdateInfo { status: "available", current, latest: Some(shown.clone()), url: link, notes, can_install: installable, message: format!("Version {shown} is available.") }
    } else {
        *PENDING.lock().unwrap() = None;
        UpdateInfo { status: "up-to-date", current, latest: Some(shown), url: None, notes: None, can_install: false, message: "You have the latest version.".into() }
    }
}

/// Downloads the installer found by the last check, checks its SHA-256, starts it and closes the app.
/// The address and hash come from the app's own memory of the last check, never from the window.
#[tauri::command(async)]
pub fn install_update(app: AppHandle) -> Result<String, String> {
    let (url, want) = PENDING.lock().unwrap().clone().ok_or("Check for updates first.")?;
    let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(120)).user_agent("NetworkToolkit-update-check").build();
    let resp = agent.get(&url).call().map_err(|_| "Could not download the update. Check your connection and try again.".to_string())?;
    let mut bytes = Vec::new();
    resp.into_reader().take(MAX_INSTALLER + 1).read_to_end(&mut bytes).map_err(|_| "The download was interrupted.".to_string())?;
    if bytes.len() as u64 > MAX_INSTALLER {
        return Err("The update file is larger than expected, so it was not used.".into());
    }
    let got: String = Sha256::digest(&bytes).iter().map(|b| format!("{b:02x}")).collect();
    if got != want {
        return Err("The downloaded file does not match the published checksum, so it was not run.".into());
    }
    let dir = std::env::temp_dir().join("NetworkToolkit-update");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Could not prepare a download folder: {e}"))?;
    let file = dir.join("NetworkToolkit-setup.exe");
    std::fs::write(&file, &bytes).map_err(|e| format!("Could not save the update: {e}"))?;
    std::process::Command::new(&file).spawn().map_err(|e| format!("Could not start the installer: {e}"))?;
    app.exit(0);
    Ok("Installer started.".into())
}
