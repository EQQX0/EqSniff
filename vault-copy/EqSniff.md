---
type: project
project: EqSniff
status: active
repo: C:\Users\Admin\Desktop\EqSniff
last_handoff: 2026-11-16 00:47
tags: [project, project/EqSniff]
---
# EqSniff

EqNetwork: a Windows network toolkit (Tauri 2 + React) with a Capture IP list for game-server owners, filters, VPN, hotspot, optional account sync and an `eqnet.exe` command line.

## Now
- Status: active, version 0.2.14 published and pushed.
- Next step: the user tries the window features in 0.2.14 and reports what they see (see [[Projects/EqSniff/Unfinished/window-features-untested|window features untested]]).
- Latest handoff: [[Projects/EqSniff/Handoffs/2026-11-16-0047]]

## Open items
- [[Projects/EqSniff/Unfinished/window-features-untested]] : built, not opened in the real window
- [[Projects/EqSniff/Unfinished/capture-time-filter-lists]] : recording filter still single-value
- [[Projects/EqSniff/Unfinished/ml-player-detection]] : needs labelled data
- [[Projects/EqSniff/Unfinished/kill-switch-untested-live]] : needs an elevated run
- [[Projects/EqSniff/Unfinished/supabase-redirect-url]] : manual step for the owner
- [[Projects/EqSniff/Unfinished/account-roundtrip-untested]] : sign-up and sync never run end to end
- [[Projects/EqSniff/Unfinished/self-signed-installer]] : Windows warning on other PCs
- ~~[[Projects/EqSniff/Unfinished/port-scan-own-ip]]~~ : dropped 2026-11-16
- ~~[[Projects/EqSniff/Unfinished/octosniff-extras]]~~ : dropped 2026-11-16

## Decisions
- [[Projects/EqSniff/Decisions/offline-isp-city-databases]] : chose local databases over ip-api.com
- [[Projects/EqSniff/Decisions/online-needs-both-ways-no-icmp]] : chose real replies over any packet
- [[Projects/EqSniff/Decisions/cli-separate-crate]] : chose a separate crate over a second binary
- [[Projects/EqSniff/Decisions/keep-ip-list-across-captures]] : chose keeping over clearing at Start
- [[Projects/EqSniff/Decisions/no-identifying-features]] : no PSN Username AI, no scans of other people
- [[Projects/EqSniff/Decisions/vendored-msvc-stand-in]] : empty stand-in crate fixes async crash

## History
- [[Projects/EqSniff/Handoffs/2026-11-16-0047]] : 0.2.9 to 0.2.14, offline ISP and city, right-click menu, filter window, eqnet

## Links
- [[Projects/EqSniff/README|README]]
- [[Projects/EqSniff/HANDOFF|HANDOFF]]
- Repo: `C:\Users\Admin\Desktop\EqSniff`
