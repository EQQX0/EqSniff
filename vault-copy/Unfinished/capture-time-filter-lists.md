---
type: unfinished
project: EqSniff
date: 2026-11-16
state: open
tags: [unfinished, project/EqSniff]
---
# Capture-time filter lists
Where: `desktop/src/lib/capturefilter.ts` (`toBpf`, `captureProblems`)
Status: The filter that limits what is recorded still takes one address, one port, one size and one hex box. The new lists, countries and ISPs only apply to what is shown.
To resume: extend `toBpf` with `host a or host b`, `net x/24` and `portrange`; Country and ISP cannot be done by the driver.
Raised in: [[Projects/EqSniff/Handoffs/2026-11-16-0047|handoff 2026-11-16]]
