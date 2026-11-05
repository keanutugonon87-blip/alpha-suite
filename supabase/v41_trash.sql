-- v41 · Trash bin. "Remove" moves a record to the trash instead of deleting it. It can be restored for 7 days, then it is deleted for good.
-- Covers the Secretary's member requests and office records (minutes, resolutions, letters). Built so other lists can be added later.
-- The Secretary and the Mayor can remove, restore and empty. Safe to run twice.

create table if not exists public.v2_trash (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('record_request', 'office_record')),
  source_id uuid not null,
  title text not null,
  subtitle text,
  snapshot jsonb not null,                       -- the whole record, so it can be put back exactly as it was
  removed_by uuid,
  removed_by_name text,
  removed_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days')
);
create index if not exists v2_trash_expires_idx on public.v2_trash (expires_at);
alter table public.v2_trash enable row level security;
drop policy if exists trash_read on public.v2_trash;
create policy trash_read on public.v2_trash for select to authenticated using (public.v2_has_role('secretary', 'mayor'));
revoke all on public.v2_trash from anon;
grant select on public.v2_trash to authenticated;     -- no direct writes: everything goes through the functions below

-- delete what has been in the trash more than 7 days
create or replace function public.v2_trash_purge() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  delete from public.v2_trash where expires_at <= now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.v2_trash_purge() from public, anon, authenticated;

-- remove: move a record to the trash
create or replace function public.v2_trash_remove(p_source text, p_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare tid uuid; rq public.v2_record_requests; orr public.v2_office_records; who text := public.v2__who();
begin
  if not public.v2_has_role('secretary', 'mayor') then raise exception 'Only the Secretary or the Mayor can remove records'; end if;
  perform public.v2_trash_purge();
  if p_source = 'record_request' then
    select * into rq from public.v2_record_requests where id = p_id for update;
    if rq.id is null then raise exception 'Request not found'; end if;
    insert into public.v2_trash(source, source_id, title, subtitle, snapshot, removed_by, removed_by_name)
    values ('record_request', rq.id, rq.title, rq.requester_name || ' · ' || rq.status, to_jsonb(rq), auth.uid(), who) returning id into tid;
    delete from public.v2_record_requests where id = rq.id;
  elsif p_source = 'office_record' then
    select * into orr from public.v2_office_records where id = p_id for update;
    if orr.id is null then raise exception 'Record not found'; end if;
    if not public.v2_office_can(orr.kind) then raise exception 'You cannot remove this kind of record'; end if;
    insert into public.v2_trash(source, source_id, title, subtitle, snapshot, removed_by, removed_by_name)
    values ('office_record', orr.id, orr.title, orr.kind, to_jsonb(orr), auth.uid(), who) returning id into tid;
    delete from public.v2_office_records where id = orr.id;
  else raise exception 'Unknown kind of record'; end if;
  return tid;
end $$;

-- restore: put it back exactly as it was (only within the 7 days)
create or replace function public.v2_trash_restore(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.v2_trash;
begin
  if not public.v2_has_role('secretary', 'mayor') then raise exception 'Only the Secretary or the Mayor can restore records'; end if;
  select * into t from public.v2_trash where id = p_id for update;
  if t.id is null or t.expires_at <= now() then perform public.v2_trash_purge(); raise exception 'This item is no longer in the trash'; end if;
  begin
    if t.source = 'record_request' then
      insert into public.v2_record_requests select * from jsonb_populate_record(null::public.v2_record_requests, t.snapshot);
    else
      if not public.v2_office_can(t.snapshot ->> 'kind') then raise exception 'You cannot restore this kind of record'; end if;
      insert into public.v2_office_records select * from jsonb_populate_record(null::public.v2_office_records, t.snapshot);
    end if;
  exception when foreign_key_violation then raise exception 'It cannot be restored because the student or event it belongs to no longer exists';
            when unique_violation then raise exception 'It is already back in the list';
  end;
  delete from public.v2_trash where id = t.id;
end $$;

-- delete forever now (before the 7 days are up)
create or replace function public.v2_trash_delete(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.v2_has_role('secretary', 'mayor') then raise exception 'Only the Secretary or the Mayor can empty the trash'; end if;
  delete from public.v2_trash where id = p_id;
end $$;

revoke all on function public.v2_trash_remove(text, uuid), public.v2_trash_restore(uuid), public.v2_trash_delete(uuid) from public, anon;
grant execute on function public.v2_trash_remove(text, uuid), public.v2_trash_restore(uuid), public.v2_trash_delete(uuid) to authenticated;

-- every hour, delete what is past 7 days
do $$ begin perform cron.unschedule('alpha28-trash-purge'); exception when others then null; end $$;
select cron.schedule('alpha28-trash-purge', '17 * * * *', $c$select public.v2_trash_purge()$c$);

-- the sample request ("Minutes", Keanu Tugonon) goes to the trash so you can still get it back for 7 days
insert into public.v2_trash(source, source_id, title, subtitle, snapshot, removed_by_name)
select 'record_request', r.id, r.title, r.requester_name || ' · ' || r.status, to_jsonb(r), 'System (sample removed)'
from public.v2_record_requests r where r.id = 'e986259c-8295-420a-b79f-d4c34f5d34cc'
  and not exists (select 1 from public.v2_trash t where t.source_id = r.id);
delete from public.v2_record_requests where id = 'e986259c-8295-420a-b79f-d4c34f5d34cc';
