# What is built, what is not, and why

Written 2026-11-15, after the desktop build and a bug pass. The feature matrix is `features.csv`. The scope decisions are `scope.md`.

## Built and checked in the running app

| Feature | What it does | Checked |
| --- | --- | --- |
| Live capture | Adapter list (connected adapter first), start and stop | 200+ packets from the wired adapter |
| Traffic table | Time, source, destination, protocol, bytes; follows new packets only while you are at the bottom | scroll position held during capture |
| Filters | Create, edit, delete; five starters; saved locally; view-only | port 443 filter showed only matching rows |
| Filter files | Export and import as a JSON file with validation | logic only; file picker not exercised |
| Export | CSV (formula-safe), JSON, TXT of the shown packets | content checked in a script; no security-policy block |
| Replay | One saved packet, once, only between two private addresses, with a confirmation dialog | 10 of 12 refused (internet address); 2 local packets sent |
| Devices | Local devices seen in a capture, with names you give them | showed this PC and the router; label saved |
| Traffic control | Outgoing speed cap for this computer, emergency stop (Ctrl+Shift+X, red bar, removed on exit) | error path only (see below) |
| Help | Eight-question offline FAQ | rendered |
| Settings | Update-check switch, data folder | saved and reloaded |
| Portable package | `release/NetworkToolkit-portable.zip` (exe + README) | exe starts from the unzipped folder |

## Not built, with the reason

| Feature | Why it is missing | What it would take |
| --- | --- | --- |
| Offline GeoIP | A usable country database is licensed data. I did not bundle one and did not download one without your permission. | You choose a source (for example a free licence key from a database provider); I add a lookup and the licence notice. |
| Update check | There is no update server or release feed, so there is nothing to check. | Host a small version file (a GitHub release works) and a signing key; then wire the existing switch to it. |
| Installer and code signing | The installer tool needs a download, and signing needs a paid certificate. Unsigned files trigger Windows SmartScreen warnings. | Your go-ahead to download the installer tool; a certificate for signing. |
| Traffic control: drop, lag, reorder, duplicate; live stats; per-rule probability | These need a kernel driver (WinDivert) that must be downloaded, ships signed by its author, and is often flagged by antivirus. I built a speed cap with Windows' own QoS instead. | Your go-ahead to download the driver; a decision on driver licensing. |
| Active LAN scan and "select a device and watch it" | Active scans probe every device on the network. Watching another device's traffic needs interception (ARP spoofing or a mirror port). Both are out by the safety rule. | Nothing planned. Passive Devices and address filters cover the safe part. |
| Global capture-level filter | Never scoped. The view filter covers the use. | Small: apply a capture filter when opening the adapter. |
| Per-filter on/off, direction and hex matching | Time. The editor handles protocol, port, address prefix and size. | Small to medium. |
| Copy to clipboard | Never scoped. | Small. |
| pcap import and export | Nice-to-have, not done. Needs the file format on both sides. | Medium. |
| Dark theme only, English only, no themes or languages | Out by your decision. | None. |

## Decided by you earlier: out of scope

Packet tester, packet inspector, themes, multi-language, Discord presence, macOS and Linux, accounts, billing, licences, device seats, support tickets, two-factor sign-in.

## Skipped for safety (will not be built)

| Original feature | Reason |
| --- | --- |
| Username AI (decode names from traffic to find a person's IP), name-to-IP lookup, reverse lookup | Finds the home address of someone you have not been authorised to monitor. |
| Traffic control aimed at another player's IP | Disrupts another person's connection. |
| Proprietary GeoIP and DDoS lookup of arbitrary IPs | Used to profile other players; also the vendor's own data. |
| Cloud and community filter library | The original's user network and data. |
| Xbox Toolkit (party-chat crashing, session grabbing, friend lists, reading messages) | Acts on other people's sessions. |
| Packet tester sending crafted packets to third-party IPs | Only the own-network version is allowed, and that is Replay. |

## Decisions I made without asking, because you said to keep going

- **Usage and crash reporting moved to Out.** It conflicts with "saves locally". Say so if you want an opt-in version.
- **Replay is stricter than first planned.** After a test showed a packet from an internet address could be sent to my own PC (forging internet traffic on the LAN), both ends must now be private addresses.
- **Traffic control is a speed cap through Windows QoS**, not a driver, to avoid a download and a signing problem.

## Bugs found and fixed in the bug pass

1. Opening the app without Npcap in its default install mode would crash at launch with a raw Windows error. Npcap's library now loads on first use, with a plain message if it is missing.
2. Replay could put forged internet-source packets on the LAN. Now local-to-local only.
3. The table jumped to the bottom on every update. It now follows only while you are at the bottom.
4. Device counts froze after 500 devices. Known devices keep counting.
5. Closing the app always started PowerShell. It now does so only if a limit was set.
6. Loose error matching could report unrelated errors as "Npcap is not installed".
7. Dialogs did not return focus to the button that opened them.
8. The speed-limit page did not say IPv6 is not limited. It does now.
9. Events crash the app on the build machine (see `build-log.md`); the app avoids them.

## Known risks still open

- Traffic control success path never ran: the test session was not an administrator, and I did not change system settings myself. Test it once as administrator.
- Export and import buttons were not seen opening a real file dialog.
- Very busy networks may slow the table, because every update redraws up to 1,000 rows.
- Wi-Fi, VPN and virtual adapters were not tested; only the wired adapter was.
- The app has not run on a second computer, with a different Windows build, or without WebView2.
- Dialogs keep focus return but not a full focus trap.
- A damaged `filters.json` shows as an empty list and the next save overwrites it.
- The Tauri event crash was never explained. If a future feature needs events, test on a second machine first.
