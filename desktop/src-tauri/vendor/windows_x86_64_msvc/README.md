# windows_x86_64_msvc 0.36.1 (stub)

The `pcap` crate depends on `windows-sys 0.36.1`, which depends on the real `windows_x86_64_msvc 0.36.1`.
That crate ships a prebuilt import library, `windows.lib`, in which `WaitOnAddress` and `WakeByAddressAll`
point at `vertdll.dll` (the secure-enclave runtime) instead of the normal synchronization DLL.
The linker picks those imports, so every thread park (tokio, Tauri async commands, event delivery) calls the
enclave versions and the app dies with an access violation inside `vertdll.dll`.

This crate has no code. It replaces the real one through `[patch.crates-io]` in `../../Cargo.toml`. A dummy `windows.lib` is still linked, but it holds no imports, so the bad `vertdll.dll` mappings are gone.
`pcap` only needs a handle type, WinSock types and `WaitForSingleObject`, which come from `kernel32` and `ws2_32`.

Check after a build (should print nothing for vertdll):
    dumpbin /imports network-toolkit.exe | findstr /i vertdll
