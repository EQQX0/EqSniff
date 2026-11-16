---
type: readme
project: EqSniff
date: 2026-11-16 00:47
tags: [readme, project/EqSniff]
---
# EqSniff (the app is called EqNetwork)

Last updated: 2026-11-16 00:47 AST

A Windows desktop network toolkit. It shows the traffic on your own computer, lists who is connected to a game server (with country, city, ISP and a VPN flag), filters and exports packets, scans your own network, runs WireGuard tunnels with a built-in engine, runs a Windows hotspot with internet sharing, and syncs labels, filters and tunnels to an optional account. A command-line program, `eqnet.exe`, does the same jobs without a window.

Built with Tauri 2 (Rust) and a React + TypeScript window. Capture uses Npcap. Repo: `C:\Users\Admin\Desktop\EqSniff` (private, https://github.com/EQQX0/EqSniff). Current version: 0.2.14.

## What it does
- **Capture**: the IP list is the main view (Unfiltered IPs and Filtered IPs tabs, packet table behind a "Show traffic" button). An address is a real connection after 3 packets each way; online means it sent to us and we answered within 15 seconds (ICMP never counts). Columns: label, IP, type, port, country, city, ISP, VPN flag, in/out. Right-click a row for copy, label, show or hide an ISP, hide an IP, delete row, clear all.
- **Filters**: Show or Hide filters made in a 3-step window. Each can hold several IPs or CIDR ranges, countries, ISP names, hex patterns, port lists and ranges (`80, 443, 100-200`), and a packet length range.
- **IP Storage**: address book of labels. One label keeps its last 3 addresses.
- **Devices and Scan**: devices seen in captures, and a scan of your own /24 with 22 common ports.
- **VPN**: built-in WireGuard engine (boringtun + Wintun), edit, log, optional kill switch.
- **Hotspot**: Windows Mobile Hotspot and internet sharing.
- **Account** (optional): sync of IP Storage, filters and tunnels through Supabase; sharing; backup export and import.
- **eqnet.exe**: command line. See [[Projects/EqSniff/README#For AI sessions|For AI sessions]] and `docs/AI-GUIDE.md` in the repo.

## Tech stack
Tauri 2, Rust (pcap 2, etherparse 0.17, maxminddb 0.24 with mmap, ureq 2, boringtun 0.6, wintun 0.5, flate2 1, windows-sys 0.59), React + TypeScript + Tailwind, Supabase (auth, tables, one edge function), Vercel (update feed). The installer is NSIS and self-signed.

## Project map
```
EqSniff/
  CLAUDE.md             : points AI sessions here
  README.md, HANDOFF.md : older copies; the vault versions are the current ones
  START-HERE.txt        : where files outside this folder live
  desktop/
    src/                : the window (React)
      App.tsx           : nav, filter state, hideIsp, watchDevice
      views/            : CaptureView, CaptureIps (IP list and right-click menu), FiltersView, VpnView, HotspotView, DevicesView, IpStorageView, SettingsView, HelpView
      components/       : FilterWizard (3-step filter window), CloudSync, SharedLibrary, BackupCard, ui/
      lib/              : filters.ts (matching, Lookup), capturefilter.ts, ipstore.ts (label cap), cloud.ts, ipmerge.ts, backup.ts, mclog.ts, api.ts
    src-tauri/          : the Rust side
      src/lib.rs        : registers 45 commands; manage_state; cargo feature `cli`
      src/capture.rs, packet.rs, pcapfile.rs, scan.rs, geo.rs (country), ipinfo.rs (ISP, city, VPN guess)
      src/vpn.rs, vpnengine.rs, killswitch.rs, hotspot.rs, filters.rs (stores), settings.rs, update.rs, cli.rs
      resources/        : country.mmdb, asn.mmdb (DB-IP Lite, CC BY 4.0), DB-IP-LICENSE.txt
      vendor/           : wintun.dll, windows_x86_64_msvc stand-in crate (async crash fix)
    cli/                : tiny crate that builds eqnet.exe (separate from the app, no admin manifest)
    supabase/           : migrations 0001 to 0005 and the `account` edge function
    tests/              : filters, ipmerge, mclog (node)
  docs/AI-GUIDE.md      : how an AI drives eqnet.exe
  updates-site/         : the update feed, deployed to updates.eqqx2.com (the .exe and .vercel are git-ignored)
  release/              : old installers (git-ignored)
  replica/              : scope, feature matrix, build log, unbuilt.md
  _archive/web-dashboard/ : earlier web version, unused
```

## Setup and run
Install Npcap first (capture needs it). You need Rust (MSVC), Node 20+, and `wpcap.lib` in `C:\nt-libs`.
```powershell
cd C:\Users\Admin\Desktop\EqSniff\desktop
npm install
$env:CARGO_TARGET_DIR = 'C:/nt-target'      # short path, Windows path limit
$env:LIBPCAP_LIBDIR   = 'C:\nt-libs'
npm run tauri dev
```
Build the installer: `npm run tauri build` gives `C:\nt-target\release\bundle\nsis\EqNetwork_<version>_x64-setup.exe`.
Build the command line:
```powershell
cd C:\Users\Admin\Desktop\EqSniff\desktop\cli
cargo build --release      # with the same two environment variables; result C:\nt-target\release\eqnet.exe
```

## Release (what "commit" means for this user)
1. Bump the version in `desktop/package.json` line 3, `desktop/src-tauri/Cargo.toml` line 3, `desktop/cli/Cargo.toml` line 3, `desktop/src-tauri/tauri.conf.json` line 4. Cargo rewrites `Cargo.lock` on the build (its line number moves; do not edit it by line).
2. `npx tsc --noEmit`, `npm test`, `npm run tauri build`.
3. In `updates-site/`: copy the installer over `EqNetwork-setup.exe`, write `update.json` {version, url, sha256, notes}, run `vercel deploy --prod --yes`, wait about 25 seconds, check https://updates.eqqx2.com/update.json.
4. `git add -A`, commit, push.
"update my version only" means steps 1 to 3 without committing. Installing locally needs EqNetwork closed (it runs as administrator, so I cannot close it).

## Environment variables (names only)
- `CARGO_TARGET_DIR` (`C:/nt-target`) and `LIBPCAP_LIBDIR` (`C:\nt-libs`): build paths, not secrets.
- `NT_UPDATE_URL`: optional update-feed override.
- `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`: `--remote-debugging-port=9222`, only for test runs.
- `updates-site/.env.local`: Vercel link data (git-ignored). `.env*` is git-ignored: yes.
- Saved VPN tunnels in `%APPDATA%\app.networktoolkit.desktop\vpn\` hold private keys. Never copy them into notes or the repo.

## Tests
- `cd desktop; npm test`: 88 filter checks, 15 IP merge checks, 8 Minecraft log checks (all passed on 2026-11-16).
- `cd desktop/src-tauri; cargo test --tests`: about 65 Rust tests (pcap, packet, scan, update, settings, store, VPN, hotspot). Not run this session. They live in `src-tauri/tests/` and do not link Tauri, because tests that did crashed on the author's PC.

## Architecture
The window calls Tauri commands (`invoke`) in `src-tauri/src`. Capture runs on a thread in `capture.rs` and the window polls it. Data is JSON stores in `%APPDATA%\app.networktoolkit.desktop` (whitelisted names in `filters.rs`). Country, ISP and city are looked up on this computer: `geo.rs` and `ipinfo.rs` read DB-IP Lite files (country and ASN built in, city downloaded once to `ipdb\city.mmdb`). VPN and hotspot jobs run elevated copies of the exe or PowerShell and report through job files. The command line builds the same app headlessly (`tauri::test::mock_context`) and calls the command functions directly (`cli.rs`). Sync uses Supabase tables `profiles`, `ip_entries`, `sync_items`, `shared_items` (project `eqnetwork`, ref `bswzptrmeeobbnthjioz`).

## Conventions and gotchas
- The release exe always asks for administrator (manifest only in the release profile, so `cargo test` still runs).
- `windows_x86_64_msvc` is a local empty stand-in crate; without it async commands crash (see [[Projects/EqSniff/Decisions/vendored-msvc-stand-in|decision]]).
- `eqnet.exe` needs its own embedded manifest (Common Controls 6) or Windows refuses to start it. That is in `desktop/cli/build.rs`.
- Packet numbers restart on every capture, so the packet table is cleared per capture while the IP list is kept.
- The user's rules: "commit" means a full release; do not run window-driving tests while they game; creating accounts or projects needs their permission; no features that identify people from game traffic.

## For AI sessions
Read [[Projects/EqSniff/HANDOFF|HANDOFF]] first for the latest status. To drive the app without a window, read `docs/AI-GUIDE.md` in the repo and use `C:\nt-target\release\eqnet.exe` (`eqnet help`, `eqnet commands`).
