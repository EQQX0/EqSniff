-- Share a tunnel or IP Storage with one named account.
-- recipient_id null = shared with every account (today's behaviour, unchanged).

alter table public.shared_items
  add column if not exists recipient_id uuid references auth.users(id) on delete cascade;
create index if not exists shared_items_recipient_idx on public.shared_items(recipient_id);

-- One share per owner, kind, name and recipient (null recipient counts as "everyone").
alter table public.shared_items drop constraint if exists shared_items_owner_id_kind_name_key;
create unique index if not exists shared_items_unique_everyone
  on public.shared_items(owner_id, kind, name) where recipient_id is null;
create unique index if not exists shared_items_unique_recipient
  on public.shared_items(owner_id, kind, name, recipient_id) where recipient_id is not null;

-- Read: public shares, your own, and ones addressed to you.
drop policy if exists "anyone signed in: select" on public.shared_items;
drop policy if exists "shared_items: select public or own or addressed" on public.shared_items;
create policy "shared_items: select public or own or addressed" on public.shared_items for select
  using (not is_caller_disabled() and (recipient_id is null or owner_id = (select auth.uid()) or recipient_id = (select auth.uid())));

-- Insert: recipient must be an existing, enabled account.
drop policy if exists "owner: insert" on public.shared_items;
create policy "owner: insert" on public.shared_items for insert
  with check (
    (select auth.uid()) = owner_id and not is_caller_disabled()
    and (recipient_id is null or exists (select 1 from public.profiles p where p.user_id = recipient_id and not p.disabled))
  );

-- Username lookup for the recipient picker (returns only id and username).
create or replace function public.find_user_by_username(u text)
returns table(user_id uuid, username text)
language sql security definer set search_path = public stable as $$
  select p.user_id, p.username from public.profiles p
  where lower(p.username) = lower(trim(u)) and not p.disabled and not is_caller_disabled() limit 1;
$$;
revoke all on function public.find_user_by_username(text) from public, anon;
grant execute on function public.find_user_by_username(text) to authenticated;
