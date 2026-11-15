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
npm test                          # 45 filter checks
cd src-tauri
cargo test --tests                # 5 pcap, 6 VPN parser, 3 VPN engine, 7 VPN extras and 6 hotspot tests
```

Rust tests live in `desktop/src-tauri/tests/` and do not link Tauri. Tests that did crashed on the author's PC, so keep new ones there.

## VPN page

The app has its own WireGuard engine (`src-tauri/src/vpnengine.rs`): `boringtun` for the protocol and Wintun (`vendor/wintun/wintun.dll`, signed by the WireGuard project) for the virtual adapter. Activate starts a second, elevated copy of the exe (`--vpn-run`); Windows shows its admin prompt each time. Tunnel files, `.state`, `.stop`, `.log` and `.options` live in the app data folder under `vpn/`.

- **Edit**: the Edit button opens the saved settings in a box. The private key shows as `<unchanged>` and is never sent to the window; saving checks the text with the same parser as import. Only for a tunnel that is off.
- **Log**: the Log tab shows the last 200 lines of `<name>.log` and refreshes every 3 seconds while the tunnel is active. The engine never writes keys to it.
- **Kill switch** (off by default, one checkbox per tunnel, stored in `<name>.options`, never read from a `.conf`). `src-tauri/src/killswitch.rs` adds Windows Filtering Platform filters in a dynamic session, so Windows removes them when the elevated engine process exits for any reason. They block all connections except: loopback, the tunnel adapter, UDP to the VPN server, DHCP, and the local network (10/8, 172.16/12, 192.168/16, 169.254/16, fe80::/10, fc00::/7, multicast, broadcast). The engine keeps running until you press Deactivate, so if the tunnel drops, traffic is blocked and not leaked. If the engine process itself is killed, the filters go with it and traffic returns to normal.

## Hotspot page

`src-tauri/src/hotspot.rs` drives Windows through PowerShell 5.1 (no async, long work on a thread that `hotspot_job` reports on).

- **Hotspot**: Windows Mobile Hotspot through `NetworkOperatorTetheringManager`. Needs a Wi-Fi adapter; without one the page says so and Start is off. Name and password are checked in Rust (name 1 to 32 characters, password 8 to 63 printable ASCII) and stored in `hotspot/hotspot.json` in the app data folder. The password never goes back to the window (only a `hasPassword` flag) and reaches PowerShell through environment variables.
- **Sharing / Bridge**: Windows internet connection sharing (`HNetCfg.HNetShare`) between a public and a private adapter. Changing it runs an elevated PowerShell (Windows admin prompt) and reads the result from `hotspot/sharing-result.json`. The script travels on the command line, adapter names as base64. The app refuses to apply while sharing is already on; Reset or Disable Sharing turns it off.
- **Connected devices**: read from `arp -a` for the private subnet only (default 192.168.137.1). Nothing is sent.

## IP Storage

A plain address book for your own notes: an address (any text, up to 100 characters) and a comment (up to 500 characters) per row, searchable by either. Saved through the same key-value store as device labels and the capture filter (`get_store`/`save_store`, store name `ip-storage`). No username field and no link to a capture or scan; it is a notes list, not an identity lookup.

## Build notes

`vendor/windows_x86_64_msvc` is a stand-in crate with no code, replacing the crate of the same name. Without it, `pcap` links a Windows import library that sends `WaitOnAddress` to `vertdll.dll` and crashes async code. Its README has the details. Check with `dumpbin /imports` after dependency changes.

## Running

Install Npcap first. The network scan works without it, but capture needs it.

## Update check

The app can fetch one small file, `update.json`, from `https://eqsniff-updates.vercel.app/update.json` (a separate Vercel project, so this repository stays private). Once DNS for `updates.eqqx2.com` points at Vercel, that name serves the same file. The switch in Settings turns the check off completely.

## Data sources and licences

- Country lookup uses the DB-IP Lite country database (CC BY 4.0). See `desktop/src-tauri/resources/DB-IP-LICENSE.txt`.
