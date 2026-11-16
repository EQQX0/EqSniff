-- Admins can publish "global" filters that every signed-in user gets by default. A user can turn one off
-- for themselves without changing it for anyone else, and that choice survives future syncs.

alter table public.profiles add column if not exists is_admin boolean not null default false;

create table if not exists public.global_filters (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) >= 1 and char_length(name) <= 64),
  body       text not null default '' check (char_length(body) <= 20000),
  enabled    boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  deleted    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.global_filters enable row level security;

-- Every signed-in user reads the list (including deleted rows, so a client can drop one it had cached).
create policy "global filters: select" on public.global_filters for select to authenticated using (true);

-- Only an admin may publish, edit or retire a global filter.
create policy "global filters: admin write" on public.global_filters for all to authenticated
  using ((select is_admin from public.profiles where user_id = (select auth.uid())))
  with check ((select is_admin from public.profiles where user_id = (select auth.uid())));

-- One row per (user, global filter) that a user has turned off for themselves. No row means "on" (the default).
create table if not exists public.global_filter_overrides (
  user_id    uuid not null references auth.users (id) on delete cascade,
  filter_id  uuid not null references public.global_filters (id) on delete cascade,
  enabled    boolean not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, filter_id)
);

alter table public.global_filter_overrides enable row level security;

create policy "global filter overrides: own row" on public.global_filter_overrides for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Mark the one existing account (EQQX2) as admin.
update public.profiles set is_admin = true where username = 'EQQX2';
