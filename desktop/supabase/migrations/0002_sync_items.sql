-- Soft deletes, so a deletion on one computer reaches the others instead of being undone by them.
alter table public.ip_entries add column if not exists deleted boolean not null default false;

-- VPN tunnels (sealed on the PC with a passphrase, the server cannot read them) and the filter list.
create table if not exists public.sync_items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('tunnel', 'filters')),
  name        text not null check (char_length(name) between 1 and 64),
  fingerprint text not null default '' check (char_length(fingerprint) <= 64),
  body        text not null default '' check (char_length(body) <= 60000),
  deleted     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, kind, name)
);

create index if not exists sync_items_user_idx on public.sync_items (user_id);

alter table public.sync_items enable row level security;

create policy "own rows: select" on public.sync_items for select to authenticated using ((select auth.uid()) = user_id);
create policy "own rows: insert" on public.sync_items for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own rows: update" on public.sync_items for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own rows: delete" on public.sync_items for delete to authenticated using ((select auth.uid()) = user_id);

create trigger sync_items_touch before update on public.sync_items
for each row execute function public.touch_updated_at();
