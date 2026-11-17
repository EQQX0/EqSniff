# EqNetwork for AI agents

EqNetwork has a command-line program, `eqnet.exe`, that does everything the window does except accounts and sharing. Use it to read captures, manage IP labels, run VPN and hotspot jobs, and back up data. It reads and writes the same data folder as the app, so a change made here shows up in the window and the other way round.

## Build and run

```bash
cd desktop/cli
CARGO_TARGET_DIR=C:/nt-target LIBPCAP_LIBDIR='C:\nt-libs' cargo build --release
```

The program lands at `C:\nt-target\release\eqnet.exe`. Run it from PowerShell or any terminal. Run `eqnet help` for the command list and `eqnet commands` for every raw command with its arguments.

Rules that save you time:

- Output is JSON on stdout (the `capture` command prints a table unless you add `--json`). Errors go to stderr as `Error: ...`.
- Exit code 0 means success, 1 means a failure, 2 means bad usage.
- VPN, hotspot and sharing commands need an administrator terminal. Without one, Windows refuses and the command prints the reason.
- `capture` needs Npcap. Other commands work without it.
- The app and `eqnet` can run at the same time, but only one of them should capture on an adapter at once.
- City, ISP and the VPN flag come from databases on this computer (ISP is built in; the city database downloads once into `%APPDATA%pp.networktoolkit.desktop\ipdb`). Nothing is sent when you look up an address. Until the city database has downloaded, `city` is empty. The VPN flag is a guess from the network name (data centres, clouds, VPN companies).

## Everyday jobs

| Goal | Command |
| --- | --- |
| Who is connected to my server | `eqnet capture --seconds 60 --port 9305 --lookup` |
| Same, as JSON for a script | `eqnet capture --seconds 60 --port 9305 --lookup --json` |
| List capture adapters | `eqnet adapters` |
| Country of some addresses | `eqnet lookup 1.2.3.4 5.6.7.8` |
| City, ISP and VPN flag too | `eqnet lookup 1.2.3.4 --details` |
| Label an address | `eqnet ips label 1.2.3.4 "Steve"` |
| Add, list, remove addresses | `eqnet ips add 1.2.3.4 "note"`, `eqnet ips`, `eqnet ips remove 1.2.3.4` |
| Label from a Minecraft log | `eqnet minecraft-log "C:\server\logs\latest.log"` |
| Scan the home network | `eqnet scan` or `eqnet scan 192.168.1.0/24` |
| WireGuard tunnels | `eqnet vpn list`, `vpn import <name> <file.conf>`, `vpn up <name>`, `vpn down <name>`, `vpn killswitch <name> on` |
| Hotspot | `eqnet hotspot status`, `hotspot save <ssid> <password>`, `hotspot start`, `hotspot stop`, `hotspot devices` |
| Internet sharing | `eqnet sharing status`, `sharing adapters`, `sharing apply <public> <private>`, `sharing reset` |
| Capture filters | `eqnet filters list`, `filters on <name>`, `filters off <name>`, `filters set <file.json>` |
| Backup | `eqnet backup export backup.json`, `eqnet backup import backup.json` |
| Data folder | `eqnet folder` |

A label has one current address (the one seen most recently) and keeps its earlier addresses as history, with first seen, last seen and times seen. One label keeps at most 50 addresses; writing one more (`ips add`, `ips label`, `minecraft-log`, or naming it in the window) removes the oldest. The window uses `capLabel` in `desktop/src/lib/ipstore.ts`, the CLI uses `cap_label` in `cli.rs`.

## What `capture` reports

`capture` records packets for `--seconds` (default 30), then lists public addresses that talked to this computer in both directions. An address needs at least `--min` packets each way (default 3), so new players show within a second or two. Add `--all` to drop the rule.

Each row has: `address`, `label` (from IP Storage), `country`, `protocols` (TCP, UDP), `ports` (service ports below 49152), `inbound`, `outbound`, `bytes`, `online` (a packet in the last 15 seconds of the capture), `secondsSeen`. `--lookup` adds `city`, `region`, `isp` and `vpn` (true for a known VPN, proxy or data centre). `--port 9305` keeps addresses that used that port at either end.

Reading the result: a real player shows steady traffic both ways on the game port for the whole capture. A scanner shows a short burst. A VPN or hosting address (`vpn: true`) on a server that bans VPNs is a rule breaker.

## Raw access to every command

`eqnet call <command> '<json>'` runs any app command. Argument names are camelCase.

```bash
eqnet call get_settings
eqnet call geo_lookup '{"ips":["8.8.8.8"]}'
eqnet call vpn_log '{"name":"home"}'
```

`eqnet commands` prints the whole list with argument shapes. The Rust source of truth is `desktop/src-tauri/src/cli.rs` (the `call` function) and the `#[tauri::command]` functions it calls.

## Data folder

`%APPDATA%\app.networktoolkit.desktop` holds JSON stores: `ip-storage.json` (entries `{id,address,note,createdAt,updatedAt}`), `ip-storage-deleted.json` (address to deletion time, so sync does not bring it back), `filters.json`, `labels.json`, `settings.json`, plus `vpn\` and `hotspot\hotspot.json`. Edit them through `eqnet`, not by hand: removals need the deletion record.

## Not in the command line

Account sign-in, cloud sync and the shared library run in the window's TypeScript and talk to Supabase. If you need them, use the app. `backup export` and `backup import` cover moving data between machines without an account.

## Where things live

- `desktop/src-tauri/src/cli.rs`: the command line (parsing, short commands, `call`).
- `desktop/cli/`: the tiny crate that builds `eqnet.exe`. It is separate from the app so it does not carry the app's administrator manifest.
- `desktop/src-tauri/src/lib.rs`: registers the commands for the window; the `cli` cargo feature turns on the headless mode.
- `desktop/src/views/CaptureView.tsx`, `CaptureIps.tsx`: the same IP list logic in the window (`listBook`, `ACTIVE_EACH_WAY`, `ONLINE_WITHIN`). Keep the numbers in `cli.rs` in step.
- `HANDOFF.md`: current status. `README.md`: project map.
