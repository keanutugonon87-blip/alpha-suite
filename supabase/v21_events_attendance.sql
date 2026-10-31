-- Alpha ’28 · v21 · Events and attendance: the President sets an event, the Marshals and other officers scan and confirm attendance.
-- Run v19 and v20 first. Safe to run more than once. Paste all of it into Supabase > SQL Editor > Run.
--
--   • An event has a title, a date, a type (flag ceremony, inspection or other event), whether students must also log out, and the standard
--     (with its fine) that absences are recorded under.
--   • Only the Mayor and Vice Mayor create, edit, close or delete events and record the absences.
--   • The Mayor, Vice Mayor, Secretary, Marshal and SAILS officer can scan students in and out of an open event. A student can be scanned once per
--     direction, so a double scan is refused.
--   • Nothing is fined by scanning. The Mayor or Vice Mayor reviews who was missed, unticks anyone excused, and records the absences as violations.

create table if not exists public.v2_events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 2 and 80),
  event_date date not null default ((now() at time zone 'Asia/Manila')::date),
  kind text not null default 'event' check (kind in ('flag', 'inspection', 'event')),
  needs_out boolean not null default false,
  standard_id uuid references public.v2_standards(id) on delete set null,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_by uuid default auth.uid(),
  created_by_name text,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  finalized_at timestamptz
);
create index if not exists v2_events_date_idx on public.v2_events (event_date desc);

create table if not exists public.v2_event_scans (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.v2_events(id) on delete cascade,
  member_id uuid not null references public.v2_members(id) on delete cascade,
  kind text not null check (kind in ('in', 'out')),
  scanned_at timestamptz not null default now(),
  scanned_by uuid default auth.uid(),
  scanned_by_name text,
  unique (event_id, member_id, kind)
);
create index if not exists v2_event_scans_event_idx on public.v2_event_scans (event_id);

alter table public.v2_events enable row level security;
alter table public.v2_event_scans enable row level security;

drop policy if exists events_read on public.v2_events;
create policy events_read on public.v2_events for select to authenticated using (public.v2_is_staff());
drop policy if exists events_write on public.v2_events;
create policy events_write on public.v2_events for all to authenticated
  using (public.v2_has_role('mayor', 'vice_mayor')) with check (public.v2_has_role('mayor', 'vice_mayor'));

drop policy if exists escans_read on public.v2_event_scans;
create policy escans_read on public.v2_event_scans for select to authenticated using (public.v2_is_staff());
drop policy if exists escans_insert on public.v2_event_scans;
create policy escans_insert on public.v2_event_scans for insert to authenticated
  with check (public.v2_has_role('mayor', 'vice_mayor', 'secretary', 'marshall', 'sails'));
drop policy if exists escans_delete on public.v2_event_scans;
create policy escans_delete on public.v2_event_scans for delete to authenticated
  using (public.v2_has_role('mayor', 'vice_mayor') or (scanned_by = auth.uid() and public.v2_has_role('secretary', 'marshall', 'sails')));
revoke all on public.v2_events, public.v2_event_scans from anon;

-- Scans are only accepted while the event is open, and the officer's name is stamped by the database
create or replace function public.v2_event_scan_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.v2_events e where e.id = new.event_id and e.status = 'open') then raise exception 'This event is closed'; end if;
  new.scanned_by := auth.uid();
  new.scanned_by_name := coalesce((select p.full_name from public.v2_profiles p where p.user_id = auth.uid()), new.scanned_by_name);
  new.scanned_at := now();
  return new;
end $$;
drop trigger if exists v2_event_scan_guard on public.v2_event_scans;
create trigger v2_event_scan_guard before insert on public.v2_event_scans for each row execute function public.v2_event_scan_guard();

create or replace function public.v2_event_stamp() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then new.created_by_name := coalesce((select p.full_name from public.v2_profiles p where p.user_id = auth.uid()), new.created_by_name); end if;
  if new.status = 'closed' and (tg_op = 'INSERT' or old.status <> 'closed') then new.closed_at := now(); end if;
  if new.status = 'open' then new.closed_at := null; end if;
  return new;
end $$;
drop trigger if exists v2_event_stamp on public.v2_events;
create trigger v2_event_stamp before insert or update on public.v2_events for each row execute function public.v2_event_stamp();

drop trigger if exists v2_events_audit on public.v2_events;
create trigger v2_events_audit after insert or delete or update on public.v2_events for each row execute function public.v2_audit_trigger();

-- Live counts on every officer's phone
do $$ begin
  begin alter publication supabase_realtime add table public.v2_events; exception when others then null; end;
  begin alter publication supabase_realtime add table public.v2_event_scans; exception when others then null; end;
end $$;
