---
type: decision
project: EqSniff
date: 2026-11-16
status: active
tags: [decision, project/EqSniff]
---
# No features that identify people from game traffic
Chose **not building them** over **PSN Username AI, name-to-IP lookup, port scans of other people's IPs** because they find a person's home address or probe their connection without their agreement, and are mostly used for DDoS and harassment. The server owner's needs (who is connected, country, ISP, VPN flag, labels, filters) are covered without them.

Rejected: building them with a warning. The user asked twice and the answer stayed no. A port scan of the user's own public IP was offered and then dropped by the user.
Context: `replica/features.csv` skip rows; `replica/unbuilt.md`. The app's own scan stays limited to the user's own subnet.
Seen in: [[Projects/EqSniff/Handoffs/2026-11-16-0047|handoff 2026-11-16]]
