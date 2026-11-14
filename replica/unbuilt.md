# What is built, what is not, and why

Updated 2026-11-15, after the second round (GeoIP, update check, installer, repo). The feature matrix is `features.csv`. The scope decisions are `scope.md`.

## Built and checked in the running app

| Feature | What it does | Checked |
| --- | --- | --- |
| Live capture | Adapter list (connected adapter first), start and stop | 200+ packets from the wired adapter |
| Traffic table | Time, source, destination, country, protocol, bytes; follows new packets only while you are at the bottom | scroll position held during capture |
| Offline country lookup | Country of the far end, from a database built into the app (DB-IP Lite, CC BY 4.0). Country only. | 273 of 300 live rows had a country; private and invalid addresses skipped |
| Filters | Create, edit, delete; five starters; saved locally; view-only | port 443 filter showed only matching rows |
| Filter files | Export and import as a JSON file with validation | logic only; file picker not exercised |
| Export | CSV (formula-safe), JSON, TXT of the shown packets | content checked in a script; no security-policy block |
| Replay | One saved packet, once, only between two private addresses, with a confirmation dialog | 10 of 12 refused (internet address); 2 local packets sent |
| Devices | Local devices seen in a capture, with names you give them | showed this PC and the router; label saved |
| Traffic control | Outgoing speed cap for this computer, emergency stop (Ctrl+Shift+X, red bar, removed on exit) | error path only (see risks) |
| Update check | One small version file, off switch, "Check now", notice bar | tested against a local stand-in server: off = 0 requests; newer, older, same, 404 and garbage files all handled; only generic headers sent |
| Help | Nine-question offline FAQ | rendered |
| Settings | Update-check switch and result, data folder, credits | saved and reloaded |
| Packages | `release/NetworkToolkit-setup.exe` (NSIS installer, 4.3 MB) and `release/NetworkToolkit-portable.zip` | portable exe starts; installer built but not run |
| Private repo | https://github.com/EQQX0/EqSniff | pushed |

## Not built, with the reason

| Feature | Why it is missing | What it would take |
| --- | --- | --- |
| Traffic control: drop, lag, reorder, duplicate; live stats; per-rule probability | Needs the WinDivert kernel driver. I downloaded the official 2.2.2 release and Windows Defender blocked it as "potentially unwanted software". I did not add an exclusion or turn Defender off, because that is a security setting for you to change. The block also shows what your users would see: antivirus flags this driver, so shipping it means false-positive warnings and, usually, a signing and reputation effort. I removed the blocked download. The speed cap (Windows QoS) stays. | You decide to accept the antivirus problem, add a Defender exclusion for a work folder yourself, and tell me. Then it is about a day of work plus testing as administrator. |
| Code signing | Needs a paid certificate. Unsigned files trigger SmartScreen warnings. | A certificate (about 100 to 400 USD a year) and its password stored outside the repo. |
| Update check working end to end | The check is built and tested. It cannot work for the public yet: the repository is private, so the app's anonymous request gets 404. | Make the repository public, or host `update.json` at a public address and change `DEFAULT_URL` in `update.rs`. |
| Active LAN scan and "select a device and watch it" | Active scans probe every device on the network. Watching another device's traffic needs interception (ARP spoofing or a mirror port). Both are out by the safety rule. | Nothing planned. Passive Devices and address filters cover the safe part. |
| Global capture-level filter | Never scoped. The view filter covers the use. | Small. |
| Per-filter on/off, direction and hex matching | Time. The editor handles protocol, port, address prefix and size. | Small to medium. |
| Copy to clipboard | Never scoped. | Small. |
| pcap import and export | Not done. Needs the file format on both sides. | Medium. |
| Themes, languages, packet tester, packet inspector, Discord, macOS and Linux, accounts, billing | Out by your decision. | None. |

## Skipped for safety (will not be built)

| Original feature | Reason |
| --- | --- |
| Username AI (decode names from traffic to find a person's IP), name-to-IP lookup, reverse lookup | Finds the home address of someone you have not been authorised to monitor. |
| Traffic control aimed at another player's IP | Disrupts another person's connection. |
| Proprietary GeoIP and DDoS lookup of arbitrary IPs | Used to profile other players; also the vendor's own data. City or street-level lookup is not built either; the app shows the country only. |
| Cloud and community filter library | The original's user network and data. |
| Xbox Toolkit (party-chat crashing, session grabbing, friend lists, reading messages) | Acts on other people's sessions. |
| Packet tester sending crafted packets to third-party IPs | Only the own-network version is allowed, and that is Replay. |

## Decisions I made without asking

- **Usage and crash reporting moved to Out.** It conflicts with "saves locally". Say so if you want an opt-in version.
- **Replay is stricter than first planned.** Both ends must be private addresses, after a test showed a packet from an internet address could be sent to my own PC.
- **Traffic control stays a speed cap.** The driver route was blocked by Defender (see above).
- **GeoIP source: DB-IP Lite country** (free, no key, CC BY 4.0, needs the credit shown in Settings). It is 8.5 MB inside the app. Refresh it monthly by replacing `country.mmdb`.
- **Update check is a notice only.** It never downloads or installs anything.
- **Repository contents:** the reference screenshots of the original app, the zip, the installer and local tool settings are not in the repo.

## Bugs found and fixed

1. Opening the app without Npcap in its default install mode would crash at launch with a raw Windows error. Npcap's library now loads on first use, with a plain message if it is missing.
2. Replay could put forged internet-source packets on the LAN. Now local-to-local only.
3. The table jumped to the bottom on every update. It now follows only while you are at the bottom.
4. Device counts froze after 500 devices. Known devices keep counting.
5. Closing the app always started PowerShell. It now does so only if a limit was set.
6. Loose error matching could report unrelated errors as "Npcap is not installed".
7. Dialogs did not return focus to the button that opened them.
8. The speed-limit page did not say IPv6 is not limited. It does now.
9. The portable README said the app sends no data anywhere; the optional update check does connect. Wording fixed.
10. Events crash the app on the build machine (see `build-log.md`); the app avoids them.

## Known risks still open

- Traffic control success path never ran: the test session was not an administrator, and I did not change system settings myself. Test it once as administrator.
- The installer was built but not run. Installing it would change your PC. Try it on a spare account or machine.
- Export and import buttons were not seen opening a real file dialog.
- Country is a rough guide: addresses of large networks often show the country where the network is registered.
- Very busy networks may slow the table, because every update redraws up to 1,000 rows.
- Wi-Fi, VPN and virtual adapters were not tested; only the wired adapter was.
- The app has not run on a second computer, with a different Windows build, or without WebView2.
- Dialogs keep focus return but not a full focus trap.
- A damaged `filters.json` shows as an empty list and the next save overwrites it.
- The Tauri event crash was never explained. If a future feature needs events, test on a second machine first.
- The Npcap redistribution licence: the installer does not bundle Npcap, on purpose. Bundling needs a paid OEM licence.
