# Architecture: your network toolkit (a rebuild of the reference app's own-network features)

> **Scope changed 2026-11-15.** The product is now a free, account-free, local-only Windows app. `replica/scope.md` overrides this file where they disagree. Web, Supabase, Stripe, licence and support sections below are historical.


Scope note: this plans only the `clone=no` rows in `features.csv` — capture,
filtering, discovery, export, your-own-device Traffic Control, licensing and
account/billing. The Username AI resolver, Traffic Control's player-targeting
mode, the proprietary GeoIP/DDoS lookup, the cloud filter marketplace, and the
Xbox Toolkit are `skip` rows and have no schema, routes, or screens below.

## Stack

| layer | choice | why |
| --- | --- | --- |
| desktop app | Tauri (Rust core + web UI) | needs raw packet capture and a signed driver; Rust gives direct access to `pcap`/`windivert` crates with a small, auditable binary — Electron would work but ships a heavier, slower capture loop |
| capture/driver | Npcap (via the `pcap` crate) for capture + ARP discovery; WinDivert (via the `windivert` crate) for your-own-device Traffic Control | both are legitimate, widely-used Windows packet libraries with their own signed drivers; this avoids writing or shipping your own kernel driver |
| web dashboard | Next.js (App Router) + TypeScript | account, billing, filter/device sync, downloads — matches the default and needs no native capability |
| styling | Tailwind, tokens from replica-design | consistent with the dashboard's dark theme + accent picker feature |
| database | Postgres on Supabase | one managed instance covers DB + Auth + Realtime, keeps infra to one vendor |
| ORM | Drizzle | typed schema, plain SQL migrations, no magic |
| auth | Supabase Auth (email/password + TOTP for 2FA) | built-in MFA covers the "Two-Factor Authentication" must-have without a separate service |
| payments | Stripe Checkout + Billing | handles both the one-time base price and the per-add-on subscriptions cleanly; invoice history is read live from Stripe, not duplicated in Postgres |
| email | Resend | password reset, 2FA fallback, receipts |
| jobs | Supabase Cron (pg_cron) + a small worker, or Trigger.dev if you outgrow pg_cron | token refresh, monthly device-switch reset, stale-device cleanup |
| files | none server-side | capture data, exports, and the config export files never leave the desktop app — see schema rationale |
| hosting | Vercel (dashboard) + Supabase (DB/Auth) | zero-ops at low volume |

**Why the desktop app and the web dashboard are two codebases, not one:**
the original does this too (desktop reference-app.exe vs. [reference-site-dashboard])
because packet capture and ARP scanning need OS-level access a browser can't
get. The dashboard is account/billing/sync only; it never touches packets.

## Schema

Tables: 7 (`profiles`, `licenses`, `device_seats`, `filter_rules`, `devices`,
`device_labels`, `linked_accounts`, `support_tickets` — 8, see list below).
Access rules: **Postgres row-level security** on every table, policy
`owner_id = auth.uid()` for select/insert/update/delete. No app-layer checks
duplicate this — RLS is the single source of truth.

