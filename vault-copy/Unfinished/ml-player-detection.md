---
type: unfinished
project: EqSniff
date: 2026-11-16
state: open
tags: [unfinished, project/EqSniff]
---
# ML player detection
Where: not started
Status: Discussed only. Too few labelled examples (about two known players). A rule (steady two-way UDP on the game port, not a VPN or hosting network) catches most cases.
To resume: once a few hundred addresses are labelled (the Minecraft log can label them), train a small model on packets per second, in/out ratio, seconds seen and ISP type.
Raised in: [[Projects/EqSniff/Handoffs/2026-11-16-0047|handoff 2026-11-16]]
