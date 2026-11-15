#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let a: Vec<String> = std::env::args().collect();
    if a.len() == 4 && a[1] == "--vpn-run" {
        std::process::exit(network_toolkit_lib::vpnengine::run(&a[2], &a[3]));
    }
    network_toolkit_lib::run()
}
