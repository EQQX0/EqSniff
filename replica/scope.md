# Scope (decided 2026-11-15)

This file overrides `recon.md` and `architecture.md` wherever they disagree.

The product is a free Windows app. Anyone can download it. There is no account, no billing and no server. Everything saves on the user's own machine.

## The fence

| Bucket | Items |
| --- | --- |
| Core | Live capture, traffic table, filter editor, starter filters, filter import/export files, traffic control on your own device (with emergency stop), replay a captured packet, local-only data, update check, signed installer and portable zip, offline help, offline GeoIP |
| Nice-to-have | LAN device discovery, local device labels, CSV/JSON/TXT export, pcap import/export, usage and crash reporting |
| Maybe-later | PSN/Xbox linking (only if optional accounts ever return), open source (after v1 is stable for 3 months) |
| Out | Packet tester, packet inspector, themes, multi-language, Discord presence, macOS and Linux |

Also gone with the accounts decision: the web dashboard, Supabase, Stripe, licences, device seats, the store, support tickets and 2FA. The old code is in `_archive/web-dashboard/` and can be restored.

## Rules that follow

- **One outbound call.** The update check is the only network request the app makes, and the settings screen can turn it off.
- **Reporting is opt-in or gone.** Usage and crash reporting contradicts local-only. It ships off by default with a plain explanation, or it moves to Out. Decide before v1.
- **Own network only.** Discovery, replay and traffic control act on the user's own devices. The original's name resolver, blacklist and targeting features stay skipped.
- **Dark theme only.** Tokens stay in place so themes can return later.
- **English only.** Strings live in one file so translation can return later.

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Shell | Tauri 2 (Rust) | Small installer, native access to the network driver |
| UI | Vite, React, TypeScript, Tailwind | Reuses the primitives and tokens already built |
| Capture | `pcap` crate on Npcap | Standard Windows capture library |
| Traffic control | WinDivert | Packet-level drop, delay and throttle on the local machine |
| Storage | SQLite file plus a JSON settings file in the app data folder | Local, inspectable, easy to back up |
| Updates | Tauri updater, off switch in settings | The single outbound call |

## Watch-outs

1. Traffic control needs a signed kernel driver (WinDivert ships one). A free app still pays for its own code-signing certificate.
2. Npcap's licence limits free redistribution. Check whether to bundle it or send users to its installer.
3. v1 can capture and filter but cannot list devices or export, because both are Nice-to-have. Consider promoting export to Core.

## Build order

1. Tauri shell with settings saved locally.
2. Capture slice: pick adapter, start and stop, live table.
3. Filters: editor, starter set, file import and export.
4. Replay.
5. Traffic control with emergency stop.
6. Offline GeoIP and offline help.
7. Update check with off switch, then installer and signing.
8. Nice-to-haves in the order: export, LAN discovery, labels, pcap.
