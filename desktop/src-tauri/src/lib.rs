mod capture;
mod netaddr;
mod packet;
mod scannet;
mod settingscore;
mod storefile;
mod updatever;
mod pcapfile;
mod filters;
mod geo;
mod update;
mod settings;
mod scan;
mod vpn;
mod vpnconf;
mod vpnseal;
pub mod hotspot;
pub mod vpnengine;
pub mod killswitch;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(capture::CaptureState::default())
        .manage(scan::ScanState::default())
        .manage(vpn::VpnState::default())
        .manage(hotspot::HotspotState::default())
        .invoke_handler(tauri::generate_handler![
            capture::list_adapters,
            capture::start_capture,
            capture::poll_capture,
            capture::stop_capture,
            capture::replay_packet,
            capture::export_pcap,
            capture::import_pcap,
            filters::get_filters,
            filters::save_filters,
            filters::get_store,
            filters::save_store,
            geo::geo_lookup,
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
            vpn::vpn_sync_seal,
            vpn::vpn_sync_check,
            vpn::vpn_sync_open,
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
