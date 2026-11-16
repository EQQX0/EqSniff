-- Accounts now need manual approval (disabled by default), and each account is locked to one
-- device at a time. Switching to a different device is allowed once every 30 days on its own;
-- an admin can reset the lock at any time to allow it sooner.

-- New signups start disabled; an admin has to flip them on. Existing accounts keep their current value.
alter table public.profiles alter column disabled set default true;

alter table public.profiles add column if not exists active_device text;
alter table public.profiles add column if not exists device_changed_at timestamptz;

-- Admin resets the device lock (same "admin: update any profile" policy already covers these columns).
