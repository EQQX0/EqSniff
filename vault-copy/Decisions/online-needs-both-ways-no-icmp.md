---
type: decision
project: EqSniff
date: 2026-11-16
status: active
tags: [decision, project/EqSniff]
---
# Online needs real replies, and ICMP never counts
Chose **online = packets both ways in the last 15 seconds, ICMP ignored** over **online = any recent packet** because with the server off, a closed UDP port makes Windows answer every incoming packet with an ICMP error. Those errors looked like the server talking back, so players whose game kept retrying showed as online.

Rejected: any recent packet, and counting ICMP as a reply.
Context: `isOnline`, `ONLINE_WITHIN` (15) and `ACTIVE_EACH_WAY` (3) in `CaptureIps.tsx`; the same rule in `cli.rs`. A live capture keeps its clock after Stop; a saved file is judged at its newest packet.
Seen in: [[Projects/EqSniff/Handoffs/2026-11-16-0047|handoff 2026-11-16]]
