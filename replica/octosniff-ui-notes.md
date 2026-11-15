# OctoSniff UI notes (observed on the user's own PC, first screen only)

Reference only. Screens seen: launch tutorial dialog and the Network screen. Nothing was run. The app appears to run as administrator, so it could not be clicked through.

## First-run tutorial
- "Chapter 1 of 4: Getting started", choose a setup path: Wired setup (recommended) or Wireless hotspot. Back / Next. Closable.

## Sidebar (top to bottom)
| Item | Notes | EqSniff status |
| --- | --- | --- |
| Network | main screen, see below | built (Capture) |
| Filters | expandable group | built (Filters) |
| Party Chat | padlock = paid/locked tier; console party chat | skip (not opened) |
| Traffic Control | padlock = paid tier | skip (dropped by decision) |
| ARP Spoofing | | skip (acts on other devices) |
| Hotspot | share the PC's connection | not built, not opened |
| Tools | expandable group, contents not seen | unknown |
| IP Storage | saved IPs list | skip until seen; identifies other people if it stores players |
| OctoVPN | built-in VPN | skip (service) |
| FAQ | | built (Help) |
| Settings | | built (Settings) |
- Bottom left: adapter picker (shows the network card and its type), then the signed-in user name with a sign-out button. Collapse arrow beside the logo.
- Title bar: version badge, "Online" with latency.

## Network screen
- Header "Network Monitor" with a state badge (STOPPED), red "Start Sniff" button with a dropdown arrow (options not seen), "Clear".
- Tabs: All Traffic, Filtered Traffic, World Map (each with a count). Export button.
- Toolbar: "Captured Packets", counters (IPs, packets, selected + active/inactive), search box "IP, protocol, or traffic type", sort, column layout and compact toggles.
- Empty state: globe icon, "No Traffic Data / Start packet capture to analyze network traffic."

## Not seen
Filters contents, Tools submenu, Hotspot, Settings, FAQ, the Start Sniff dropdown, the other tutorial chapters.

---
## Round two: screens sent by the user (their own installed app, v5.2.8)

### Filters group (sub-pages: Packet, ISP, Device, Process [beta])
- Header shows "N active (X custom + Y community)".
- **Packet Filters**: tabs Active / My Filters / Community Filters, search by name or platform. Each card shows an action banner (Discard: matched packets dropped from all views; Highlight: matched packets highlighted in Filtered Traffic), a rule summary (protocol, port range, IP list), a name, an origin (Local filter or author), a role chip (Server, P2P) and platform icons. Community filters are a cloud library: skip.
- **ISP Filters**: add an ISP/organisation name, chips with remove, behaviour dropdown (hide from table, or dim). EqSniff: not built. Own-network use: hide big hosting providers from the table.
- **Device Filters**: device list from a network scan, category chips (Router, Console, PC, Phone, IoT, Unknown), search by IP/MAC/vendor/name, per-row checkbox and menu, manual "add IP" box, Scan Network, Clear. EqSniff has scan + devices, no categories or manual device add.
- **Process Filters** (beta): not opened.

### ARP Spoofing page
Shares the device list (router pinned at the top). Acts on other devices: skip.

### Hotspot
- Left card: hotspot name (SSID), password (WPA2) with reveal, Save, Start Hotspot, state badge, client count.
- Right card: Sharing / Bridge toggle (Windows connection sharing), public adapter (internet source) and private adapter (to the device), Reset, show all adapters, warning when sharing was enabled outside the app, DNS tip (1.1.1.1 / 1.0.0.1).
- Connected devices list, Setup Guide button. Not built in EqSniff (candidate).

### IP Storage
Table of saved IPs with a comment, created date, edit/delete, search, Refresh, New Label. The user's list holds other players' addresses with their usernames. Recorded as: skip the player-tracking use. EqSniff already has own-address labels.

### OctoVPN
Built-in VPN: "Generate Profile" once, details panel (platform, adapter name, NAT type Strict, profile state), picks lowest-latency location, creates a virtual adapter that can be captured. Needs the vendor's servers: skip. Decision for EqSniff: a WireGuard-style tunnel manager that uses the user's own WireGuard configs.

### Settings sub-pages
Network (adapter list with status, IP and type; auto-detect interfaces; show inactive; "Network inspect mode" keeps recent payloads per IP; disable remote-network warning), General (notifications, Discord rich presence, auto-save capture data, auto-remove inactive IPs, delete VPN profile, guided tutorial with per-topic start buttons), Hotkeys, Appearance, Performance (max packets in memory 10000, capture buffer 1024 KB), Account, Link Account, Updates (current version, check button, changelog with Added/Changed tags), Logs (encrypted log, size, lines, last error, reveal folder, export support bundle, clear).
Not opened: Hotkeys, Appearance, Account, Link Account.
