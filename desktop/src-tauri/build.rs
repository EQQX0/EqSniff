fn main() {
    // Load Npcap's wpcap.dll only when a capture is first used, so the app still opens
    // (and can explain what is missing) on a PC where Npcap is not installed.
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        println!("cargo:rustc-link-lib=delayimp");
        println!("cargo:rustc-link-arg-bins=/DELAYLOAD:wpcap.dll");
    }
    tauri_build::build()
}
