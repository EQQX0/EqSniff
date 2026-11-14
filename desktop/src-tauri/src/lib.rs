mod capture;
mod filters;
mod geo;
mod update;
mod settings;
mod scan;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(capture::CaptureState::default())
        .manage(scan::ScanState::default())
        .invoke_handler(tauri::generate_handler![
            capture::list_adapters,
            capture::start_capture,
            capture::poll_capture,
            capture::stop_capture,
            capture::replay_packet,
            filters::get_filters,
            filters::save_filters,
            filters::get_store,
            filters::save_store,
            geo::geo_lookup,
            update::check_update,
            scan::scan_start,
            scan::scan_poll,
            scan::scan_cancel,
            settings::get_settings,
            settings::set_settings,
            settings::data_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the app");
}
