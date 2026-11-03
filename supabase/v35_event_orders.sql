-- Alpha ’28 · v35 · Line of authority for events and announcements.
-- Safe to run more than once. Paste all of it into Supabase > SQL Editor > Run. Run v21, v22, v29 and v34 first.
--
--   1. EVENT ORDER. The Mayor (President) issues an order for each event: which officers are assigned to scan, and a note.
--      Only the officers named in the order can scan that event. There is no backup: not the Mayor, not the Vice Mayor, unless the Mayor names them.
--      A new event cannot be scanned until the Mayor issues the order. Events that already existed keep working as before.
--      The Vice Mayor can still create an event; it waits for the Mayor's order.
--   2. OFFICIAL ANNOUNCEMENTS. The PIO drafts an announcement and sends it to the Mayor. Only the Mayor approves it.
--      Once approved it cannot be edited unless the Mayor returns it. The PIO then sends it as a notice (phone alert).
--      Nobody except the Mayor can post a notice directly any more, so every official announcement carries the Mayor's approval.
--   3. The database remembers who compiled the attendance.

-- ---------- 1. event orders ----------
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'v2_events' and column_name = 'ordered_at') then
    alter table public.v2_events
      add column ordered_at timestamptz, add column ordered_by_name text,
      add column order_note text check (order_note is null or char_length(order_note) <= 300),
      add column scanner_ids uuid[] not null default '{}', add column scanner_names text[] not null default '{}',
      add column legacy_open boolean not null default false;
    update public.v2_events set legacy_open = true;   -- events that existed before this step keep the old rule
  end if;
end $$;
alter table public.v2_events add column if not exists compiled_by_name text;

create or replace function public.v2_event_stamp() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_by_name := coalesce((select p.full_name from public.v2_profiles p where p.user_id = auth.uid()), new.created_by_name);
    new.ordered_at := null; new.ordered_by_name := null; new.order_note := null; new.scanner_ids := '{}'; new.scanner_names := '{}'; new.legacy_open := false; new.compiled_by_name := null;
  elsif coalesce(current_setting('app.eventorder', true), '') <> '1' then
    new.ordered_at := old.ordered_at; new.ordered_by_name := old.ordered_by_name; new.order_note := old.order_note;
    new.scanner_ids := old.scanner_ids; new.scanner_names := old.scanner_names; new.legacy_open := old.legacy_open;
  end if;
  if new.finalized_at is not null and (tg_op = 'INSERT' or old.finalized_at is null) then new.compiled_by_name := nullif(public.v2__who(), ''); end if;
  if tg_op = 'UPDATE' then new.compiled_by_name := coalesce(old.compiled_by_name, new.compiled_by_name); end if;
  if new.status = 'closed' and (tg_op = 'INSERT' or old.status <> 'closed') then new.closed_at := now(); end if;
  if new.status = 'open' then new.closed_at := null; end if;
  return new;
end $$;
drop trigger if exists v2_event_stamp on public.v2_events;
create trigger v2_event_stamp before insert or update on public.v2_events for each row execute function public.v2_event_stamp();

