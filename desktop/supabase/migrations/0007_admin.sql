-- Admin panel: see every account, disable one, and remove anyone's shared items.
-- "Disabled" is enforced here, in RLS, not just in the client: a disabled account's own
-- requests for its data are rejected by the database, not merely hidden by the app.

alter table public.profiles add column if not exists disabled boolean not null default false;

-- True if the signed-in caller's own profile is marked disabled. Runs under the caller's
-- own RLS (the "own profile: select" policy already lets everyone read their own row).
create or replace function public.is_caller_disabled() returns boolean
language sql stable set search_path = '' as $$
  select coalesce((select disabled from public.profiles where user_id = (select auth.uid())), false);
$$;

-- True if the signed-in caller's own profile is marked admin.
create or replace function public.is_caller_admin() returns boolean
language sql stable set search_path = '' as $$
  select coalesce((select is_admin from public.profiles where user_id = (select auth.uid())), false);
$$;

-- Admin reads every profile (the list the panel shows); a non-admin still only sees their own row.
create policy "admin: select all profiles" on public.profiles for select to authenticated
  using (public.is_caller_admin());

-- Admin sets is_admin / disabled on any account, including their own.
create policy "admin: update any profile" on public.profiles for update to authenticated
  using (public.is_caller_admin())
  with check (public.is_caller_admin());

-- Admin removes anyone's shared tunnel, filter, or IP Storage share, not only their own.
create policy "admin: delete any shared item" on public.shared_items for delete to authenticated
  using (public.is_caller_admin());

-- A disabled account can still read its own profile row (so the app can show why it was signed out),
-- but every other read/write it makes is rejected at the database, regardless of which client it uses.
alter policy "own rows: select" on public.ip_entries using ((select auth.uid()) = user_id and not public.is_caller_disabled());
alter policy "own rows: insert" on public.ip_entries with check ((select auth.uid()) = user_id and not public.is_caller_disabled());
alter policy "own rows: update" on public.ip_entries using ((select auth.uid()) = user_id and not public.is_caller_disabled()) with check ((select auth.uid()) = user_id and not public.is_caller_disabled());
alter policy "own rows: delete" on public.ip_entries using ((select auth.uid()) = user_id and not public.is_caller_disabled());

alter policy "own rows: select" on public.sync_items using ((select auth.uid()) = user_id and not public.is_caller_disabled());
alter policy "own rows: insert" on public.sync_items with check ((select auth.uid()) = user_id and not public.is_caller_disabled());
alter policy "own rows: update" on public.sync_items using ((select auth.uid()) = user_id and not public.is_caller_disabled()) with check ((select auth.uid()) = user_id and not public.is_caller_disabled());
alter policy "own rows: delete" on public.sync_items using ((select auth.uid()) = user_id and not public.is_caller_disabled());

alter policy "owner: insert" on public.shared_items with check ((select auth.uid()) = owner_id and not public.is_caller_disabled());
alter policy "owner: update" on public.shared_items using ((select auth.uid()) = owner_id and not public.is_caller_disabled()) with check ((select auth.uid()) = owner_id and not public.is_caller_disabled());

alter policy "global filter overrides: own row" on public.global_filter_overrides using ((select auth.uid()) = user_id and not public.is_caller_disabled()) with check ((select auth.uid()) = user_id and not public.is_caller_disabled());

-- Reading the shared library or the global filter list also requires not being disabled.
alter policy "anyone signed in: select" on public.shared_items using (not public.is_caller_disabled());
alter policy "global filters: select" on public.global_filters using (not public.is_caller_disabled());