**Rationale for what's *not* here:** `CaptureSession`, `PacketSample`,
`TrafficControlRule`, and `PacketTestSession` from the recon's inferred data
model are deliberately **not** server tables. Raw captured traffic is exactly
the data you don't want centralized — it's a liability (other households'
packets passing through a user's NIC) and it isn't needed for anything the
dashboard does. Those stay in a local SQLite file inside the desktop app,
per Windows user, never uploaded. Only configuration (filters, device
labels, license state) is account-level and synced.

The original's free-text "IP Storage" address book (comment-per-arbitrary-IP)
is also deliberately not rebuilt as a general lookup tool. Instead,
`device_labels` only attaches to a `devices` row your *own* ARP scan
discovered on your *own* network — you can't type in an arbitrary stranger's
IP and attach a name to it with no discovery step behind it. That's the
schema-level version of the skip decision in `recon.md`.

```sql
-- 0001_init.sql
create extension if not exists pgcrypto;

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  theme text not null default 'dark'
    check (theme in ('ultra_dark','dark','light')),
  accent_color text not null default '#e4572e',
  language text not null default 'en'
    check (language in ('en','es','fr','it','pt','ru','ar')),
  discord_presence_enabled boolean not null default false,
  stripe_customer_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table licenses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  product text not null check (product in ('base','traffic_control')),
  billing_type text not null check (billing_type in ('one_time','subscription')),
  status text not null default 'active'
    check (status in ('active','past_due','canceled')),
  stripe_payment_intent_id text,
  stripe_subscription_id text,
  purchased_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, product)
);
create index on licenses (owner_id);

create table device_seats (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  device_name text not null,
  device_fingerprint text not null,
  is_active boolean not null default false,
  last_used_at timestamptz not null default now(),
  switches_used_this_period int not null default 0,
  period_reset_at timestamptz not null default (date_trunc('month', now()) + interval '1 month'),
  created_at timestamptz not null default now(),
  unique (owner_id, device_fingerprint)
);
create index on device_seats (owner_id);
create unique index one_active_seat_per_owner on device_seats (owner_id) where is_active;

create table filter_rules (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references profiles(id) on delete cascade, -- null = built-in seed filter
  name text not null,
  protocol text not null check (protocol in ('tcp','udp','any')),
  direction text not null check (direction in ('inbound','outbound','both')),
  port_range int4range,
  length_range int4range,
  hex_pattern text,
  game_title_id text,
  source text not null default 'custom' check (source in ('built_in','custom')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on filter_rules (owner_id);

create table devices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  mac_address text not null,
  last_ip inet,
  vendor text,
  is_router boolean not null default false,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (owner_id, mac_address)
);
create index on devices (owner_id);

create table device_labels (
  device_id uuid primary key references devices(id) on delete cascade,
  owner_id uuid not null references profiles(id) on delete cascade,
  label text not null,
  updated_at timestamptz not null default now()
);
create index on device_labels (owner_id);

create table linked_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  platform text not null check (platform in ('psn','xbox')),
  external_id text not null,
  display_name text,
  avatar_url text,
  access_token_enc text not null,   -- encrypted at rest (pgsodium or app-layer AEAD)
  refresh_token_enc text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (owner_id, platform)
);
create index on linked_accounts (owner_id);

create table support_tickets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  subject text not null,
  status text not null default 'open' check (status in ('open','pending','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on support_tickets (owner_id);

create table support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references support_tickets(id) on delete cascade,
  author text not null check (author in ('user','staff')),
  body text not null,
  created_at timestamptz not null default now()
);
create index on support_ticket_messages (ticket_id);

alter table profiles enable row level security;
alter table licenses enable row level security;
alter table device_seats enable row level security;
alter table filter_rules enable row level security;
alter table devices enable row level security;
alter table device_labels enable row level security;
alter table linked_accounts enable row level security;
alter table support_tickets enable row level security;
alter table support_ticket_messages enable row level security;

create policy "owns row" on profiles for all using (id = auth.uid());
create policy "owns row" on licenses for all using (owner_id = auth.uid());
create policy "owns row" on device_seats for all using (owner_id = auth.uid());
create policy "owns row, built-ins readable" on filter_rules for select
  using (owner_id = auth.uid() or owner_id is null);
create policy "owns row" on filter_rules for insert with check (owner_id = auth.uid());
create policy "owns row" on filter_rules for update using (owner_id = auth.uid());
create policy "owns row" on filter_rules for delete using (owner_id = auth.uid());
create policy "owns row" on devices for all using (owner_id = auth.uid());
create policy "owns row" on device_labels for all using (owner_id = auth.uid());
create policy "owns row" on linked_accounts for all using (owner_id = auth.uid());
create policy "owns row" on support_tickets for all using (owner_id = auth.uid());
create policy "owns ticket's messages" on support_ticket_messages for all using (
  ticket_id in (select id from support_tickets where owner_id = auth.uid())
);
```

(see `replica/schema.sql` for this same SQL as the first migration file.)

## API

| method path | does | who | input | output | flow |
| --- | --- | --- | --- | --- | --- |
| POST /api/checkout | create a Stripe Checkout session | authed user | `{ product: 'base'\|'traffic_control' }` | `{ url }` | F06 |
| POST /api/stripe/webhook | apply Stripe events to `licenses` | Stripe | Stripe event | 200 | F06 |
| GET /api/invoices | list this user's invoices, read live from Stripe | authed user | — | `Invoice[]` | S27 |
| GET /api/licenses | list entitlements | authed user | — | `License[]` | S26 |
| GET /api/device-seats | list this user's known devices + active flag | authed user | — | `DeviceSeat[]` | S24 |
| POST /api/device-seats/switch | make a seat active, spend one monthly switch | authed user | `{ seat_id }` | `DeviceSeat` | S24 |
| POST /api/device-seats/reset | sign out active seat (password-gated) | authed user | `{ password }` | 200 | S24 |
| GET /api/filters | list built-in + own filters | authed user, or desktop app with device token | — | `FilterRule[]` | F02 |
| POST /api/filters | create a custom filter | authed user | `FilterRule` fields | `FilterRule` | F02, S07 |
| PATCH /api/filters/:id | edit/enable/disable | owner only | partial fields | `FilterRule` | S06 |
| DELETE /api/filters/:id | remove | owner only | — | 204 | S06 |
| GET /api/devices | list discovered devices + labels | authed user | — | `Device[]` | S04, S20 |
| PUT /api/devices/:id/label | set/clear this device's label | owner only | `{ label }` | `DeviceLabel` | S20 |
| POST /api/integrations/:platform/connect | start OAuth | authed user | — | redirect URL | F03, S13 |
| GET /api/integrations/:platform/callback | finish OAuth, store tokens | platform IdP redirect | code | redirect to dashboard | F03 |
| DELETE /api/integrations/:platform | unlink | owner only | — | 204 | S13 |
| GET /api/downloads/:platform | signed, time-limited installer URL | licensed user | — | `{ url }` | S23 |
| POST /api/support/tickets | open a ticket | authed user | `{ subject, body }` | `SupportTicket` | S17 |
| GET /api/support/tickets | list own tickets | authed user | — | `SupportTicket[]` | S17 |
| POST /api/support/tickets/:id/messages | reply | owner only | `{ body }` | `TicketMessage` | S17 |

Webhooks in: **Stripe** (`checkout.session.completed`, `invoice.paid`,
`invoice.payment_failed`, `customer.subscription.updated`,
`customer.subscription.deleted`).
Webhooks out: none — Discord Rich Presence is a local desktop-to-Discord-client
IPC call, not a server webhook.
Jobs: **refresh-platform-tokens** (every 15 min, refreshes `linked_accounts`
rows expiring within 1 hour) · **reset-device-switches** (monthly, zeroes
`switches_used_this_period` where `period_reset_at <= now()`) ·
**prune-stale-devices** (weekly, deletes `devices` rows unseen for 90 days
with no label attached).

**Desktop app, local only (not HTTP — Tauri commands, same process):**
`start_capture` / `stop_capture`, `scan_network` (ARP), `apply_filter`,
`traffic_control_rule` (create/run/stop — own device/IP only, enforced by
only ever reading the local machine's own interface addresses as valid
targets), `packet_tester_send` (target must be a device from the user's own
`scan_network` result or a manually-entered RFC1918 address — never an
arbitrary public IP), `packet_inspector_view`, `export_capture` (CSV/JSON/TXT
to local disk). These never leave the machine; the only network calls the
desktop app makes outward are to the API routes above (license check, filter
sync, device-label sync) and to Discord's local RPC socket.

## The parts that bite

- **Time zones:** every timestamp is `timestamptz` in UTC; the dashboard
  renders in the viewer's local zone via `Intl.DateTimeFormat`. Invoice due
  dates come straight from Stripe, already UTC.
- **Idempotency:** Stripe webhooks can arrive more than once. Keep a
  `processed_stripe_events(event_id primary key)` table and insert-or-skip
  before applying any event.
- **Races:** `device_seats.switch` must be one transaction: check
  `switches_used_this_period < 3` and the unique partial index
  `one_active_seat_per_owner` together, or two tabs switching at once both
  succeed. Filter edits from two machines use an `updated_at`/`version`
  column with last-write-wins and a toast if the server rejects a stale write.
- **Rate limits:** login/2FA attempts get Supabase Auth's own rate limiting;
  the desktop capture/filter loop is a local performance problem, not an API
  one — document a packet-table row cap (e.g. ring-buffer of the last 50k
  rows) so the UI doesn't fall over on a noisy LAN.
- **Offline:** the desktop app must capture with zero internet. Cache the
  license check result locally with a 72-hour grace period before the app
  refuses to run, so a flaky connection doesn't brick a paying user's tool.
- **Email deliverability:** verify the sending domain with Resend (SPF/DKIM)
  before relying on it for password reset or 2FA fallback codes.
- **Multi-tenancy:** none needed — one owner per row, no orgs/teams. Keeps
  every RLS policy a one-line `owner_id = auth.uid()`.
- **GDPR / account deletion:** deleting a `profiles` row cascades every table
  above (all have `on delete cascade`). Separately: cancel any active Stripe
  subscription and revoke `linked_accounts` OAuth tokens with PlayStation/
  Xbox *before* dropping the row, since those are revocations at a third
  party, not just a local delete.

## Build order

1. **Vertical slice.** Sign up (Supabase Auth) → buy the base license
   (Stripe Checkout, `/api/checkout`) → download and run the desktop app
   (`/api/downloads/windows`) → it checks the license, scans the LAN
   (`scan_network`), starts a capture (`start_capture`), applies a built-in
   filter, and exports the result. Screens: S01, S02, S04, S05, S06, S15,
   S23. Tables: `profiles`, `licenses`, `device_seats`, `filter_rules` (seed
   rows), `devices`. Routes: `/api/checkout`, `/api/stripe/webhook`,
   `/api/licenses`, `/api/device-seats`, `/api/filters` (read), `/api/downloads`.
2. **Must-haves** from `features.csv`: custom filter editor + sync (S06,
   S07), Traffic Control on your own device (S10), 2FA (Supabase Auth TOTP),
   export formats (S15), billing/invoices (S26, S27), device seat management
   (S24).
3. **Should-haves:** Packet Tester/Inspector against your own devices (S11,
   S12), device labels (S20, restricted to discovered devices), themes +
   language (S14), support tickets (S17), PSN/Xbox account linking for
   auto-filter (S13, F03).
4. **Could-haves:** GeoIP lookup for your own captured IPs (S18, a
   general-purpose public API, not the original's proprietary DB), a basic
   LAN nmap-style scan, Discord Rich Presence, remaining languages.
5. **Fixes from `/replica-entrepreneur`** once it has run.