create or replace function public.v2_event_order(p_event uuid, p_scanners uuid[], p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.v2_events; ids uuid[]; names text[]; want int;
begin
  if public.v2_role() <> 'mayor' then raise exception 'Only the Mayor issues an event order'; end if;
  select * into e from public.v2_events where id = p_event for update;
  if e.id is null then raise exception 'Event not found'; end if;
  if e.status <> 'open' then raise exception 'This event is closed'; end if;
  select count(distinct x) into want from unnest(coalesce(p_scanners, '{}'::uuid[])) x;
  select coalesce(array_agg(p.user_id order by p.full_name), '{}'), coalesce(array_agg(p.full_name order by p.full_name), '{}') into ids, names
    from public.v2_profiles p where p.user_id = any (coalesce(p_scanners, '{}'::uuid[])) and p.role in ('mayor', 'vice_mayor', 'vp_internal', 'vp_external', 'secretary', 'marshall', 'sails');
  if coalesce(array_length(ids, 1), 0) = 0 then raise exception 'Name at least one officer to scan'; end if;
  if array_length(ids, 1) < want then raise exception 'One of the people you picked cannot scan'; end if;
  perform set_config('app.eventorder', '1', true);
  update public.v2_events set scanner_ids = ids, scanner_names = names, order_note = nullif(left(btrim(coalesce(p_note, '')), 300), ''), ordered_by_name = public.v2__who(), ordered_at = now(), legacy_open = false where id = p_event;
end $$;
revoke all on function public.v2_event_order(uuid, uuid[], text) from public, anon;
grant execute on function public.v2_event_order(uuid, uuid[], text) to authenticated;

create or replace function public.v2_event_scan_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare e public.v2_events;
begin
  select * into e from public.v2_events where id = new.event_id;
  if e.id is null or e.status <> 'open' then raise exception 'This event is closed'; end if;
  if auth.uid() is not null then
    if e.ordered_at is not null then
      if not (auth.uid() = any (e.scanner_ids)) then raise exception 'You are not assigned to scan this event. Only the officers named in the Mayor''s order can scan it.'; end if;
    elsif not e.legacy_open then raise exception 'The Mayor has not issued the order for this event yet'; end if;
  end if;
  new.scanned_by := auth.uid();
  new.scanned_by_name := coalesce((select p.full_name from public.v2_profiles p where p.user_id = auth.uid()), new.scanned_by_name);
  new.scanned_at := now();
  return new;
end $$;
drop trigger if exists v2_event_scan_guard on public.v2_event_scans;
create trigger v2_event_scan_guard before insert on public.v2_event_scans for each row execute function public.v2_event_scan_guard();

-- ---------- 2. official announcements ----------
create or replace function public.v2_post_authority() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r text := public.v2_role(); f jsonb := coalesce(new.flags, '{}'::jsonb); o jsonb := case when tg_op = 'UPDATE' then coalesce(old.flags, '{}'::jsonb) else '{}'::jsonb end;
begin
  if new.kind <> 'post' or auth.uid() is null then return new; end if;
  if coalesce(f ->> 'type', '') <> 'announcement' and coalesce(o ->> 'type', '') <> 'announcement' then return new; end if;
  if r = 'mayor' then
    if new.status = 'approved' and (tg_op = 'INSERT' or old.status <> 'approved') then f := (f - 'return_note') || jsonb_build_object('approved_by', public.v2__who(), 'approved_at', now());
    elsif new.status in ('draft', 'review') then f := f - 'approved_by' - 'approved_at'; end if;
    new.flags := f; return new;
  end if;
  -- the approval stamps and the Mayor's return note belong to the Mayor
  f := f - 'approved_by' - 'approved_at' - 'return_note';
  if o ? 'approved_by' then f := f || jsonb_build_object('approved_by', o -> 'approved_by', 'approved_at', o -> 'approved_at'); end if;
  if o ? 'return_note' then f := f || jsonb_build_object('return_note', o -> 'return_note'); end if;
  new.flags := f;
  if tg_op = 'INSERT' then
    if new.status in ('approved', 'published') then raise exception 'Only the Mayor approves an official announcement'; end if;
  else
    if new.status = 'approved' and old.status <> 'approved' then raise exception 'Only the Mayor approves an official announcement'; end if;
    if new.status = 'published' and old.status not in ('approved', 'published') then raise exception 'The Mayor must approve this announcement before it is posted'; end if;
    if old.status in ('approved', 'published') and new.status in ('draft', 'review') then raise exception 'Only the Mayor can take an approved announcement back'; end if;
    if old.status in ('approved', 'published') and (new.title is distinct from old.title or new.body is distinct from old.body or new.link is distinct from old.link or new.event_id is distinct from old.event_id) then
      raise exception 'An approved announcement cannot be edited. Ask the Mayor to return it to review first.'; end if;
  end if;
  return new;
end $$;
revoke all on function public.v2_post_authority() from public, anon;
drop trigger if exists v2_post_authority on public.v2_office_records;
create trigger v2_post_authority before insert or update on public.v2_office_records for each row execute function public.v2_post_authority();

-- the PIO turns an approved announcement into a notice with a phone alert
create or replace function public.v2_announce_post(p_post uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.v2_office_records; ev date; who text := public.v2__who();
begin
  if not public.v2_has_role('pio', 'mayor') then raise exception 'Only the PIO sends an announcement'; end if;
  select * into r from public.v2_office_records where id = p_post and kind = 'post' for update;
  if r.id is null or coalesce(r.flags ->> 'type', '') <> 'announcement' then raise exception 'Announcement not found'; end if;
  if r.status not in ('approved', 'published') or not (r.flags ? 'approved_by') then raise exception 'The Mayor must approve this announcement first'; end if;
  if coalesce(r.flags ->> 'notice', '') = 'true' then raise exception 'This announcement was already sent as a notice'; end if;
  if r.event_id is not null then select event_date into ev from public.v2_events where id = r.event_id; end if;
  insert into public.v2_announcements (title, body, expires_on, created_by_name)
    values (left(r.title, 120), left(coalesce(r.body, ''), 600), case when ev is not null and ev >= (now() at time zone 'Asia/Manila')::date then ev + 1 else null end, who);
  update public.v2_office_records set status = 'published', flags = r.flags || jsonb_build_object('notice', true) where id = r.id;
end $$;
revoke all on function public.v2_announce_post(uuid) from public, anon;
grant execute on function public.v2_announce_post(uuid) to authenticated;

-- notices are posted only by the Mayor directly; everyone else goes through an approved announcement (or the attendance report function)
drop policy if exists ann_write on public.v2_announcements;
drop policy if exists ann_write_ins on public.v2_announcements;
create policy ann_write_ins on public.v2_announcements for insert with check (public.v2_has_role('mayor'));
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'v2_announcements' and policyname = 'ann_write_upd') then
    create policy ann_write_upd on public.v2_announcements for update using (public.v2_has_role('mayor', 'vice_mayor', 'secretary', 'pio')) with check (public.v2_has_role('mayor', 'vice_mayor', 'secretary', 'pio'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'v2_announcements' and policyname = 'ann_write_del') then
    create policy ann_write_del on public.v2_announcements for delete using (public.v2_has_role('mayor', 'vice_mayor', 'secretary', 'pio'));
  end if;
end $$;
