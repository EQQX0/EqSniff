---
type: decision
project: EqSniff
date: 2026-11-16
status: active
tags: [decision, project/EqSniff]
---
# The command line is its own crate
Chose **a separate crate `desktop/cli` that depends on the app library** over **a second binary inside the app package** because tauri-build embeds the release administrator manifest into every binary of a package, so a second binary would demand elevation (os error 740) in debug and test runs.

Rejected: a second bin target in `src-tauri`.
Context: `desktop/cli/` (own `build.rs`: delay-load wpcap.dll and embed a Common Controls 6 manifest), `src-tauri/src/cli.rs`, cargo feature `cli` enabling `tauri/test` for `mock_context`. Without the manifest Windows refuses to start it (0xC0000139).
Seen in: [[Projects/EqSniff/Handoffs/2026-11-16-0047|handoff 2026-11-16]]
