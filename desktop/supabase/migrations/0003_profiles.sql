-- Usernames. The account function (service role) reads and writes this table; signed-in users can read their own row.
create table if not exists public.profiles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  username   text not null check (username ~ '^[A-Za-z0-9_.-]{3,24}$'),
  created_at timestamptz not null default now()
);

create unique index if not exists profiles_username_lower on public.profiles (lower(username));

alter table public.profiles enable row level security;

create policy "own profile: select" on public.profiles for select to authenticated using ((select auth.uid()) = user_id);
