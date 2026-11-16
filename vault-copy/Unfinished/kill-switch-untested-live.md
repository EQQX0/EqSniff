---
type: unfinished
project: EqSniff
date: 2026-11-16
state: open
tags: [unfinished, project/EqSniff]
---
# VPN kill switch untested live
Where: `desktop/src-tauri/src/killswitch.rs`
Status: Built; unit tests pass; never run live because it needs an elevated run and cuts the connection.
To resume: turn on the kill switch for a test tunnel, activate, then kill the tunnel and confirm traffic stays blocked.
Raised in: [[Projects/EqSniff/Handoffs/2026-11-16-0047|handoff 2026-11-16]]
