# Build log

Built 2026-11-15. Next.js 16.4.6, React 19, Tailwind 3.4.17. All data comes from `lib/data.ts`, a fake layer with the signatures the real API will use. No git repo exists, so there are no per-screen commits.

## Screens

| ID | Screen | Status | Missing | Harder than expected |
| --- | --- | --- | --- | --- |
| S02 | Login + 2FA step | partial | Real auth, session persistence | Needed a separate `error` state; the first draft left an unreachable error branch |
| S03 | Dashboard home | done on fake data | Live stats | Layout tuning for 390px |
| S13 | Integrations | partial | OAuth for PSN and Xbox | None |
| S14 | Settings | partial | Theme, accent and language choices save nothing and change nothing | Controls built before the apply logic |
| S16 | Store | partial | Checkout | None |
| S17 | Support + FAQ | partial | Ticket creation | Wrote all FAQ copy fresh |
| S18 | GeoIP lookup | partial | Real data source | Kept to GeoIP only |
| S20 | Devices | partial | Labelling form, edit, delete | Redesigned: labels attach only to devices a local scan found |
| S21 / S06 / S07 | Filters + create modal | partial | Hex and title-ID matching, desktop editor | Modal focus handling and Escape |
| S23 | Downloads | done on fake data | Real installer links | None |
| S24 | Device access | partial | Server-side seat enforcement | Switch meter and password-gated reset modal |
| S25 | Xbox upsell shell | partial | Account link | Left out party chat and resolver on purpose |
| S26 | My products | done on fake data | Licence keys from the backend | None |
| S27 | Billing | partial | Live Stripe invoices | Amounts held in cents, formatted on render |

Reference screenshots for each built screen are in `replica/clone-screens/` at 1072x802.

## Not built

- **The Tauri desktop app.** Capture, ARP scan, own-device traffic control, packet tester, inspector and export are all desktop work. Every `must` row for these is still `no`. This is the largest remaining piece of the project.
- **S19 (name resolver) and S22 (blacklist).** Skipped by decision. They identify or target other people. The schema has no tables for them.
- **Real backend.** Auth, database, Stripe, email and jobs are next, in `/replica-backend`.

## Bugs found and fixed

- A Tailwind `spacing` override broke `h-5` to `h-8`, which made the avatar huge and pushed the switch thumb off its track. The override is gone from both configs.
- The first `@import` of tokens sat after `@tailwind`, which Turbopack rejects. It now comes first in `globals.css`.
- Emoji icons became inline SVGs.
- There was no mobile nav. `DashboardShell` now provides an off-canvas drawer below `md`.
- `npm audit` flagged Next 15.1.6 and an old postcss. Both were upgraded; audit shows 0 vulnerabilities.

## Verified

- Production build passes.
- No horizontal overflow at 390px.
- Mobile drawer opens and closes with a click or Escape.
- Create-filter modal works by keyboard.
- Contrast check shows 0 AA failures.

## Not verified

- Every screen at 1440px and 390px by hand. Screenshots exist at 1072px only.
- Console errors on each screen individually.
- Full keyboard run through every flow.

## Feature matrix

40 rows. `must`: 13, with 6 partial and 7 no. `should`: 13, with 5 partial and 8 no. `could`: 6, with 4 partial and 2 no. `skip`: 8. No row is `yes`, because every web feature runs on fake data.

## Update: backend step (2026-11-15)

The fake data layer is gone. `lib/data.ts` reads Supabase and Stripe, and the store, billing, device access, filters, settings and login screens call real routes. Details, what was verified and what needs your keys are in `replica/backend.md`. Screens will show errors until `.env.local` exists and the migrations have run.

## Desktop build (2026-11-15)

Web dashboard archived to `_archive/web-dashboard/`. The product is now a Tauri 2 desktop app in `desktop/`.

- **Step 1, shell and local settings: done.** Left nav (Capture, Settings), settings stored in the app data folder, update-check switch (no update service connected yet).
- **Step 2, capture slice: done.** Adapter list, start and stop, live table. Verified in the running app: 182 packets from the wired adapter in 6 seconds, adapter choice remembered, Stop works.
- **Harder than expected: pushing packets to the window.** On this machine, any Tauri event call (`listen` or `emit`) closes the app with an access violation in `vertdll.dll`, while plain commands work. Cause not found (Tauri 2.12, WebView2 157, Windows 11 26100). The app now avoids events: the capture thread fills a buffer and the window calls `poll_capture` every 150 ms. Re-test events on a second machine before relying on them for anything else.
- **Fixed 2026-11-15:** the adapter drop-down now starts on the connected adapter (found through the routing table, nothing sent) and labels it "(connected)". Verified with fresh settings.
- **Build notes:** build from a short target path (`CARGO_TARGET_DIR=C:/nt-target`) because of the 260-character path limit. The linker needs `wpcap.lib`; one was generated from the installed Npcap DLL (`LIBPCAP_LIBDIR=C:
t-libs`). Npcap must be installed to run.
- **Next:** filters (step 3), replay, traffic control with emergency stop, offline GeoIP and help, update check and installer.

- **Step 3, filters: done (2026-11-15).** Filters page (create, edit, delete, starter set of 5, import and export as a JSON file), saved to `filters.json` in the app data folder, applied to the Capture table through a Filter drop-down. Verified in the app: starter filters added, bad port rejected with a message, "port 443" filter showed only TCP rows touching 443 (106 of 171), 6 filters persisted. Not yet tested: the import and export buttons (file picker). Filters only change what the table shows, not what is captured.

- **Steps 4 to 7, finished 2026-11-15:** replay, export, devices and labels, speed-cap traffic control with emergency stop, offline help, portable zip. Bug pass done. Full status, reasons and open risks: `replica/unbuilt.md`.

- **Round two, 2026-11-15:** offline country lookup (DB-IP Lite), update check with a tested off switch, NSIS installer, private repo EQQX0/EqSniff. The WinDivert driver download was blocked by Windows Defender and removed; traffic control stays a speed cap. Details and open risks: `replica/unbuilt.md`.

- **Round three, 2026-11-15:** Traffic control dropped (code, screen, help text, emergency-stop key removed). Added the Network scan: own subnet only, 256-address cap, 22 ports, consent box. Tested against this PC and the router. Router MAC missing at first because Windows lists it as `static` in the ARP table; fixed.

- **2026-11-15:** update file now served from a separate Vercel project (eqsniff-updates, public) so the repo stays private; installer and portable exe self-signed (not trusted by Windows until the user imports the .cer). Live check returned up-to-date.

- **Round four, 2026-11-15:** copy row/cell/table; pcap export and import (own reader/writer, 5 unit tests); filter editor gained direction, size range, hex and per-filter on/off (35 logic checks); Watch a device from Devices; Devices merges scan results; exports tell the user they land in Downloads. Fixed a race where two fast filter clicks overwrote each other. Installer run silently into a temp folder, launched and uninstalled cleanly. Note: `cargo test --lib` crashes at start-up on this machine (access violation, same family as the Tauri events crash), so the pcap tests were run on the module alone with `rustc --test`.

- **Round five, 2026-11-15:** capture filter (protocol, port, one address, minimum size) built from validated boxes and applied by the driver at Start; the text is checked twice (window and app side) and bad input never reaches the driver. 11 live checks (rows recorded match the rule; 5 malformed filters refused) and 6 UI checks passed.
