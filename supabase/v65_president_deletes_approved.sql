-- v65: an approved, classified or posted record can only be deleted by the SAILS President (not the Mayor, not the Secretary).
-- Run once in the Supabase SQL editor. Safe to run again.

create or replace function public.v2_office_del_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.flow in ('approved', 'classified', 'published') and not public.v2_is_president() then
    raise exception 'An approved record can only be deleted by the SAILS President';
  end if;
  return old;
end $$;

-- The Trash step lets the SAILS President remove any kind of office record (the guard above still blocks everyone else on approved ones)
do $$ declare src text;
begin
  select pg_get_functiondef('public.v2_trash_remove(text,uuid)'::regprocedure) into src;
  if src not like '%v2_office_can(orr.kind) or public.v2_is_president()%' then
    src := replace(src, 'if not public.v2_office_can(orr.kind) then', 'if not (public.v2_office_can(orr.kind) or public.v2_is_president()) then');
    execute src;
  end if;
end $$;
