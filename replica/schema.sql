-- 0001_init.sql
-- Schema for the own-network toolkit (clone of OctoSniff's non-skip features).
-- See replica/architecture.md for the rationale behind what is and isn't here.

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

-- Labels only attach to a device your own scan discovered — never a
-- free-typed arbitrary IP. See architecture.md "Rationale for what's not here".
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

-- Idempotency guard for Stripe webhooks (see architecture.md "The parts that bite").
create table processed_stripe_events (
  event_id text primary key,
  processed_at timestamptz not null default now()
);

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
