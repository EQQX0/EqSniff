# EqSniff

A Windows desktop app that shows the network traffic on your own computer. You can filter and export it, replay a packet between devices on your own network, save and open .pcap files, copy rows, watch one device, and scan your own network for devices and open ports.

Built with Tauri 2 (Rust) and a React + TypeScript window. Capture uses Npcap.

## Folders

| Folder | What is in it |
| --- | --- |
| `desktop/` | The app. `src/` is the window, `src-tauri/` is the Rust side. |
| `replica/` | Scope, architecture, feature matrix, build log, and `unbuilt.md` (what is missing and why). |
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

## Running

Install Npcap first. The network scan works without it, but capture needs it.

## Update check

The app can fetch one small file, `update.json`, from `https://eqsniff-updates.vercel.app/update.json` (a separate Vercel project, so this repository stays private). Once DNS for `updates.eqqx2.com` points at Vercel, that name serves the same file. The switch in Settings turns the check off completely.

## Data sources and licences

- Country lookup uses the DB-IP Lite country database (CC BY 4.0). See `desktop/src-tauri/resources/DB-IP-LICENSE.txt`.
