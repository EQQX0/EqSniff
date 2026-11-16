---
type: decision
project: EqSniff
date: 2026-11-16
status: active
tags: [decision, project/EqSniff]
---
# Start and Stop keep the IP list
Chose **keeping the IP list when a capture starts or stops** over **clearing it at every Start** because the user asked that turning capture on and off not clear IPs automatically. Only the Clear button, or leaving a saved file, empties it.

Rejected: clearing on Start (the old behaviour).
Context: `CaptureView.tsx` `start`. The packet table is still cleared per capture because the app numbers packets from 1 each time and the numbers would collide.
Seen in: [[Projects/EqSniff/Handoffs/2026-11-16-0047|handoff 2026-11-16]]
