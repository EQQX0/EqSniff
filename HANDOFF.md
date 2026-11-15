# Handoff

Date: 2026-11-15 13:00 AST
Session summary: Built a WireGuard engine into the app (no WireGuard install needed) and tested it live against the user's Frankfurt config. Fixed the async-command crash at its root. Added capture-level hex matching, ran the full /24 scan, rebuilt the installer.

## Start here
1. Read README.md for the project map. `START-HERE.txt` lists files that live outside this folder.
2. Verify: `cd desktop; npm test` (45 checks) and `cd desktop/src-tauri; cargo test --tests` (5 pcap, 6 VPN parser, 3 VPN engine tests). Set `$env:CARGO_TARGET_DIR='C:/nt-target'; $env:LIBPCAP_LIBDIR='C:\nt-libs'` first.
3. Next step: the user's call. Open items are under "Unfinished".

## Where we stopped
Everything asked for is built and tested. The Ember glass redesign (top nav, glass cards, motion) and the review fixes since commit a648940 are NOT committed yet. The built-in VPN engine passed a live test with the user's own Frankfurt config: the public IP changed through the tunnel and went back after Deactivate, with no leftover adapter or routes.

## Changes this session
- `desktop/src-tauri/src/vpnengine.rs` (new): the engine. A second copy of the app runs elevated (`network-toolkit.exe --vpn-run <folder> <name>`), makes a Wintun adapter, runs the WireGuard protocol with `boringtun`, and sets address, routes and DNS with `netsh`. Files next to the tunnel: `.state`, `.stop`, `.log`.
- `desktop/src-tauri/src/vpn.rs`: no longer calls WireGuard for Windows. Status comes from the state file plus a check that the pid is this program. Public key is computed in-process.
- `desktop/src-tauri/src/main.rs`: `--vpn-run` entry. `lib.rs`: `pub mod vpnengine`.
- `desktop/src-tauri/vendor/wintun/` (new): `wintun.dll` 0.14.1 (zip SHA-256 07c25618...ef51 matches wintun.net; Authenticode valid, WireGuard LLC) and its licence. Bundled by `tauri.conf.json` resources.
- `desktop/src-tauri/vendor/windows_x86_64_msvc/` (new) + `[patch.crates-io]` + `build.rs`: fixes the async crash (see Decisions).
- Capture-level hex matching: `capturefilter.ts`, `CaptureView.tsx`, `capture.rs`, 45 filter checks.
- Tests: `tests/vpnengine.rs` (new, 3 tests).
- Removed the temporary `dbg.rs` probe.
- Installer: Tauri's NSIS template has a "Create desktop shortcut" box on its last page. Portable zip now holds `wintun.dll` too.

## Hotspot page (added later)
- New `desktop/src-tauri/src/hotspot.rs`, `desktop/src/views/HotspotView.tsx`, `tests/hotspot.rs` (6 tests), nav entry, api section, Help entry.
- Verified: unit tests, tsc, build, no vertdll import, and the read-only PowerShell scripts (adapter list, sharing read, hotspot status) ran and returned sane JSON on this PC. This PC has a Wi-Fi adapter (MediaTek, disconnected).
- NOT verified live: Start/Stop Hotspot, Share internet, Reset, the elevated result-file round trip. The sharing read returned no connections without admin; it may under-report, so check the ON chip against Windows.
- Names in the devices table are placeholders ("Unnamed device"); no vendor lookup exists in the repo.

## Hotspot page: OctoSniff-style layout and auto sharing (added later)
- `components/ui/Select.tsx` (new): accessible listbox dropdown (combobox pattern, arrows/Home/End/Enter/Esc/typeahead, outside click). Used only by the Hotspot page.
- `HotspotView.tsx`: two cards in one row (stack under 900px), both adapter pickers list every Windows connection (connected real adapters first, then virtual or disconnected, tags "Not connected"/"Virtual"). Switch "Share internet automatically when the hotspot starts" (default on); the public adapter and the switch are saved in `hotspot.json` via the new `hotspot_prefs` command. While the hotspot is on, the private picker auto-selects the hotspot adapter.
- `hotspot.rs`: `hotspot_start` snapshots adapters, starts the hotspot, polls up to 15 s with `pick_hotspot_adapter`, then runs the existing elevated sharing apply (one UAC). `hotspot_stop` resets sharing first when `sharing.json` has `viaHotspot` (only sharing started by the auto path; manual sharing is left alone, so Stop Hotspot does not kill a wired share). The job now carries `note` and `warning`. If the adapter is not found or apply fails, the hotspot stays on and a warning tells the user to pick Private by hand.
- Tests: 4 new in `tests/hotspot.rs` (ordering, picking, no-guess cases, pref check), 10 total.
- NOT verified live (would cut the connection): auto start/stop, whether Windows allows ICS on top of Mobile Hotspot, the detection on real hardware. "Loopback Pseudo-Interface" is not listed (Get-NetAdapter does not return it).

