use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};

pub use crate::settingscore::Settings;
use crate::settingscore::from_read;

fn file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

/// Reads the settings. A missing file gives the defaults; a file that is there but cannot be
/// read or understood turns the update check off, so nothing is sent over the network.
pub(crate) fn read(app: &AppHandle) -> Settings {
    match file(app) {
        Ok(p) => from_read(fs::read_to_string(p)),
        Err(_) => Settings::failed_closed(),
    }
}

#[tauri::command]
pub fn get_settings(app: AppHandle) -> Settings {
    read(&app)
}

#[tauri::command]
pub fn set_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    let path = file(&app)?;
    // Write to a temp file first so a crash cannot leave half a settings file.
    let tmp = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn data_folder(app: AppHandle) -> Result<String, String> {
    Ok(file(&app)?.parent().map(|p| p.display().to_string()).unwrap_or_default())
}
