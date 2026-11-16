---
type: decision
project: EqSniff
date: 2026-11-16
status: active
tags: [decision, project/EqSniff]
---
# Vendored empty windows_x86_64_msvc crate
Chose **a local empty stand-in crate under `[patch.crates-io]`** over **leaving pcap's old import library** because pcap 2.5 pulls windows-sys 0.36.1, whose import library sends `WaitOnAddress` to `vertdll.dll` and crashes async code.

Rejected: keeping the original crate; async commands crashed.
Context: `desktop/src-tauri/vendor/windows_x86_64_msvc/` (README has the details), `build.rs`, and the same patch line in `desktop/cli/Cargo.toml`. Check `dumpbin /imports` after dependency changes.
Seen in: [[Projects/EqSniff/Handoffs/2026-11-16-0047|handoff 2026-11-16]]
