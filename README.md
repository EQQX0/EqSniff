# EqSniff

Last updated: 2026-11-15 13:00 AST

A Windows desktop app that shows the network traffic on your own computer. You can filter and export it, replay a packet between devices on your own network, save and open .pcap files, copy rows, watch one device, scan your own network for devices and open ports, and run WireGuard tunnels with a built-in engine on a VPN page.

Built with Tauri 2 (Rust) and a React + TypeScript window. Capture uses Npcap.

## Folders

| Folder | What is in it |
| --- | --- |
| `desktop/` | The app. `src/` is the window, `src-tauri/` is the Rust side. |
| `replica/` | Scope, architecture, feature matrix, build log, and `unbuilt.md` (what is missing and why). |
| `release/` | Installer, portable zip and self-signed certificate (not in git). |
| `START-HERE.txt` | Where everything lives, including files outside this folder. |
| `HANDOFF.md` | Latest session status and next step. |
| `_archive/web-dashboard/` | An earlier web version with accounts and billing. Kept for reference. Not used. |

## Build

You need Rust (MSVC toolchain), Node 20+, and Npcap installed. Building also needs Npcap's import library, `wpcap.lib`, from the Npcap SDK, or one generated from the installed `wpcap.dll`.

```powershell
cd desktop
npm install
$env:CARGO_TARGET_DIR = 'C:/nt-target'      # short path: Windows limits paths to 260 characters
$env:LIBPCAP_LIBDIR   = 'C:\nt-libs'        # folder that holds wpcap.lib
npm run tauri dev
```

`npm run tauri build` makes the installer. It lands in the `release/bundle/nsis` folder under your `CARGO_TARGET_DIR`. The first build downloads Tauri's NSIS tooling. The installer is not code-signed.

## Tests

```powershell
cd desktop
npm test                          # 35 filter checks
cd src-tauri
cargo test --tests                # 5 pcap, 6 VPN parser and 3 VPN engine tests
```

Rust tests live in `desktop/src-tauri/tests/` and do not link Tauri. Tests that did crashed on the author's PC, so keep new ones there.

## VPN page

The app has its own WireGuard engine (`src-tauri/src/vpnengine.rs`): `boringtun` for the protocol and Wintun (`vendor/wintun/wintun.dll`, signed by the WireGuard project) for the virtual adapter. Activate starts a second, elevated copy of the exe (`--vpn-run`); Windows shows its admin prompt each time. Tunnel files, `.state`, `.stop` and `.log` live in the app data folder under `vpn/`. There is no kill switch yet.

## Build notes

`vendor/windows_x86_64_msvc` is an empty stand-in for the crate of the same name. Without it, `pcap` links a Windows import library that sends `WaitOnAddress` to `vertdll.dll` and crashes async code. Its README has the details. Check with `dumpbin /imports` after dependency changes.

## Running

Install Npcap first. The network scan works without it, but capture needs it.

## Update check

The app can fetch one small file, `update.json`, from `https://eqsniff-updates.vercel.app/update.json` (a separate Vercel project, so this repository stays private). Once DNS for `updates.eqqx2.com` points at Vercel, that name serves the same file. The switch in Settings turns the check off completely.

## Data sources and licences

- Country lookup uses the DB-IP Lite country database (CC BY 4.0). See `desktop/src-tauri/resources/DB-IP-LICENSE.txt`.
