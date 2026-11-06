-- v42 · Calendar of Activities (COA). Replaces the Facebook "Bulletin" on the student screen with a live calendar.
-- Run v41 first (the trash bin). Safe to run twice.
--
-- How an activity gets on the calendar:
--   1. The Secretary writes it from the council minutes and links those minutes (draft).
--   2. The Secretary sends it to the President (proposed).
--   3. The SAILS President approves it (approved), or returns it with a note (returned). Only approved activities are public.
-- Who can change what:
--   Secretary  - add; edit and remove drafts and returned ones; send for approval. Cannot change an approved one.
--   President  - approve, return, cancel, bring back; edit or remove any activity, approved ones included; an activity the President adds is approved at once.
--   Everyone else on staff - read only. Students - read approved ones on their own screen.
-- Removing sends the activity to the Trash (restorable for 7 days).

create table if not exists public.v2_coa (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 3 and 120),
  details text check (details is null or char_length(details) <= 1000),
  category text not null default 'activity' check (category in ('activity', 'program', 'meeting', 'deadline', 'holiday')),
  starts_on date not null,
  ends_on date,
  time_note text check (time_note is null or char_length(time_note) <= 60),
  venue text check (venue is null or char_length(venue) <= 100),
  status text not null default 'draft' check (status in ('draft', 'proposed', 'returned', 'approved', 'cancelled')),
  minutes_id uuid references public.v2_office_records(id) on delete set null,
  minutes_title text,
  return_note text,
  created_by uuid default auth.uid(),
  created_by_name text,
  submitted_at timestamptz,
  approved_by_name text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on)
);
create index if not exists v2_coa_date_idx on public.v2_coa (starts_on);
alter table public.v2_coa enable row level security;
drop policy if exists coa_read on public.v2_coa;
create policy coa_read on public.v2_coa for select to authenticated using (public.v2_is_staff());
revoke all on public.v2_coa from anon;
grant select on public.v2_coa to authenticated;      -- no direct writes: everything goes through the functions below

