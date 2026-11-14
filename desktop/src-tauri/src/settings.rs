use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};

/// Everything the app remembers. Stored as one JSON file in the user's app data folder.
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

fn file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

fn read(app: &AppHandle) -> Settings {
    file(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
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
