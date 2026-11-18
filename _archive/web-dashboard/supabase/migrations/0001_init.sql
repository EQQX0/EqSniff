-- 0001_init.sql
-- Schema for the own-network toolkit (clone of the reference app's non-skip features).
-- See replica/architecture.md for the rationale behind what is and isn't here.

create extension if not exists pgcrypto;

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  theme text not null default 'dark'
    check (theme in ('ultra_dark','dark','light')),
  accent_color text not null default '#3a5ce0',
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

-- Row level security. Clients may read their own rows; anything that grants
-- entitlements or spends quotas is written only by the service role or by the
-- security definer functions below.
alter table profiles enable row level security;
alter table licenses enable row level security;
alter table device_seats enable row level security;
alter table filter_rules enable row level security;
alter table devices enable row level security;
alter table device_labels enable row level security;
alter table linked_accounts enable row level security;
alter table support_tickets enable row level security;
alter table support_ticket_messages enable row level security;
alter table processed_stripe_events enable row level security;

-- profiles: read own, update only display preferences (column grants below)
create policy "read own" on profiles for select using (id = (select auth.uid()));
create policy "update own" on profiles for update
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- licenses and seats: read-only for clients
create policy "read own" on licenses for select using (owner_id = (select auth.uid()));
create policy "read own" on device_seats for select using (owner_id = (select auth.uid()));

-- filters: built-ins readable by everyone signed in, custom ones fully owned
create policy "read own and built-in" on filter_rules for select
  using (owner_id = (select auth.uid()) or owner_id is null);
create policy "insert own custom" on filter_rules for insert
  with check (owner_id = (select auth.uid()) and source = 'custom');
create policy "update own custom" on filter_rules for update
  using (owner_id = (select auth.uid()) and source = 'custom')
  with check (owner_id = (select auth.uid()) and source = 'custom');
create policy "delete own custom" on filter_rules for delete
  using (owner_id = (select auth.uid()) and source = 'custom');

create policy "own devices" on devices for all
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- a label can only sit on a device the same user's scan discovered
create policy "own labels" on device_labels for all
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and exists (select 1 from devices d where d.id = device_id and d.owner_id = (select auth.uid()))
  );

create policy "read own" on linked_accounts for select using (owner_id = (select auth.uid()));
create policy "delete own" on linked_accounts for delete using (owner_id = (select auth.uid()));

create policy "own tickets" on support_tickets for all
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy "read own ticket messages" on support_ticket_messages for select using (
  ticket_id in (select id from support_tickets where owner_id = (select auth.uid()))
);
create policy "write user messages on own tickets" on support_ticket_messages for insert with check (
  author = 'user'
  and ticket_id in (select id from support_tickets where owner_id = (select auth.uid()))
);
-- processed_stripe_events: no policies, so only the service role can touch it.

-- Column-level grants: tokens and billing ids never reach the browser.
revoke all on profiles, licenses, device_seats, linked_accounts, processed_stripe_events from authenticated, anon;
grant select (id, theme, accent_color, language, discord_presence_enabled, created_at, updated_at)
  on profiles to authenticated;
grant update (theme, accent_color, language, discord_presence_enabled) on profiles to authenticated;
grant select on licenses, device_seats to authenticated;
grant select (id, owner_id, platform, external_id, display_name, avatar_url, expires_at, created_at)
  on linked_accounts to authenticated;
grant delete on linked_accounts to authenticated;
revoke all on filter_rules, devices, device_labels, support_tickets, support_ticket_messages from anon;

-- New auth user -> profile row.
create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id) values (new.id);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- Spend one monthly switch to make a seat the active one. One transaction,
-- guarded by the partial unique index, so two tabs cannot both win.
create function switch_device_seat(p_seat_id uuid, p_limit int default 3)
returns device_seats
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  seat device_seats;
  used int;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into seat from device_seats where id = p_seat_id and owner_id = uid for update;
  if not found then raise exception 'seat not found' using errcode = 'P0002'; end if;
  if seat.is_active then return seat; end if;

  -- the allowance belongs to the owner, not to one seat, so count across all seats
  if exists (select 1 from device_seats where owner_id = uid and period_reset_at <= now()) then
    update device_seats
      set switches_used_this_period = 0,
          period_reset_at = date_trunc('month', now()) + interval '1 month'
      where owner_id = uid;
  end if;
  select coalesce(sum(switches_used_this_period), 0) into used from device_seats where owner_id = uid;
  if used >= p_limit then
    raise exception 'monthly switch limit reached' using errcode = 'P0001';
  end if;

  update device_seats set is_active = false where owner_id = uid and is_active;
  update device_seats
    set is_active = true, last_used_at = now(),
        switches_used_this_period = switches_used_this_period + 1
    where id = p_seat_id
    returning * into seat;
  return seat;
end $$;

-- Sign the active seat out. Costs one monthly switch, otherwise reset-then-sign-in
-- would be a free way to move the licence. The API route re-checks the password first.
create function reset_device_seat(p_limit int default 3) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  active_id uuid;
  used int;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select id into active_id from device_seats where owner_id = uid and is_active for update;
  if active_id is null then return; end if;

  if exists (select 1 from device_seats where owner_id = uid and period_reset_at <= now()) then
    update device_seats
      set switches_used_this_period = 0,
          period_reset_at = date_trunc('month', now()) + interval '1 month'
      where owner_id = uid;
  end if;
  select coalesce(sum(switches_used_this_period), 0) into used from device_seats where owner_id = uid;
  if used >= p_limit then
    raise exception 'monthly switch limit reached' using errcode = 'P0001';
  end if;

  update device_seats
    set is_active = false, switches_used_this_period = switches_used_this_period + 1
    where id = active_id;
end $$;

-- Monthly job (service role): zero the counters whose period ended.
create function reset_expired_switch_periods() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update device_seats
    set switches_used_this_period = 0,
        period_reset_at = date_trunc('month', now()) + interval '1 month'
    where period_reset_at <= now();
  get diagnostics n = row_count;
  return n;
end $$;

-- Weekly job (service role): drop unlabelled devices unseen for 90 days.
create function prune_stale_devices() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from devices d
    where d.last_seen_at < now() - interval '90 days'
      and not exists (select 1 from device_labels l where l.device_id = d.id);
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function handle_new_user(), reset_expired_switch_periods(), prune_stale_devices() from public, anon, authenticated;
revoke execute on function switch_device_seat(uuid, int), reset_device_seat(int) from public, anon;
grant execute on function switch_device_seat(uuid, int), reset_device_seat(int) to authenticated;
