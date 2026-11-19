mod capture;
mod netaddr;
mod packet;
mod scannet;
mod settingscore;
mod storefile;
mod updatever;
mod inspect;
mod pcapfile;
mod pcapng;
mod filters;
mod geo;
mod ipinfo;
#[cfg(feature = "cli")]
pub mod cli;
mod update;
mod settings;
mod scan;
mod vpn;
mod vpnconf;
pub mod hotspot;
pub mod vpnengine;
pub mod killswitch;

#[cfg_attr(not(feature = "cli"), allow(dead_code))]
/// The shared state every command reads. The window and the command line both use it.
pub(crate) fn manage_state(b: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    b.manage(capture::CaptureState::default())
        .manage(scan::ScanState::default())
        .manage(vpn::VpnState::default())
        .manage(hotspot::HotspotState::default())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    manage_state(tauri::Builder::default())
        .setup(|app| {
            use tauri::Manager;
            if let Ok(dir) = app.path().app_data_dir() {
                ipinfo::init(dir.join("ipdb"), true);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            capture::list_adapters,
            capture::start_capture,
            capture::poll_capture,
            capture::stop_capture,
            capture::replay_packet,
            capture::export_pcap,
            capture::export_pcapng,
            capture::import_pcap,
            capture::packet_detail,
            filters::get_filters,
            filters::save_filters,
            filters::get_store,
            filters::save_store,
            geo::geo_lookup,
            ipinfo::ip_details,
            update::check_update,
            update::install_update,
            scan::scan_start,
            scan::scan_poll,
            scan::scan_cancel,
            vpn::vpn_status,
            vpn::vpn_import,
            vpn::vpn_set,
            vpn::vpn_job,
            vpn::vpn_delete,
            vpn::vpn_update,
            vpn::vpn_read,
            vpn::vpn_log,
            vpn::vpn_set_option,
            vpn::vpn_sync_list,
            vpn::vpn_sync_read,
            vpn::vpn_sync_write,
            hotspot::hotspot_status,
            hotspot::hotspot_save,
            hotspot::hotspot_prefs,
            hotspot::hotspot_start,
            hotspot::hotspot_stop,
            hotspot::hotspot_job,
            hotspot::hotspot_devices,
            hotspot::sharing_status,
            hotspot::sharing_adapters,
            hotspot::sharing_apply,
            hotspot::sharing_reset,
            settings::get_settings,
            settings::set_settings,
            settings::data_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the app");
}