-- phone alert helper (quiet if alerts are not set up)
create or replace function public.v2__coa_push(p_user uuid, p_title text, p_body text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_user is null then return; end if;
  begin perform public.v2__directive_push(p_user, p_title, p_body); exception when others then null; end;
end $$;
revoke all on function public.v2__coa_push(uuid, text, text) from public, anon, authenticated;

-- add or edit
drop function if exists public.v2_coa_save(uuid, text, text, text, date, date, text, text, uuid);
create or replace function public.v2_coa_save(p_id uuid, p_title text, p_details text, p_category text, p_starts date, p_ends date, p_time text, p_venue text, p_minutes uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare c public.v2_coa; mt text; rid uuid := p_id; mayor boolean := public.v2_has_role('mayor'); who text := public.v2__who();
begin
  if not public.v2_has_role('secretary', 'mayor') then raise exception 'Only the Secretary or the President can change the calendar'; end if;
  if p_starts is null then raise exception 'Pick the date'; end if;
  if p_ends is not null and p_ends < p_starts then raise exception 'The end date is before the start date'; end if;
  if p_minutes is not null then
    select title into mt from public.v2_office_records where id = p_minutes and kind = 'minutes';
    if mt is null then raise exception 'Pick minutes from the Minutes list'; end if;
  end if;
  if p_id is null then
    insert into public.v2_coa(title, details, category, starts_on, ends_on, time_note, venue, minutes_id, minutes_title, status, created_by_name, approved_by_name, approved_at)
    values (btrim(p_title), nullif(btrim(coalesce(p_details, '')), ''), coalesce(nullif(p_category, ''), 'activity'), p_starts, p_ends, nullif(btrim(coalesce(p_time, '')), ''), nullif(btrim(coalesce(p_venue, '')), ''),
            p_minutes, mt, case when mayor then 'approved' else 'draft' end, who, case when mayor then who end, case when mayor then now() end)
    returning id into rid;
  else
    select * into c from public.v2_coa where id = p_id for update;
    if c.id is null then raise exception 'Activity not found'; end if;
    if not mayor and c.status not in ('draft', 'returned') then raise exception 'Only the President can change an activity that was sent or approved'; end if;
    update public.v2_coa set title = btrim(p_title), details = nullif(btrim(coalesce(p_details, '')), ''), category = coalesce(nullif(p_category, ''), 'activity'), starts_on = p_starts, ends_on = p_ends,
      time_note = nullif(btrim(coalesce(p_time, '')), ''), venue = nullif(btrim(coalesce(p_venue, '')), ''), minutes_id = p_minutes, minutes_title = coalesce(mt, case when p_minutes is null then null else minutes_title end), updated_at = now()
    where id = p_id;
  end if;
  return rid;
end $$;

-- the Secretary sends it to the President (must be linked to council minutes)
create or replace function public.v2_coa_submit(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.v2_coa; m record;
begin
  if not public.v2_has_role('secretary', 'mayor') then raise exception 'Only the Secretary sends activities for approval'; end if;
  select * into c from public.v2_coa where id = p_id for update;
  if c.id is null then raise exception 'Activity not found'; end if;
  if c.status not in ('draft', 'returned') then raise exception 'It was already sent'; end if;
  if c.minutes_id is null then raise exception 'Link the council minutes where this was decided before sending it'; end if;
  update public.v2_coa set status = 'proposed', submitted_at = now(), return_note = null, updated_at = now() where id = p_id;
  for m in select user_id from public.v2_profiles where role = 'mayor' loop
    perform public.v2__coa_push(m.user_id, 'Activity waiting for your approval', c.title || ' · ' || to_char(c.starts_on, 'Mon FMDD'));
  end loop;
end $$;

-- the President decides: approve | return | cancel | reinstate
create or replace function public.v2_coa_decide(p_id uuid, p_action text, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.v2_coa; n text := nullif(btrim(coalesce(p_note, '')), ''); who text := public.v2__who(); owner uuid;
begin
  if not public.v2_has_role('mayor') then raise exception 'Only the President decides on the calendar'; end if;
  select * into c from public.v2_coa where id = p_id for update;
  if c.id is null then raise exception 'Activity not found'; end if;
  owner := c.created_by;
  if p_action = 'approve' then
    if c.status <> 'proposed' then raise exception 'It is not waiting for approval'; end if;
    update public.v2_coa set status = 'approved', approved_by_name = who, approved_at = now(), return_note = null, updated_at = now() where id = p_id;
    perform public.v2__coa_push(owner, 'Activity approved', c.title || ' is on the calendar.');
  elsif p_action = 'return' then
    if c.status <> 'proposed' then raise exception 'It is not waiting for approval'; end if;
    if n is null then raise exception 'Say what to fix'; end if;
    update public.v2_coa set status = 'returned', return_note = left(n, 300), updated_at = now() where id = p_id;
    perform public.v2__coa_push(owner, 'Activity returned', c.title || ' · ' || n);
  elsif p_action = 'cancel' then
    if c.status = 'cancelled' then raise exception 'Already cancelled'; end if;
    update public.v2_coa set status = 'cancelled', return_note = left(n, 300), updated_at = now() where id = p_id;
  elsif p_action = 'reinstate' then
    if c.status <> 'cancelled' then raise exception 'It is not cancelled'; end if;
    update public.v2_coa set status = 'approved', return_note = null, approved_by_name = who, approved_at = now(), updated_at = now() where id = p_id;
  else raise exception 'Unknown action'; end if;
end $$;

-- students and visitors: approved and cancelled activities from the last 90 days on
create or replace function public.v2_public_coa() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'details', details, 'category', category, 'starts_on', starts_on, 'ends_on', ends_on,
           'time_note', time_note, 'venue', venue, 'status', status) order by starts_on, created_at), '[]'::jsonb)
  from public.v2_coa where status in ('approved', 'cancelled') and coalesce(ends_on, starts_on) >= (now() at time zone 'Asia/Manila')::date - 90;
$$;
grant execute on function public.v2_public_coa() to anon, authenticated;

-- Trash bin: activities can be removed and restored too
alter table public.v2_trash drop constraint if exists v2_trash_source_check;
alter table public.v2_trash add constraint v2_trash_source_check check (source in ('record_request', 'office_record', 'coa'));

create or replace function public.v2_trash_remove(p_source text, p_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare tid uuid; rq public.v2_record_requests; orr public.v2_office_records; ca public.v2_coa; who text := public.v2__who();
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
  elsif p_source = 'coa' then
    select * into ca from public.v2_coa where id = p_id for update;
    if ca.id is null then raise exception 'Activity not found'; end if;
    if not public.v2_has_role('mayor') and ca.status not in ('draft', 'returned') then raise exception 'Only the President can remove an activity that was sent or approved'; end if;
    insert into public.v2_trash(source, source_id, title, subtitle, snapshot, removed_by, removed_by_name)
    values ('coa', ca.id, ca.title, 'Calendar · ' || ca.status || ' · ' || to_char(ca.starts_on, 'Mon FMDD'), to_jsonb(ca), auth.uid(), who) returning id into tid;
    delete from public.v2_coa where id = ca.id;
  else raise exception 'Unknown kind of record'; end if;
  return tid;
end $$;

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
    elsif t.source = 'coa' then
      if not public.v2_has_role('mayor') and (t.snapshot ->> 'status') not in ('draft', 'returned') then raise exception 'Only the President can restore an activity that was sent or approved'; end if;
      insert into public.v2_coa select * from jsonb_populate_record(null::public.v2_coa, t.snapshot);
    else
      if not public.v2_office_can(t.snapshot ->> 'kind') then raise exception 'You cannot restore this kind of record'; end if;
      insert into public.v2_office_records select * from jsonb_populate_record(null::public.v2_office_records, t.snapshot);
    end if;
  exception when foreign_key_violation then raise exception 'It cannot be restored because the student, event or minutes it belongs to no longer exist';
            when unique_violation then raise exception 'It is already back in the list';
  end;
  delete from public.v2_trash where id = t.id;
end $$;

revoke all on function public.v2_coa_save(uuid, text, text, text, date, date, text, text, uuid), public.v2_coa_submit(uuid), public.v2_coa_decide(uuid, text, text) from public, anon;
grant execute on function public.v2_coa_save(uuid, text, text, text, date, date, text, text, uuid), public.v2_coa_submit(uuid), public.v2_coa_decide(uuid, text, text) to authenticated;
