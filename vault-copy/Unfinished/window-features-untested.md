---
type: unfinished
project: EqSniff
date: 2026-11-16
state: open
tags: [unfinished, project/EqSniff]
---
# Window features untested
Where: `CaptureIps.tsx`, `CaptureView.tsx`, `FilterWizard.tsx`, `App.tsx`
Status: Built and released in 0.2.14. Checked by the TypeScript compiler, `npm test` and the command line only. Not opened in the real window because the user was gaming. Unchecked: right-click menu and Hide ISP filter, 3-step filter window, Start/Stop keeping the IP list, header no longer covered by flags, dots turning red 15 seconds after a player leaves (server off).
To resume: ask the user to try them, or drive the window yourself only when they are not gaming (`npm run tauri dev`).
Raised in: [[Projects/EqSniff/Handoffs/2026-11-16-0047|handoff 2026-11-16]]
