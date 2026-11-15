-- EqNetwork IP Storage sync. One row per saved address, private to the signed-in account.

create table if not exists public.ip_entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  address     text not null check (char_length(address) between 1 and 100),
  label       text not null default '' check (char_length(label) <= 500),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, address)
);

create index if not exists ip_entries_user_idx on public.ip_entries (user_id);

alter table public.ip_entries enable row level security;

-- Each account sees and changes only its own rows. Signed-out requests get nothing.
create policy "own rows: select" on public.ip_entries for select to authenticated using ((select auth.uid()) = user_id);
create policy "own rows: insert" on public.ip_entries for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own rows: update" on public.ip_entries for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own rows: delete" on public.ip_entries for delete to authenticated using ((select auth.uid()) = user_id);

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger ip_entries_touch before update on public.ip_entries
for each row execute function public.touch_updated_at();
