---
type: decision
project: EqSniff
date: 2026-11-16
status: active
tags: [decision, project/EqSniff]
---
# ISP and city come from databases on the computer
Chose **local DB-IP databases (ASN built in, city downloaded once)** over **the ip-api.com web service** because the user wanted it instant and reliable around the clock. The web service is rate limited (15 requests a minute), needs the internet, and sent every listed address to a third party.

Rejected: ip-api.com: slow, limited, and not always reachable. It is no longer used anywhere.
Context: `desktop/src-tauri/src/ipinfo.rs`, `resources/asn.mmdb`, city file `%APPDATA%\app.networktoolkit.desktop\ipdb\city.mmdb` (127 MB, downloaded on first start, refreshed after 40 days). The VPN flag is a guess from the network name, not a list of VPNs.
Seen in: [[Projects/EqSniff/Handoffs/2026-11-16-0047|handoff 2026-11-16]]
