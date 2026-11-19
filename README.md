# EqSniff

Last updated: 2026-11-15 13:00 AST

A Windows desktop app that shows the network traffic on your own computer. You can filter and export it, replay a packet between devices on your own network, save and open .pcap and .pcapng files, inspect any packet byte by byte, copy rows, watch one device, scan your own network for devices and open ports, and run WireGuard tunnels with a built-in engine on a VPN page.

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
npm test                          # 91 filter, 21 IP-merge, 8 Minecraft-log and 48 hex-formatting checks
cd src-tauri
cargo test --tests                # 100 tests: pcap, pcapng, packet, inspector, scan, update, settings, store, VPN parser/engine/extras, hotspot
```

Rust tests live in `desktop/src-tauri/tests/` and do not link Tauri. Tests that did crashed on the author's PC, so keep new ones there.

## Capture files and the HEX inspector

**Formats.** Open capture file reads `.pcap`, `.pcapng` and `.cap`. Export has a PCAP button and a PCAPNG button. PCAPNG files from Wireshark open as saved, in either byte order, with several sections and several interfaces.

| Link type | Number | Opens |
| --- | --- | --- |
| Ethernet | 1 | yes |
| BSD and OpenBSD loopback | 0, 108 | yes |
| Raw IP, raw IPv4, raw IPv6 | 101 (also 12, 14), 228, 229 | yes |
| Linux cooked v1 and v2 | 113, 276 | yes |
| Anything else (802.11 and so on) | | refused with the link type named |

**What is kept.** Packet bytes are stored exactly as read and exported exactly as stored. Timestamps are kept to the nanosecond: PCAPNG export writes nanosecond times, and PCAP export rounds to the microsecond because that is all `.pcap` holds. A PCAPNG export keeps each interface's link type, name, description and snap length. A classic `.pcap` holds one link type, so exporting packets from interfaces with different link types as PCAP is refused with a message that points to PCAPNG.

**What is not kept, and how you find out.** Name resolution, interface statistics, decryption secrets and custom blocks, packet comments, per-packet flags and interface options other than name, description, time resolution and time offset are not kept. The notice under the table lists each kind with a count (`Not kept: ...`) and a toast says so. A file that ends mid-block, has a block whose two length fields disagree, or has a packet that points at a missing interface is read up to the damage and says so. A file with no readable packet gives an error, not an empty table. Packets from an interface with an undecodable link type are counted in the notice but not shown.

**Limits.** The first 32 MB of a file are read and up to 5,000 packets are shown, same as before. The window sends the file to the Rust side as base64 in one piece, so the file is not streamed from disk; the reader walks it block by block and copies only the packets it keeps. Opening a file replaces the table. Opened packets can be exported again but not replayed. Packets that are not IPv4 or IPv6 (ARP and the like) are counted but not kept, so they are not in a re-export.

**HEX inspector.** Right-click a packet in the traffic table and choose **Inspect bytes (HEX)**. A pane opens under the table:

- Left: the decoded fields (Ethernet or other link header, IPv4 or IPv6, TCP, UDP, ICMP, payload), each with its length in bytes. Click a field to select its bytes.
- Right: offset, HEX and ASCII, 16 bytes a row. Click a byte or drag to select; Shift+click or Shift+arrows extends; arrows move, Ctrl+A selects all, Esc clears, Ctrl+C copies the selection as HEX. Selecting bytes highlights the field they sit in.
- Header line: packet number, time, link type, interface, length on the wire (and how many bytes were captured when the capture cut it short) and the selected range.
- **Copy HEX** copies every byte as `45 00 00 3c ...`. **Copy selected** copies the selection.
- Bytes covered by a decoded header field are tinted. Payload and undecoded bytes are plain, so captured bytes and decoded fields stay distinguishable. The inspector only reads the saved bytes.

Only the rows in view are drawn, so a packet of 256 KB scrolls like a small one. Live packets stay inspectable while they are among the latest 20,000 kept in memory. The pane closes when the table is cleared or a file is opened.

For scripts, `packet_detail` (`{id, hexDump?}`) returns the bytes as base64, the decoded fields with byte ranges and, on request, a text dump; `export_pcapng` is the PCAPNG twin of `export_pcap`. See `docs/AI-GUIDE.md`.

**Known limitations.** Wireshark itself was not available while this was written, so output is checked against the pcapng specification and a reader written independently from the writer in the tests, not by opening it in Wireshark. Not decoded: IPv6 extension headers, TCP/UDP above the transport header, 802.11. The inspector opens only from the right-click menu, so it has no keyboard-only way in yet. The UI was type-checked but not clicked through in the running app.

## VPN page

The app has its own WireGuard engine (`src-tauri/src/vpnengine.rs`): `boringtun` for the protocol and Wintun (`vendor/wintun/wintun.dll`, signed by the WireGuard project) for the virtual adapter. Activate starts a second, elevated copy of the exe (`--vpn-run`); Windows shows its admin prompt each time. Tunnel files, `.state`, `.stop`, `.log` and `.options` live in the app data folder under `vpn/`.

- **Edit**: the Edit button opens the saved settings in a box. The private key shows as `<unchanged>` and is never sent to the window; saving checks the text with the same parser as import. Only for a tunnel that is off.
- **Log**: the Log tab shows the last 200 lines of `<name>.log` and refreshes every 3 seconds while the tunnel is active. The engine never writes keys to it.
- **Kill switch** (off by default, one checkbox per tunnel, stored in `<name>.options`, never read from a `.conf`). `src-tauri/src/killswitch.rs` adds Windows Filtering Platform filters in a dynamic session, so Windows removes them when the elevated engine process exits for any reason. They block all connections except: loopback, the tunnel adapter, UDP to the VPN server, DHCP, and the local network (10/8, 172.16/12, 192.168/16, 169.254/16, fe80::/10, fc00::/7, multicast, broadcast). The engine keeps running until you press Deactivate, so if the tunnel drops, traffic is blocked and not leaked. If the engine process itself is killed, the filters go with it and traffic returns to normal.

## Hotspot page

`src-tauri/src/hotspot.rs` drives Windows through PowerShell 5.1 (no async, long work on a thread that `hotspot_job` reports on).

- **Hotspot**: Windows Mobile Hotspot through `NetworkOperatorTetheringManager`. Needs a Wi-Fi adapter; without one the page says so and Start is off. Name and password are checked in Rust (name 1 to 32 characters, password 8 to 63 printable ASCII) and stored in `hotspot/hotspot.json` in the app data folder. The password never goes back to the window (only a `hasPassword` flag) and reaches PowerShell through environment variables.
- **Sharing / Bridge**: Windows internet connection sharing (`HNetCfg.HNetShare`) between a public and a private adapter. Changing it runs an elevated PowerShell (Windows admin prompt) and reads the result from `hotspot/sharing-result.json`. The script travels on the command line, adapter names as base64. The app refuses to apply while sharing is already on; Reset or Disable Sharing turns it off.
- **Auto sharing**: the Hotspot card has a switch (default on, saved in `hotspot.json` with the chosen public adapter). Start Hotspot then waits up to 15 s for the new hotspot adapter and applies sharing public=chosen, private=hotspot adapter in one elevated step; Stop Hotspot resets sharing that was set up this way. Both adapter pickers use `components/ui/Select.tsx` and list every connection.
- **Connected devices**: read from `arp -a` for the private subnet only (default 192.168.137.1). Nothing is sent.

## IP Storage

A plain address book for your own labels: an address (any text, up to 100 characters) and a label (up to 500 characters) per row, searchable by either. The Capture table writes its Label column to the same list. Saved through the same key-value store as device labels and the capture filter (`get_store`/`save_store`, store name `ip-storage`). No username field and no link to a capture or scan; it is a notes list, not an identity lookup.

## Build notes

`vendor/windows_x86_64_msvc` is a stand-in crate with no code, replacing the crate of the same name. Without it, `pcap` links a Windows import library that sends `WaitOnAddress` to `vertdll.dll` and crashes async code. Its README has the details. Check with `dumpbin /imports` after dependency changes.

## Running

Install Npcap first. The network scan works without it, but capture needs it.

## Update check

The app can fetch one small file, `update.json`, from `https://updates.eqqx2.com/update.json` (a separate Vercel project, `eqsniff-updates`, so this repository stays private). The switch in Settings turns the check off completely.

## Data sources and licences

- Country lookup uses the DB-IP Lite country database (CC BY 4.0). See `desktop/src-tauri/resources/DB-IP-LICENSE.txt`.

## Command line

`desktop/cli` builds `eqnet.exe`, the app without a window. See `docs/AI-GUIDE.md`.