## IP Storage page (added later)
- New `desktop/src/views/IpStorageView.tsx`, nav entry on App.tsx (next to Devices), Help FAQ entry. Reused the existing generic store (`filters.rs` `get_store`/`save_store`), adding `"ip-storage"` to the allowed store names; no new Tauri commands or `api.ts` changes needed since `getStore`/`saveStore` already take a store name.
- A plain address book: address (free text, up to 100 characters) and note (up to 500 characters) per row, search by either, add/edit through a modal form, delete with a confirm modal. Empty state: "No saved addresses yet." No username field, no link to captures or scans.
- Added `BookmarkIcon` to `icons.tsx` for the empty state.
- Verified: `npx tsc --noEmit` clean, `npm test` still 45 checks, `cargo test --tests` still 27 Rust tests (6 hotspot, 5 pcap, 6 VPN parser, 3 VPN engine, 7 VPN extras), `cargo build` clean. Live-tested with the debug exe plus `npm run dev` and a CDP script driving the real window: add, a second add, search (matches narrowed correctly), edit, and delete all round-tripped through `get_store`/`save_store` (checked the stored JSON directly before and after each step). 8 of 8 checks passed.

## Features added or updated
- VPN page: runs tunnels itself. Windows shows its admin prompt on every Activate; Deactivate needs none.
- Capture filter: "Payload starts with (hex)", up to 8 bytes, IPv4 TCP and UDP.
- Full-subnet scan verified: 254 of 254 addresses in 41 s.

