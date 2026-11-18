# Recon map: the reference app (Windows desktop, v5.0)

> **Scope changed 2026-11-15.** The product is now a free, account-free, local-only Windows app. `replica/scope.md` overrides this file where they disagree. Web, Supabase, Stripe, licence and support sections below are historical.


Scope: all public features, mapped to screens/flows/data model where they fit the
"own network" slice you approved. Features that identify or disrupt other
players are listed as `skip` rows in the feature matrix and in the "Out of
scope" section below — not as screens, flows, or schema.
For: your own product, Windows desktop.
Date: 2026-11-14

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | Marketing home | [reference-site]/ | feature summary, pricing, comparison table vs Wireshark/LANC |
| 2 | Features page | [reference-site]/features/ | full feature list by category |
| 3 | About page | [reference-site]/about/ | company history, 2015–2026 timeline |
| 4 | FAQ (expanded) | [reference-site]/faq/ | definitions for every major feature, legal/safety stance |
| 5 | Supported games | [reference-site]/games/ | example P2P/hybrid-networking titles |
| 6 | News — 5.0 release | [reference-site]/news/ | confirms 5.0 is a C++ rewrite, new dashboard, Traffic Control, Packet Tester, Packet Inspector, built-in nmap |
| 7 | [reference-site-billing] | [reference-site-billing]/ | checkout page, no extractable text (canvas/JS-rendered) |
| 8 | [reference-site-dashboard] | [reference-site-dashboard]/, /tools, /tools/resolver, /ip-labels, /filters, /blacklist, /downloads, /device-access, /xbox, /entitlements, /billing | your own account, confirmed; walked every nav item |

**Dashboard walkthrough (your account, confirmed 2026-11-15):** screenshots
saved to `replica/screens/`. Notes per screen, personal data redacted:

- **Tools → GeoIP Lookup**: an IP input box and a "Lookup" panel, empty until
  you submit an IP. Confirms S-GeoIP below.
- **Tools → Resolver (Gamertag Resolver)**: a PSN/Xbox toggle, a username
  input, a "Resolve" button, and two live counters — **10,654,689 PSN** and
  **8,570,115 Xbox** entries in "the reference app's database." This is the Username
  AI feature in its actual form: a lookup against a precomputed database of
  gamertag→IP pairs, not a live AI decrypt as the marketing copy implies. I
  did not run a lookup. Still a `skip` — see Out of scope.
- **IP Storage**: a table of IP addresses with a free-text "comment" per row
  (66 entries, paginated), search, edit/delete per row, "New Label" button.
  The comments on your account's rows are other people's gamertags next to
  their IPs — i.e., this screen is a personal address book built from the
  resolver/capture tools. I'm not listing the actual IPs or names here; they
  are personal data about third parties, not feature spec. Confirms entity
  `IpLabel` below.
- **Packet Filters**: "My Filters" (empty on your account) vs. "Community"
  tab (34 shared filters), a "New Filter"/"Create Filter" CTA. Matches S06–S08.
- **Blacklist**: lets the account holder remove their *own* PSN/Xbox gamertag
  from other users' resolver results — one PSN + one Xbox username, with
  update/remove controls. This is a privacy opt-out for the Username AI
  feature, confirming that feature's reach (it works on any un-blacklisted
  gamertag) rather than adding a new one to clone.
- **Downloads**: platform tabs (Windows/macOS/Linux), one card per product
  (the reference app "Owned", current version + release date; Traffic Control/Lag
  Switch "Not Owned" with a buy link), an "Antivirus flagging the reference app?"
  help note saying they obfuscate the binary against cracking.
