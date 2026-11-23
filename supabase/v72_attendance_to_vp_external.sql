-- v72: Attendance monitoring and event reports belong to the SAILS VP External, and nobody can go around it.
--  * Only the VP External creates, closes and deletes events, names who scans, compiles the absences (flags them) and sends the fines report.
--  * Scanning waits for the VP External: nobody scans until the order names them. Not even a Class Mayor or a Class Secretary.
--  * Absences cannot be flagged by any other route (no direct violation with an event, no direct edit of the compiled / report fields).
--  * The SAILS Secretary sees an event's attendance only after the VP External has sent the report.
-- Run once in the Supabase SQL editor. Safe to run again.

-- 1. The four event functions
create or replace function public.v2_event_order(p_event uuid, p_scanners uuid[], p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare e public.v2_events; ids uuid[]; names text[]; want int;
begin
  if public.v2_role() is distinct from 'vp_external' then raise exception 'Only the SAILS VP External sets the scanners for an event'; end if;
  select * into e from public.v2_events where id = p_event for update;
  if e.id is null then raise exception 'Event not found'; end if;
  if e.status <> 'open' then raise exception 'This event is closed'; end if;
  select count(distinct x) into want from unnest(coalesce(p_scanners, '{}'::uuid[])) x;
  select coalesce(array_agg(p.user_id order by p.full_name), '{}'), coalesce(array_agg(p.full_name order by p.full_name), '{}') into ids, names
    from public.v2_profiles p where p.user_id = any (coalesce(p_scanners, '{}'::uuid[]))
      and p.role in ('mayor', 'vp_internal', 'vp_external', 'class_secretary', 'general_marshal', 'marshall', 'sails');
  if coalesce(array_length(ids, 1), 0) = 0 then raise exception 'Name at least one officer to scan'; end if;
  if array_length(ids, 1) < want then raise exception 'One of the people you picked cannot scan'; end if;
  perform set_config('app.eventorder', '1', true);
  update public.v2_events set scanner_ids = ids, scanner_names = names, order_note = nullif(left(btrim(coalesce(p_note, '')), 300), ''),
    ordered_by_name = public.v2__who(), ordered_at = now(), legacy_open = false where id = p_event;
end $$;

create or replace function public.v2_event_compile(p_event uuid, p_members uuid[])
returns integer language plpgsql security definer set search_path = '' as $$
declare e public.v2_events; who text; n int;
begin
  if public.v2_role() is distinct from 'vp_external' then raise exception 'Only the SAILS VP External can compile attendance'; end if;
  select * into e from public.v2_events where id = p_event for update;
  if not found then raise exception 'Event not found'; end if;
  if e.finalized_at is not null then raise exception 'Attendance for this event is already compiled'; end if;
  if e.standard_id is null and coalesce(array_length(p_members, 1), 0) > 0 then raise exception 'This event has no standard to record absences under'; end if;
  perform set_config('app.eventflow', '1', true); perform set_config('app.eventcompile', '1', true);
  select coalesce(full_name, '') into who from public.v2_profiles where user_id = auth.uid();
  insert into public.v2_violations (member_id, standard_id, occurred_on, reported_by, status, event_id)
    select m.id, e.standard_id, e.event_date, 'VP External ' || who || ' · ' || e.title, 'pending', e.id
    from public.v2_members m
    where m.id = any (p_members) and m.status = 'active' and m.unit_id = e.unit_id
      and (not exists (select 1 from public.v2_event_scans s where s.event_id = e.id and s.member_id = m.id and s.kind = 'in')
        or (e.needs_out and not exists (select 1 from public.v2_event_scans s where s.event_id = e.id and s.member_id = m.id and s.kind = 'out')));
  get diagnostics n = row_count;
  update public.v2_events set status = 'closed', closed_at = coalesce(closed_at, now()), finalized_at = now() where id = e.id;
  return n;
end $$;

create or replace function public.v2_event_send_report(p_event uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare e public.v2_events; who text;
begin
  if public.v2_role() is distinct from 'vp_external' then raise exception 'Only the SAILS VP External can send the report'; end if;
  select * into e from public.v2_events where id = p_event for update;
  if not found then raise exception 'Event not found'; end if;
  if e.finalized_at is null then raise exception 'Compile the attendance first'; end if;
  perform set_config('app.eventflow', '1', true);
  select coalesce(full_name, '') into who from public.v2_profiles where user_id = auth.uid();
  update public.v2_events set report_sent_at = now(), report_by_name = who, report_note = nullif(left(trim(coalesce(p_note, '')), 500), '') where id = e.id;
end $$;

create or replace function public.v2_event_notify(p_event uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare e public.v2_events; who text; n int;
begin
  if not public.v2_has_role('mayor', 'pio') then raise exception 'Only the PIO or Mayor can send the report to students'; end if;
  select * into e from public.v2_events where id = p_event for update;
  if not found then raise exception 'Event not found'; end if;
  if e.report_sent_at is null then raise exception 'The SAILS VP External has not sent the report yet'; end if;
  if e.notified_at is not null then raise exception 'Students were already notified'; end if;
  perform set_config('app.eventflow', '1', true);
  select coalesce(full_name, '') into who from public.v2_profiles where user_id = auth.uid();
  select count(*) into n from public.v2_violations where event_id = e.id and status <> 'rejected';
  insert into public.v2_announcements (title, body, expires_on, created_by_name)
    values ('Attendance report: ' || e.title, n || ' student' || case when n = 1 then '' else 's' end || ' did not log in' || case when e.needs_out then ' or out' else '' end
      || '. Open your card to see your own fine and pay it to the Treasurer.', e.event_date + 14, who);
  update public.v2_events set notified_at = now(), notified_by_name = who where id = e.id;
end $$;

-- 2. Scanning waits for the VP External's order, and only for students of the event's own section
create or replace function public.v2_event_scan_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare e public.v2_events; mu uuid;
begin
  select * into e from public.v2_events where id = new.event_id;
  if e.id is null or e.status <> 'open' then raise exception 'This event is closed'; end if;
  if auth.uid() is not null then
    if e.ordered_at is null then raise exception 'Scanning has not been activated yet. The SAILS VP External names who scans first.'; end if;
    if not (auth.uid() = any (e.scanner_ids)) then raise exception 'You are not assigned to scan this event. Only the officers named by the SAILS VP External can scan it.'; end if;
    select unit_id into mu from public.v2_members where id = new.member_id;
    if mu is distinct from e.unit_id then raise exception 'This student is not in the section of this event'; end if;
  end if;
  new.scanned_by := auth.uid();
  new.scanned_by_name := coalesce((select p.full_name from public.v2_profiles p where p.user_id = auth.uid()), new.scanned_by_name);
  new.scanned_at := now();
  return new;
end $$;

-- a scan cannot be taken back after the attendance is compiled (except by the VP External)
create or replace function public.v2_event_scan_del_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare e public.v2_events;
begin
  if auth.uid() is not null and public.v2_role() is distinct from 'vp_external' then
    select * into e from public.v2_events where id = old.event_id;
    if e.finalized_at is not null then raise exception 'Attendance for this event is already compiled'; end if;
  end if;
  return old;
end $$;
drop trigger if exists v2_event_scan_del_guard on public.v2_event_scans;
create trigger v2_event_scan_del_guard before delete on public.v2_event_scans for each row execute function public.v2_event_scan_del_guard();

-- 3. The compiled / report fields change only through the functions above
create or replace function public.v2_event_flow_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and coalesce(current_setting('app.eventflow', true), '') <> '1' then
    if tg_op = 'INSERT' then
      new.finalized_at := null; new.compiled_by_name := null; new.report_sent_at := null; new.report_by_name := null; new.report_note := null; new.notified_at := null; new.notified_by_name := null;
    else
      new.finalized_at := old.finalized_at; new.compiled_by_name := old.compiled_by_name; new.report_sent_at := old.report_sent_at; new.report_by_name := old.report_by_name;
      new.report_note := old.report_note; new.notified_at := old.notified_at; new.notified_by_name := old.notified_by_name;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists v2_event_zflow on public.v2_events;
create trigger v2_event_zflow before insert or update on public.v2_events for each row execute function public.v2_event_flow_guard();

-- 4. An absence from an event is flagged only by compiling (no direct violation with an event, no moving one onto an event)
create or replace function public.v2__violation_event_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and coalesce(current_setting('app.eventcompile', true), '') <> '1' then
    if tg_op = 'INSERT' and new.event_id is not null then raise exception 'Absences from an event are flagged only by the SAILS VP External when compiling attendance'; end if;
    if tg_op = 'UPDATE' and new.event_id is distinct from old.event_id then raise exception 'An absence cannot be moved to another event'; end if;
  end if;
  return new;
end $$;
drop trigger if exists v2_violation_event_guard on public.v2_violations;
create trigger v2_violation_event_guard before insert or update on public.v2_violations for each row execute function public.v2__violation_event_guard();

-- 5. Who can touch events and scans
alter policy events_write on public.v2_events
  using (public.v2_has_role(variadic array['vp_external']) and public.v2__unit_ok(unit_id))
  with check (public.v2_has_role(variadic array['vp_external']) and public.v2__unit_ok(unit_id));
alter policy events_read on public.v2_events
  using (public.v2_is_staff() and public.v2__unit_ok(unit_id)
    and (coalesce(public.v2_role(), '') <> 'secretary' or report_sent_at is not null)
    and (coalesce(public.v2_role(), '') not in ('class_secretary', 'marshall', 'sails') or ordered_at is not null));
alter policy escans_read on public.v2_event_scans
  using (public.v2_is_staff() and coalesce(public.v2_role(), '') <> 'secretary'
    and public.v2__unit_ok((select e.unit_id from public.v2_events e where e.id = event_id)));
alter policy escans_insert on public.v2_event_scans
  with check ((public.v2_has_role(variadic array['mayor', 'vp_external', 'marshall', 'sails']) or public.v2_role() = 'class_secretary')
    and public.v2__unit_ok((select e.unit_id from public.v2_events e where e.id = event_id)));
alter policy escans_delete on public.v2_event_scans
  using ((public.v2_has_role(variadic array['vp_external'])
          or (scanned_by = auth.uid() and (public.v2_has_role(variadic array['marshall', 'sails']) or public.v2_role() = 'class_secretary')))
    and public.v2__unit_ok((select e.unit_id from public.v2_events e where e.id = event_id)));
-- the SAILS Secretary does not write violations, and sees an event's fines only after the report is sent
alter policy violations_write_ins on public.v2_violations
  with check (public.v2_has_role(variadic array['mayor', 'vice_mayor', 'marshall', 'sails']) and public.v2__unit_ok(unit_id));
alter policy violations_write_upd on public.v2_violations
  using (public.v2_has_role(variadic array['mayor', 'vice_mayor', 'marshall', 'sails']) and public.v2__unit_ok(unit_id))
  with check (public.v2_has_role(variadic array['mayor', 'vice_mayor', 'marshall', 'sails']) and public.v2__unit_ok(unit_id));
alter policy violations_write_del on public.v2_violations
  using (public.v2_has_role(variadic array['mayor', 'vice_mayor', 'marshall', 'sails']) and public.v2__unit_ok(unit_id));
alter policy violations_read on public.v2_violations
  using (public.v2_is_staff() and public.v2__unit_ok(unit_id)
    and (coalesce(public.v2_role(), '') <> 'secretary' or event_id is null
         or exists (select 1 from public.v2_events e where e.id = event_id and e.report_sent_at is not null)));

-- tables are not for truncating or re-wiring from the API roles
revoke truncate, references, trigger on public.v2_events, public.v2_event_scans, public.v2_violations from anon, authenticated;

do $do$ declare src text;
begin
  select pg_get_functiondef('public.v2_schema_marks()'::regprocedure) into src;
  if src not like '%''v72''%' then
    src := replace(src, E'  return mk;', E'  mk := mk || jsonb_build_object(''v72'', to_regprocedure(''public.v2_event_flow_guard()'') is not null);\n  return mk;');
    execute src;
  end if;
end $do$;
