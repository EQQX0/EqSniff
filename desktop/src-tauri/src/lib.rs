mod capture;
mod filters;
mod geo;
mod update;
mod settings;
mod traffic;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(capture::CaptureState::default())
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
            traffic::traffic_status,
            traffic::traffic_limit,
            traffic::traffic_stop,
            settings::get_settings,
            settings::set_settings,
            settings::data_folder,
        ])
        .build(tauri::generate_context!())
        .expect("error while building the app")
        .run(|_app, event| {
            if let tauri::RunEvent::Exit = event {
                traffic::stop_on_exit();
            }
        });
}
