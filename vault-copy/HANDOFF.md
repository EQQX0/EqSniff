---
type: handoff
project: EqSniff
date: 2026-11-16 00:47
tags: [handoff, project/EqSniff]
---
# Handoff

Date: 2026-11-16 00:47 AST (from the system clock)
Session summary: The user runs a Minecraft server and wanted to tell real players from noise. This session reworked the Capture IP list (ISP, city and VPN flag now come from databases on the computer), added right-click actions, a 3-step filter window with lists, a command line (`eqnet.exe`) and AI guide, and fixed "online" detection. Versions 0.2.9 to 0.2.14 are published and pushed. Dashboard: [[Projects/EqSniff/EqSniff|EqSniff]].

## Start here
1. Read [[Projects/EqSniff/README|README]] for the project map and the release steps.
2. Next step: the user installs 0.2.14 and tries the window features that were only checked by logic (see [[Projects/EqSniff/Unfinished/window-features-untested|window features untested]]). Close EqNetwork first, then run `C:\nt-target\release\bundle\nsis\EqNetwork_0.2.14_x64-setup.exe /S` (or let the in-app updater do it). Ask what they see before changing anything.
3. Verify: `cd C:\Users\Admin\Desktop\EqSniff\desktop; npx tsc --noEmit; npm test` should print 88, 15 and 8 checks. `C:\nt-target\release\eqnet.exe lookup 8.8.8.8 --details` should return Mountain View, Google LLC.

## Where we stopped
Everything asked for is built, released (0.2.14, commit a6d9657 on main) and pushed. The installed app on the user's PC was 0.2.14 at 00:40 on 2026-11-16 (they ran the in-app update). Nothing is in progress. The only uncommitted change is the tidy-up from this handoff: `updates-site/` was copied into the repo folder and two lines were added to `.gitignore`. The user's last topics were the handoff and what features are left.

## Changes this session
- `desktop/src/views/CaptureIps.tsx`: IP list with Type, Port, City, ISP, VPN columns, right-click menu, online rule (needs recent packets both ways, ICMP skipped), 3 packets each way to appear, sticky header `z-10`.
- `desktop/src/views/CaptureView.tsx`: auto city/ISP lookup in batches (timer in a ref), Start keeps the IP list, clock keeps running after Stop, removed Server port, lookup button and Minecraft log import.
- `desktop/src/components/FilterWizard.tsx` (new), `FiltersView.tsx`, `lib/filters.ts`, `lib/capturefilter.ts`: 3-step filter window, lists, CIDR, country, ISP, hex lists, port lists and ranges.
- `desktop/src/lib/ipstore.ts`: a label keeps its last 3 addresses (`capLabel`).
- `desktop/src/App.tsx`: `hideIsp` makes a Hide filter from the right-click menu.
- `desktop/src-tauri/src/ipinfo.rs` (rewritten): ISP from `resources/asn.mmdb`, city from a downloaded `ipdb\city.mmdb`, VPN flag guessed from the network name.
- `desktop/src-tauri/src/cli.rs`, `desktop/cli/` (new), `docs/AI-GUIDE.md` (new): the command line and the guide for AIs.
- `desktop/src-tauri/src/lib.rs`: `manage_state`, `setup` hook that starts the city download, `cli` cargo feature, `ip_details` registered.
- `updates-site/` (new in repo, moved from a temp folder), `.gitignore`: the update feed now lives in the project.

## Features added or updated
- Capture IP list and right-click menu: `CaptureIps.tsx`. Try: start a capture, right-click a row.
- Filters window: Filters page, New filter. Country and ISP filters only match addresses already looked up.
- `eqnet`: `C:\nt-target\release\eqnet.exe help`. Capture, IPs, lookup, scan, VPN, hotspot, filters, settings, backup, raw `call`.
- Offline ISP and city: the city database (127 MB) downloads on the first start of 0.2.13 or newer.

## Decisions and why
- [[Projects/EqSniff/Decisions/offline-isp-city-databases|Local ISP and city databases]]: chose local files over ip-api.com so it is instant, offline and always up.
- [[Projects/EqSniff/Decisions/online-needs-both-ways-no-icmp|Online needs real replies, ICMP ignored]]: chose this over "any recent packet" because a closed game port answers with ICMP errors.
- [[Projects/EqSniff/Decisions/cli-separate-crate|CLI is its own crate]]: chose a crate beside the app over a second binary inside it, so it avoids the administrator manifest.
- [[Projects/EqSniff/Decisions/keep-ip-list-across-captures|Keep the IP list across captures]]: chose keeping it over clearing at Start, at the user's request.
- [[Projects/EqSniff/Decisions/no-identifying-features|No features that identify people]]: declined PSN Username AI and port scans of other people's IPs.
- [[Projects/EqSniff/Decisions/vendored-msvc-stand-in|Vendored msvc stand-in crate]]: older decision, kept so it is not undone.

## Unfinished (kept on purpose)
- [[Projects/EqSniff/Unfinished/window-features-untested|Window features untested]]: right-click menu, 3-step filter window, Start/Stop keeps IPs, header fix, dots turning red. Only logic and CLI were tested.
- [[Projects/EqSniff/Unfinished/capture-time-filter-lists|Capture-time filter lists]]: the filter that limits what is recorded still takes one address, port and hex box.
- [[Projects/EqSniff/Unfinished/ml-player-detection|ML player detection]]: needs many labelled addresses first.
- [[Projects/EqSniff/Unfinished/kill-switch-untested-live|VPN kill switch untested live]]: needs an elevated run.
- [[Projects/EqSniff/Unfinished/supabase-redirect-url|Supabase redirect URL]]: manual step for the owner.
- [[Projects/EqSniff/Unfinished/account-roundtrip-untested|Account round trip untested]]: sign-up, sign-in, reset email, tunnel sync.
- [[Projects/EqSniff/Unfinished/self-signed-installer|Self-signed installer]]: Windows warns on other PCs.

## Cleaned up this session
- Dropped: [[Projects/EqSniff/Unfinished/port-scan-own-ip|Port scan on own IP]] and [[Projects/EqSniff/Unfinished/reference-app-extras|reference app extras]] (device categories, manual device add, auto-remove inactive IPs, buffer settings, changelog, tutorial), at the user's request.
- Finished: the update-feed folder moved from a temp scratch folder to `C:\Users\Admin\Desktop\EqSniff\updates-site` so releases keep working (files copied, `.vercel` link included; the temp copy is left in place).

## Open questions and blockers
- Does the user want a second look at "players missing" reports once they test 0.2.14? Players behind a relay (playit.gg, ngrok) or on the same Wi-Fi never show their real IP in the list.
- The repo copies of `README.md` and `HANDOFF.md` are older than the vault ones. Ask before overwriting them.

## Env and secrets (names only, never values)
- `CARGO_TARGET_DIR` = `C:/nt-target`, `LIBPCAP_LIBDIR` = `C:\nt-libs`: build paths, not secrets.
- `updates-site/.env.local`: Vercel link data, git-ignored, template none.
- `.env` files are git-ignored: yes. The only env file in the repo is `_archive/web-dashboard/.env.example`.
- VPN tunnel files in `%APPDATA%\app.networktoolkit.desktop\vpn\` contain private keys; never copy them.

## Git state
Branch `main`, last commit `a6d9657` "Release 0.2.14", remote origin https://github.com/EQQX0/EqSniff (private), pushed. Uncommitted: `.gitignore` (two lines) and the new `updates-site/` folder (the .exe and `.vercel` inside are ignored). Stashes: none.
