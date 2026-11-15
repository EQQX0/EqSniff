-- IP Storage entries can now be shared too, one address at a time, by the owner's choice.
alter table public.shared_items drop constraint if exists shared_items_kind_check;
alter table public.shared_items add constraint shared_items_kind_check check (kind in ('tunnel', 'filter', 'ip'));
