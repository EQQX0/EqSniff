fn main() {
    // Load Npcap's wpcap.dll only when a capture is first used, so the app still opens
    // (and can explain what is missing) on a PC where Npcap is not installed.
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        println!("cargo:rustc-link-lib=delayimp");
        println!("cargo:rustc-link-arg-bins=/DELAYLOAD:wpcap.dll");

        // The pcap crate's old windows-sys import library sends WaitOnAddress to vertdll.dll and crashes
        // tokio and Tauri async commands. vendor/windows_x86_64_msvc replaces it; see its README.md.
    }
    // The release app always runs as administrator, so VPN, the kill switch and the hotspot do not ask Windows for
    // permission each time. Debug and test builds stay unelevated so `cargo test` can run them.
    if std::env::var("PROFILE").as_deref() == Ok("release") {
        let windows = tauri_build::WindowsAttributes::new().app_manifest(include_str!("windows-app.manifest"));
        tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows)).expect("failed to run tauri-build");
    } else {
        tauri_build::build();
    }
}