## Decisions and why
- Built the VPN into the app (user's choice) with userspace WireGuard plus the signed Wintun driver, so no driver of our own is needed. Kill switch is optional per tunnel: WFP filters in a dynamic session live as long as the elevated engine process. Without it, if the app dies the adapter vanishes and traffic returns to the normal route.
- Server traffic is kept out of the tunnel by splitting the default route around the server address (up to 32 routes). A first try with `IP_UNICAST_IF` did not stop a loop (900k packets in 5 s), so the split route is the fix and a loop guard also drops packets aimed at the server.
- The engine says hello to the server before changing any route, so a dead server or wrong key gives a clear message.
- The elevated copy reads the `.conf` from a folder the user can write, and re-checks it with the same parser. Anyone who can already run code as the user could swap the file between the prompt and the read.
- Root cause of the async crash: `pcap 2.5` pulls `windows-sys 0.36.1`, whose `windows_x86_64_msvc 0.36.1` import library maps `WaitOnAddress` and `WakeByAddressAll` to `vertdll.dll`. Tokio and Tauri threads that park then run the wrong code and crash. A local empty stand-in crate removes it; `dumpbin /imports` now shows `api-ms-win-core-synch-l1-2-0.dll`. Async commands work again (`async fn`, `spawn`, `spawn_blocking` all survived a live test). VPN commands stay plain, which is fine.
- Refuse PostUp/PreUp/PostDown/PreDown, rewrite imported files from parsed values.
- Declined "PSN Username AI" and the other features that identify people or addresses (see `replica/features.csv` skip rows).
- Did not scan outside the user's own network.

## Unfinished (kept on purpose)
- DNS for `updates.eqqx2.com` is done (CNAME to Vercel, certificate issued). `DEFAULT_URL` now uses it; the release is 0.2.0.
- OctoSniff screens not seen: Tools submenu, Process Filters, Hotkeys, Appearance, Account, Link Account, Start Sniff dropdown, FAQ, tutorial chapters 2 to 4. Needs the user's screenshots.
- VPN: kill switch, edit tunnel and log tab are built but the kill switch has not been tested live (needs an elevated run). No new keys. IPv6 MTU note in the log is harmless. DNS may still leak through other adapters (Windows multi-homed lookup).
- Installer is self-signed (`release/EqSniff-selfsigned.cer` must be imported by hand). The installer was not run end to end after the engine change.
- Candidate OctoSniff features not built: ISP filters, device categories, manual device add, auto-remove inactive IPs, buffer settings, in-app changelog, tutorial.

## Cleaned up this session
- Dropped: none requested.
- Finished: hex capture filter, subnet scan, crash root cause, built-in VPN. Also restored the starter filter "Secure web traffic (port 443)" that a test run deleted from the saved filters by mistake.

## Open questions and blockers
- Which alternative to "PSN Username AI" the user wants, if any: needs the user.
- Does the user want `C:\nt-target` and `C:\nt-libs` moved into this folder? They stay outside for now because `LIBPCAP_LIBDIR` points at `C:\nt-libs`.

## Env and secrets (names only, never values)
- `CARGO_TARGET_DIR` : set to `C:/nt-target` (short path, Windows path limit), not a secret.
- `LIBPCAP_LIBDIR` : set to `C:\nt-libs`, folder with `wpcap.lib`.
- `NT_UPDATE_URL` : optional override for the update check URL.
- `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` : set to `--remote-debugging-port=9222` only for test runs.
- `%APPDATA%\app.networktoolkit.desktop\vpn\Frankfurt-wireguard.conf` is the user's own test tunnel (kept; the user can delete it on the VPN page).
- Saved VPN tunnel files in `%APPDATA%\app.networktoolkit.desktop\vpn\` contain private keys. Never copy them into the repo or docs.
- `_archive/web-dashboard/.env.example` is the only env file; it is a template. `.env*` is git-ignored: yes.

## Git state
Branch `main`, origin https://github.com/EQQX0/EqSniff (private). Work through a648940 is committed (not pushed); the redesign and review fixes are uncommitted. Stashes: none.

## Release 0.2.2 (latest)
- App renamed EqNetwork (productName, window title, top bar); icons regenerated from `desktop/src-tauri/icons/brand/eq-10-ember.png`. Bundle identifier is unchanged so saved data stays; the installer installs next to an old "Network Toolkit" install.
- Filters are Show or Hide (`mode`), one filter system: the separate capture filter box was removed (`capturefilter.ts` is now unused). Capture table keeps the latest 3,000 packets.
- Capture table: sticky heading bar above the list, sortable headings, Label column saved in IP Storage (`lib/ipstore.ts`, stored in the entry's `note` field), flags via bundled `flag-icons`, time without milliseconds, Copy/Replay row buttons removed (the `replay_packet` command still exists).
- In-app update: "Update now" downloads the installer from the feed host, checks the SHA-256 in `update.json`, starts it. Feed and installer are at https://updates.eqqx2.com (`update.json`, `EqNetwork-setup.exe`), deployed from the Vercel project `eqsniff-updates`.
- Live-tested: capture only from the chosen adapter, Show/Hide filters, sorting, labels. NOT live-tested: Hotspot start/stop and sharing (unit tests only). Live test scripts drive the window and can steal focus; do not run them while the user is gaming.

## Optional IP Storage sync (not released yet)
- Supabase project `eqnetwork` (ref bswzptrmeeobbnthjioz, eu-central-1). Table `ip_entries` with row-level rules from `desktop/supabase/migrations/0001_ip_storage.sql` (applied).
- App side: `src/lib/cloud.ts` (email+password auth, merge sync, background sync after edits), `src/lib/ipmerge.ts` (pure two-way merge, newest label wins, deletions tracked in store `ip-storage-deleted`), `src/components/CloudSync.tsx` (Settings card). All IP Storage writes go through `saveEntries` in `ipstore.ts`.
- Only the public publishable key is in the app. Session (email + tokens, never the password) is in store `cloud-session`. CSP `connect-src` allows the project URL only.
- Tests: `npm test` (includes `tests/ipmerge.test.mjs`). Checked live: signed-out requests read nothing and cannot write. Not yet done: a real sign-up/sign-in round trip in the app, and a release build. New accounts must confirm their email (project default).