- **Device Access**: list of devices that have run the software (name, "last
  used"/"active" status), a monthly device-switch limit (used 1 of 3), a
  "Reset Active Device" action gated behind re-entering your account
  password. This is a license/seat-binding mechanism, not a feature to
  reverse — a clone needs its own licensing design, not a copy of this one.
- **Xbox**: gated behind a separate subscription ("Subscription Required").
  Lists what unlocks: Party Chat join/monitor, Gamertag Resolver, real-time
  Xbox network monitoring, account sync. Confirms the Xbox Toolkit `skip`
  rows — party-chat and gamertag-resolver are exactly the two already
  excluded.
- **My Products**: counts (active products, subscriptions, one-time
  products, points balance) and a product list with status badges
  (Granted/Lifetime, Activated date).
- **Billing**: invoice totals (count, total paid, outstanding) and an invoice
  table (product name, status, total/paid/due, date) — confirms separate
  line items per add-on (PlayStation AI, Traffic Control) rather than one
  bundled subscription.

None of this changes the skip list below; if anything it sharpens it — the
resolver's own counters and the blacklist screen both confirm the Username AI
feature operates on everyone's gamertag by default unless they opt out, which
is the harassment-surface concern the skip was already about.

## Core loop

Capture packets from devices on a network, filter them down to a specific
game/app's traffic, resolve the IPs (and, as sold, the usernames) in that
traffic, then optionally act on a chosen IP with the Traffic Control engine.

## Screens

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Install / first run | installer → desktop app | get the app running, pick network interface | installer wizard, interface picker | empty, error (no interface found) |
| S02 | Login / account | app launch, [reference-site-dashboard] | sign in, 2FA, license check | email/password form, 2FA code field | empty, error, locked-out |
| S03 | Dashboard home | main app window | entry point, quick actions, news | nav sidebar, quick-action tiles, news feed, user count badge | filled (unconfirmed-source screenshot) |
| S04 | Network/device scan | Tools → ARP scan | discover devices on the LAN | device list, vendor tag, router flag | empty (no devices yet), scanning, filled |
| S05 | Live capture / traffic table | main capture view | show captured packets per device | start/stop button, interface selector, traffic table (IP, packets, bytes, port, timestamp) | empty, capturing, filled, error |
| S06 | Packet filters list | Packet Filters nav item | browse/enable filters | filter list, per-filter toggle, search | empty, filled |
| S07 | Custom filter editor | "create filter" from S06 | build a filter | protocol/direction/port/length/hex-pattern fields, Title ID field | empty, editing, saved, invalid |
| S08 | Cloud filters browser | filters → cloud tab | browse community filters | list, one-tap enable toggle | empty, filled |
| S09 | Global filter settings | filters → global | set capture-wide limits | protocol/length/port/hex fields | filled |
| S10 | Traffic Control rules | Tools → Traffic Control | build packet-manipulation rules | rule list, action picker (drop/lag/throttle/reorder/duplicate), probability slider, burst scheduler, live stats, emergency-stop button | empty, running, stopped |
| S11 | Packet Tester | Tools → Packet Tester | craft/send/replay packets | packet builder, header editor, payload editor, replay-from-capture picker | empty, editing, sent |
| S12 | Packet Inspector | Tools → Packet Inspector | raw hex view of a packet | hex/ASCII pane, built-in nmap-style scan trigger | empty, filled |
| S13 | PSN / Xbox account link | Integrations settings | link platform account for auto-filter | OAuth connect button, linked-account card (avatar, online ID), background-refresh status | not linked, linking, linked, token-expired |
| S14 | Settings | nav → Settings | theme, language, 2FA, account | theme picker (Ultra Dark/Dark/Light), accent color picker, language dropdown, 2FA toggle | filled |
| S15 | Export dialog | capture table → export | save/copy captured rows | format picker (CSV/JSON/TXT), copy-row/cell/table buttons | empty, exported |
| S16 | Store / billing | Store nav item, [reference-site-billing] | buy base app and add-ons | plan cards, price, payment methods | filled (checkout page itself was JS-rendered, not readable as text) |
| S17 | Support | Support nav item, in-app helpdesk | FAQ, ticket, Discord link | FAQ accordion, "open ticket" button, Discord button | filled |
| S18 | GeoIP lookup | dashboard Tools → GeoIP Lookup | look up one IP's geolocation | IP input, lookup button, results panel | empty, filled |
| S19 | Gamertag resolver | dashboard Tools → Resolver | look up a gamertag against the shared IP database | platform toggle, username input, resolve button, live entry-count badges | empty, filled — **skip**, see Out of scope |
| S20 | IP address book | dashboard → IP Storage | your own saved IP + comment pairs | searchable table, per-row edit/delete, "New Label" | empty, filled, paginated |
| S21 | My filters / community filters | dashboard → Packet Filters | manage your filters, browse shared ones | My Filters tab (empty state), Community tab with count | empty, filled |
| S22 | Gamertag blacklist | dashboard → Blacklist | opt your own gamertag out of the resolver | PSN card, Xbox card, blacklist/update/remove controls | not blacklisted, blacklisted |
| S23 | Downloads | dashboard → Downloads | get the installer per product/platform | platform tabs, owned/not-owned product cards, antivirus-flagging help note | owned, not-owned |
| S24 | Device access / licensing | dashboard → Device Access | manage which machine is licensed | device list with active/last-used state, switch-limit meter, password-gated reset | normal, limit-reached |
| S25 | Xbox add-on gate | dashboard → Xbox | upsell for the Xbox subscription | locked-feature list, "Visit Store" CTA | locked, unlocked (not seen) |
| S26 | My products / subscriptions | dashboard → My Products | see what's owned | summary counters, product cards with status badges | filled |
| S27 | Billing & invoices | dashboard → Billing | billing history | summary counters, invoice table, per-invoice detail (not opened) | filled |

## Flows

```
F01 First-time setup and first capture
    S01 install -> S02 login/2FA -> S03 dashboard -> S04 scan network
    -> S05 select device, start capture
    edge: no network interface detected, 2FA code wrong, no devices found on scan

F02 Filter a capture down to one game
    S05 live capture -> S06 packet filters -> S07 create/edit a custom filter
    (or S08 enable a cloud filter) -> back to S05, table narrows to that game's packets
    edge: filter matches zero packets, hex pattern invalid, Title ID unknown

F03 Auto-switch filters by linked account
    S13 link PSN/Xbox account -> S05 capture starts -> filter auto-switches
    when the detected game changes
    edge: token expired mid-session, account unlinked, game not in filter library

F04 Export a capture
    S05 live capture -> stop -> S15 export dialog -> choose format -> save/copy
    edge: empty capture, very large capture, clipboard permission denied

F05 Build and test a custom packet
    S11 packet tester -> craft or replay a packet -> send -> S12 packet
    inspector to read the raw response
    edge: malformed packet, target unreachable, replay source capture deleted

F06 Buy and activate
    S16 store -> checkout ([reference-site-billing]) -> S02 login -> license applied
    edge: payment declined, license already in use on another device
```

Happy-path click count for F01 (the number to beat): about 6 clicks from
install to first filled traffic table.

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Nav sidebar | collapsed, expanded | default, active-item highlighted | all screens |
| Traffic table row | own-device, discovered-device | default, selected, highlighted-on-match | S05 |
| Filter toggle switch | built-in, custom, cloud | on, off, syncing | S06, S08, S09 |
| Rule card (Traffic Control) | drop, lag, throttle, reorder, duplicate | idle, running, paused | S10 |
| Stat counter | packets, bytes, dropped, delayed | live-updating | S05, S10 |
| Account-link card | PSN, Xbox | not linked, linked, token-expired | S13 |
| Accordion item | FAQ question, filter group | collapsed, expanded | S17, S06 |
| Theme/accent picker | 3 themes × color swatches | default, selected | S14 |
| Toast / notification | success, error, info | appearing, dismissing | all screens |
| Modal / dialog | export, confirm, emergency-stop confirm | open, closed | S10, S15 |

## Inferred data model

```
Device       id, mac, ip, vendor, is_router (bool), last_seen, label
             evidence: S04 ARP scan, features page "Network Device Discovery", "ARP Network Scanner"
             confidence: high (own-device scanning); medium (fields beyond mac/ip/vendor)

CaptureSession   id, user_id, started_at, ended_at, interface, device_id (nullable)
             evidence: S05 live capture, FAQ "How does the reference app pull IPs"
             confidence: medium

PacketSample id, session_id, src_ip, dst_ip, src_port, dst_port, protocol,
             length, timestamp, raw_hex (nullable)
             evidence: S05 traffic table columns, S12 Packet Inspector hex view
             confidence: medium

FilterRule   id, owner_id (nullable for built-in), name, protocol, direction,
             port_range, length_range, hex_pattern, game_title_id (nullable),
             source (built-in | custom | cloud), enabled (bool)
             evidence: S06/S07/S08/S09, features page "Custom Packet Filters", "Global Packet Filter"
             confidence: high

TrafficControlRule  id, owner_id, action (drop|lag|throttle|reorder|duplicate),
             target_ip, target_port, protocol, probability, burst_schedule,
             enabled (bool)
             evidence: S10, FAQ "What is Traffic Control", "Can I target specific players"
             confidence: high

PacketTestSession id, owner_id, built_packet (headers+payload), replay_source_id (nullable)
             evidence: S11, FAQ "What is the Packet Tester"
             confidence: medium

LinkedAccount id, owner_id, platform (psn|xbox), external_id, display_name,
             avatar_url, access_token, refresh_token, expires_at
             evidence: S13, features page "PlayStation Integration", "Xbox Integration"
             confidence: medium (token handling is a guess)

License      id, owner_id, product (base|ps4_username_ai|traffic_control|xbox_toolkit),
             purchased_at, billing_type (one_time|subscription), status
             evidence: S16, home page pricing section (base $19.99 one-time;
             add-ons $5.9/mo each)
             confidence: high

Account      id, email, password_hash, two_factor_enabled, theme, accent_color,
             language, discord_presence_enabled
             evidence: S02, S14, features page "Two-Factor Authentication",
             "Multi-Language UI", "Themes & Accent Colors", "Discord Rich Presence"
             confidence: high

ExportJob    id, session_id, format (csv|json|txt), created_at
             evidence: S15, features page "Export Traffic Data"
             confidence: high

IpLabel      id, owner_id, ip_address, comment, created_at
             evidence: S20 (dashboard IP Storage, your account, 66 rows)
             confidence: high — this is your own saved-address-book feature,
             not the skipped resolver/geoIP itself; keep the screen and
             entity, do not seed it with the sample data on your account

GamertagBlacklistEntry  id, owner_id, platform (psn|xbox), gamertag
             evidence: S22 (dashboard Blacklist)
             confidence: high — only buildable if you also build the
             resolver it opts out of, so it rises or falls with that `skip`

Invoice      id, owner_id, product_label, status (open|paid), total, paid,
             due_date
             evidence: S27 (dashboard Billing, 5 invoices across 3 products)
             confidence: high

DeviceSeat   id, owner_id, device_name, is_active (bool), last_used_at
             evidence: S24 (dashboard Device Access, monthly-switch meter
             1/3, password-gated reset)
             confidence: medium — switch-limit and reset mechanics are a
             guess at the rule, the screen and fields are confirmed
```

Relationships: Account 1–n LinkedAccount; Account 1–n License; Account 1–n
CaptureSession; CaptureSession 1–n PacketSample; CaptureSession 1–n Device
(discovered); Account 1–n FilterRule; Account 1–n TrafficControlRule;
CaptureSession 1–n ExportJob; Account 1–n IpLabel; Account 1–n
GamertagBlacklistEntry (max 1 per platform); Account 1–n Invoice; Account
1–n DeviceSeat.

## Feature matrix

See `features.csv`. Must: 13, should: 13, could: 6, skip: 8.

## Out of scope (cannot or should not be cloned)

- **Finding other players' IP addresses, PSN-username-to-IP / Xbox-gamertag-to-IP
  resolution ("Username AI"), and "Username/GT to IP Lookup."** The product's
  own FAQ says this is legal only "on networks you own or have authorization
  to monitor," then sells a feature whose explicit purpose is resolving a
  stranger's IP from their in-game username. That mismatch is the product's
  problem, not a technicality to route around. Not cloned. Confirmed in the
  dashboard (S19): it's a lookup against a database of 10.6M PSN and 8.5M
  Xbox gamertag→IP pairs the vendor has built up from users submitting other
  people's data, not a live per-session decrypt as the marketing copy says.
  The existence of an opt-out Blacklist screen (S22) for your *own* gamertag
  only reinforces that by default everyone else's is exposed.
- **Traffic Control's player-targeting mode** — the FAQ confirms rules can
  target "a player's IP from the capture table" to drop/lag/throttle their
  connection. That is a lag-switch attack on someone else's connection.
  Not cloned. The non-targeted version (shape and rate-limit traffic on your
  own devices for testing/QoS) is kept, see features.csv.
- **Proprietary Geo IP database and "DDoS Protection Lookup."** Used mainly to
  locate/profile other players' connections. The vendor's own database and
  methodology aren't available to clone anyway; a general-purpose public
  GeoIP lookup for your own IPs is a reasonable "should"-tier substitute,
  listed separately.
- **Cloud filters / community filter library.** This is the original's user
  network and data, not a feature to rebuild; your clone would need its own
  (smaller) seed set.
- **Xbox Toolkit** (party-chat crashing, session IP grabber, friend-list
  viewer, reading another account's Xbox messages). Everything it does acts
  on other people's sessions or requires OAuth scopes Microsoft would not
  grant for this use. Not cloned.
- **Packet Tester "send to any IP."** The device-focused version (replay a
  capture against your own test device) is kept; sending arbitrary crafted
  packets at third-party IPs is not.
- **1M+ user count, "trusted by" claims, Discord community.** Marketing/social
  proof that belongs to the original, not a feature.

## Size

Screens 27, flows 6, entities 14. Hard parts:
Windows packet capture/injection (needs a signed driver, e.g. WinDivert or
Npcap-style), ARP-based device discovery, live traffic-table performance
at high packet rates, OAuth integration with PlayStation/Xbox for the
auto-filter flow, license/subscription billing for the two separate price
tiers (one-time + $5.9/mo add-ons). Size: **L** for the own-network slice you
approved (capture, filters, device discovery, export, your-own-device
Traffic Control, account/licensing). Would be **XL** if the skipped features
were included — which is exactly why they're skipped.
