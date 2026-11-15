fn main() {
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        // Load Npcap's wpcap.dll only when a capture starts, so every other command works without Npcap.
        println!("cargo:rustc-link-lib=delayimp");
        println!("cargo:rustc-link-arg-bins=/DELAYLOAD:wpcap.dll");
        // Tauri's libraries need the Common Controls 6 manifest; without it Windows refuses to start the program.
        // The program runs as the calling user: VPN and hotspot commands need an administrator terminal.
        let dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
        println!("cargo:rustc-link-arg-bins=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg-bins=/MANIFESTINPUT:{dir}/eqnet.manifest");
        println!("cargo:rerun-if-changed=eqnet.manifest");
    }
}
