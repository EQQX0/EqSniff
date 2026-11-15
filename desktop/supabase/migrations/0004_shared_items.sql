-- A shared library: tunnels and filters an account chose to share with every signed-in account.
-- Everyone signed in can read; only the owner can add, change or remove their own rows.
-- IP entries were added later (0005).
create table if not exists public.shared_items (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  owner_name text not null default '' check (char_length(owner_name) <= 24),
  kind       text not null check (kind in ('tunnel', 'filter', 'ip')),
  name       text not null check (char_length(name) between 1 and 64),
  body       text not null default '' check (char_length(body) <= 20000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, kind, name)
);

create index if not exists shared_items_owner_idx on public.shared_items (owner_id);

alter table public.shared_items enable row level security;

create policy "anyone signed in: select" on public.shared_items for select to authenticated using (true);
create policy "owner: insert" on public.shared_items for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "owner: update" on public.shared_items for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "owner: delete" on public.shared_items for delete to authenticated using ((select auth.uid()) = owner_id);

create trigger shared_items_touch before update on public.shared_items
for each row execute function public.touch_updated_at();
