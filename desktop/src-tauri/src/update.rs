//! The one place the app talks to the internet: a small version file, fetched only when
//! the update check is on. It sends no account, no device id and no usage data.

use serde::{Deserialize, Serialize};
use std::{io::Read, time::Duration};
use tauri::AppHandle;

const DEFAULT_URL: &str = "https://eqsniff-updates.vercel.app/update.json";
const MAX_BYTES: u64 = 64 * 1024;

#[derive(Deserialize)]
struct Remote {
    version: String,
    url: Option<String>,
    notes: Option<String>,
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
    pub message: String,
}

fn parse(v: &str) -> Option<(u64, u64, u64)> {
    let mut it = v.trim().trim_start_matches('v').split('.');
    let a = it.next()?.parse().ok()?;
    let b = it.next().unwrap_or("0").parse().ok()?;
    let c = it.next().unwrap_or("0").split(['-', '+']).next()?.parse().ok()?;
    Some((a, b, c))
}

#[tauri::command]
pub fn check_update(app: AppHandle) -> UpdateInfo {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let base = |status: &'static str, message: &str| UpdateInfo {
        status,
        current: current.clone(),
        latest: None,
        url: None,
        notes: None,
        message: message.to_string(),
    };

    // The off switch comes first: with it off, no request is made.
    if !crate::settings::read(&app).update_check {
        return base("disabled", "Update check is turned off. No request was made.");
    }

    let url = std::env::var("NT_UPDATE_URL").unwrap_or_else(|_| DEFAULT_URL.to_string());
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
        Err(_) => return base("unreachable", "Could not reach the update server. You may be offline."),
    };

    let Ok(remote) = serde_json::from_str::<Remote>(&body) else {
        return base("unreachable", "The update file is not in the expected format.");
    };
    let (Some(now), Some(latest)) = (parse(&current), parse(&remote.version)) else {
        return base("unreachable", "The update file has an unreadable version number.");
    };

    // Only show a link that uses https, so a bad file cannot point at something else.
    let link = remote.url.filter(|u| u.starts_with("https://"));
    let notes = remote.notes.map(|n| n.chars().take(500).collect::<String>());
    if latest > now {
        UpdateInfo { status: "available", current, latest: Some(remote.version.clone()), url: link, notes, message: format!("Version {} is available.", remote.version) }
    } else {
        UpdateInfo { status: "up-to-date", current, latest: Some(remote.version), url: None, notes: None, message: "You have the latest version.".into() }
    }
}
