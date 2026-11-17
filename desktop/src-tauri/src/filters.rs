use std::fs;
use tauri::{AppHandle, Manager};

/// Filters are saved as one JSON file in the app data folder. The window owns the shape;
/// this side only stores it safely.
fn path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("filters.json"))
}

#[tauri::command]
pub fn get_filters(app: AppHandle) -> Result<serde_json::Value, String> {
    crate::storefile::read_json(&path(&app)?, "Your saved filters file is damaged.")
}

#[tauri::command]
pub fn save_filters(app: AppHandle, filters: serde_json::Value) -> Result<(), String> {
    let p = path(&app)?;
    let tmp = p.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(&filters).map_err(|e| e.to_string())?;
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

/// Small named JSON files for things like device labels. Only these names are allowed.
fn named(app: &AppHandle, name: &str) -> Result<std::path::PathBuf, String> {
    if !["labels", "capture-filter", "ip-storage", "ip-storage-deleted", "vpn-deleted", "cloud-session", "ip-shared", "ip-hidden", "ip-shared-favs"].contains(&name) {
        return Err("Unknown store.".into());
    }
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(format!("{name}.json")))
}

#[tauri::command]
pub fn get_store(app: AppHandle, name: String) -> Result<serde_json::Value, String> {
    crate::storefile::read_json(&named(&app, &name)?, "A saved file is damaged.")
}

#[tauri::command]
pub fn save_store(app: AppHandle, name: String, value: serde_json::Value) -> Result<(), String> {
    let p = named(&app, &name)?;
    let tmp = p.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &p).map_err(|e| e.to_string())
}
