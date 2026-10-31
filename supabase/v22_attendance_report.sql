-- Alpha ’28 · v22 · Attendance workflow: President sets the event, Marshals scan, Secretary compiles, officers get the fines report, PIO tells the students.
-- Run v19, v20 and v21 first. Safe to run more than once. Paste all of it into Supabase > SQL Editor > Run.
--
--   1. Only the Mayor (the President) creates, edits, closes or deletes events.
--   2. The Marshals (and other scanning officers) scan. The Secretary compiles who was missed (excused students are unticked),
--      which records the absences as violations linked to the event, then submits the fines report to the Mayor, Vice Mayor, Marshals and Treasurer.
--   3. The PIO sends the report to the students: a notice goes out and every student sees their own fine on their card.

alter table public.v2_events
  add column if not exists report_sent_at timestamptz,
  add column if not exists report_by_name text,
  add column if not exists report_note text,
  add column if not exists notified_at timestamptz,
  add column if not exists notified_by_name text;
alter table public.v2_violations add column if not exists event_id uuid references public.v2_events(id) on delete set null;
create index if not exists v2_violations_event_idx on public.v2_violations (event_id);

drop policy if exists events_write on public.v2_events;
create policy events_write on public.v2_events for all to authenticated
  using (public.v2_has_role('mayor')) with check (public.v2_has_role('mayor'));
drop policy if exists escans_delete on public.v2_event_scans;
create policy escans_delete on public.v2_event_scans for delete to authenticated
  using (public.v2_has_role('mayor') or (scanned_by = auth.uid() and public.v2_has_role('vice_mayor', 'secretary', 'marshall', 'sails')));

-- Secretary: record the absences of the students who were not scanned. p_members is the list she left ticked.
create or replace function public.v2_event_compile(p_event uuid, p_members uuid[])
returns int language plpgsql security definer set search_path = '' as $$
declare e public.v2_events; who text; n int;
begin
  if not public.v2_has_role('mayor', 'secretary') then raise exception 'Only the Secretary or Mayor can compile attendance'; end if;
  select * into e from public.v2_events where id = p_event for update;
  if not found then raise exception 'Event not found'; end if;
  if e.finalized_at is not null then raise exception 'Attendance for this event is already compiled'; end if;
  if e.standard_id is null and coalesce(array_length(p_members, 1), 0) > 0 then raise exception 'This event has no standard to record absences under'; end if;
  select coalesce(full_name, '') into who from public.v2_profiles where user_id = auth.uid();
  insert into public.v2_violations (member_id, standard_id, occurred_on, reported_by, status, event_id)
    select m.id, e.standard_id, e.event_date, 'Secretary ' || who || ' · ' || e.title, 'pending', e.id
    from public.v2_members m
    where m.id = any (p_members) and m.status = 'active'
      and (not exists (select 1 from public.v2_event_scans s where s.event_id = e.id and s.member_id = m.id and s.kind = 'in')
        or (e.needs_out and not exists (select 1 from public.v2_event_scans s where s.event_id = e.id and s.member_id = m.id and s.kind = 'out')));
  get diagnostics n = row_count;
  update public.v2_events set status = 'closed', closed_at = coalesce(closed_at, now()), finalized_at = now() where id = e.id;
  return n;
end $$;

-- Secretary: send the fines report to the officers who collect.
create or replace function public.v2_event_send_report(p_event uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare e public.v2_events; who text;
begin
  if not public.v2_has_role('mayor', 'secretary') then raise exception 'Only the Secretary or Mayor can send the report'; end if;
  select * into e from public.v2_events where id = p_event for update;
  if not found then raise exception 'Event not found'; end if;
  if e.finalized_at is null then raise exception 'Compile the attendance first'; end if;
  select coalesce(full_name, '') into who from public.v2_profiles where user_id = auth.uid();
  update public.v2_events set report_sent_at = now(), report_by_name = who, report_note = nullif(left(trim(coalesce(p_note, '')), 500), '') where id = e.id;
end $$;

-- PIO: tell the students. Posts a notice (which also sends the phone alert) and marks the report as sent to students.
create or replace function public.v2_event_notify(p_event uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare e public.v2_events; who text; n int;
begin
  if not public.v2_has_role('mayor', 'pio') then raise exception 'Only the PIO or Mayor can send the report to students'; end if;
  select * into e from public.v2_events where id = p_event for update;
  if not found then raise exception 'Event not found'; end if;
  if e.report_sent_at is null then raise exception 'The Secretary has not sent the report yet'; end if;
  if e.notified_at is not null then raise exception 'Students were already notified'; end if;
  select coalesce(full_name, '') into who from public.v2_profiles where user_id = auth.uid();
  select count(*) into n from public.v2_violations where event_id = e.id and status <> 'rejected';
  insert into public.v2_announcements (title, body, expires_on, created_by_name)
    values ('Attendance report: ' || e.title, n || ' student' || case when n = 1 then '' else 's' end || ' did not log in' || case when e.needs_out then ' or out' else '' end
      || '. Open your card to see your own fine and pay it to the Treasurer.', e.event_date + 14, who);
  update public.v2_events set notified_at = now(), notified_by_name = who where id = e.id;
end $$;

revoke all on function public.v2_event_compile(uuid, uuid[]), public.v2_event_send_report(uuid, text), public.v2_event_notify(uuid) from public, anon;
grant execute on function public.v2_event_compile(uuid, uuid[]), public.v2_event_send_report(uuid, text), public.v2_event_notify(uuid) to authenticated;
