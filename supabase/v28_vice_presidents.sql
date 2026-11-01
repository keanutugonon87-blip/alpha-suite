-- Alpha ’28 · v28 · Vice President Internal and Vice President External (Chief Mate – Internal / External) get their own roles and dashboards.
-- Safe to run more than once. Paste all of it into Supabase > SQL Editor > Run. Run v21 to v27 first.
--
--   • Two new roles: vp_internal and vp_external. Everything the Vice Mayor role could already do, they can do too
--     (the old vice_mayor role keeps working, so nothing breaks while you move people over).
--   • VP Internal: meetings and programs planner, committee tasks by section/year level, internal resolutions with progress reports,
--     tasks the Mayor hands over while absent.
--   • VP External: partner directory (organizations, institutions, alumni, community), joint activities with adviser review and a check that
--     external communications state SAILS authority correctly, register of approved collaborations, representation log, Coordinating Council.
--   • A VP only PROPOSES meetings, programs, partners and joint activities. The Mayor approves or returns them.
--     After approval the VP moves a joint activity on (ongoing, done). Nothing else changes by itself.

-- 1. The two new roles are accepted wherever a role is stored
alter table public.v2_profiles drop constraint if exists v2_profiles_role_check;
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.v2_profiles'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%mayor%' loop
    execute format('alter table public.v2_profiles drop constraint %I', c);
  end loop;
end $$;
alter table public.v2_profiles add constraint v2_profiles_role_check
  check (role in ('pending','mayor','vice_mayor','vp_internal','vp_external','secretary','treasurer','auditor','marshall','sails','pio'));

alter table public.v2_duty_templates drop constraint if exists v2_duty_templates_role_check;
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.v2_duty_templates'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%mayor%' loop
    execute format('alter table public.v2_duty_templates drop constraint %I', c);
  end loop;
end $$;
alter table public.v2_duty_templates add constraint v2_duty_templates_role_check
  check (role in ('mayor','vice_mayor','vp_internal','vp_external','secretary','treasurer','auditor','marshall','sails','pio'));

-- the new VPs start with the same daily duties the Vice Mayor has
insert into public.v2_duty_templates(role, title, detail, repeat, days, month_day, sort)
select r.role, t.title, t.detail, t.repeat, t.days, t.month_day, t.sort
from public.v2_duty_templates t cross join (values ('vp_internal'), ('vp_external')) as r(role)
where t.role = 'vice_mayor'
  and not exists (select 1 from public.v2_duty_templates x where x.role = r.role and x.title = t.title);

-- 2. A VP counts as a Vice Mayor in every existing permission check
create or replace function public.v2_has_role(variadic roles text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.v2_role() = any(roles)
    or (public.v2_role() in ('vp_internal', 'vp_external') and 'vice_mayor' = any(roles)), false)
$$;

-- 3. Tables
create table if not exists public.v2_vp_meetings (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'meeting' check (kind in ('meeting', 'program')),
  title text not null check (char_length(title) between 2 and 100),
  held_on date not null,
  held_at text check (held_at is null or char_length(held_at) <= 20),
  venue text check (venue is null or char_length(venue) <= 100),
  agenda text check (agenda is null or char_length(agenda) <= 1000),
  assigned text check (assigned is null or char_length(assigned) <= 200),
  outcome text check (outcome is null or char_length(outcome) <= 1000),
  status text not null default 'proposed' check (status in ('proposed', 'returned', 'approved', 'done', 'cancelled')),
  mayor_note text check (mayor_note is null or char_length(mayor_note) <= 300),
  created_by uuid default auth.uid(), created_by_name text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.v2_vp_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 2 and 120),
  assignee text check (assignee is null or char_length(assignee) <= 80),
  scope text check (scope is null or char_length(scope) <= 60),   -- section or year level this task is for
  due_on date,
  status text not null default 'todo' check (status in ('todo', 'doing', 'done')),
  note text check (note is null or char_length(note) <= 300),
  created_by uuid default auth.uid(), created_by_name text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.v2_vp_resolutions (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 2 and 120),
  details text check (details is null or char_length(details) <= 600),
  status text not null default 'pending' check (status in ('pending', 'ongoing', 'done')),
  progress text check (progress is null or char_length(progress) <= 600),   -- latest progress report
  reported_on date,
  created_by uuid default auth.uid(), created_by_name text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.v2_vp_delegations (
  id uuid primary key default gen_random_uuid(),
  to_role text not null default 'both' check (to_role in ('vp_internal', 'vp_external', 'both')),
  title text not null check (char_length(title) between 2 and 120),
  details text check (details is null or char_length(details) <= 500),
  from_date date, to_date date,
  status text not null default 'open' check (status in ('open', 'done')),
  done_note text check (done_note is null or char_length(done_note) <= 300),
  done_by_name text, done_at timestamptz,
  created_by uuid default auth.uid(), created_by_name text, created_at timestamptz not null default now()
);
create table if not exists public.v2_vp_partners (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 100),
  kind text not null default 'organization' check (kind in ('organization', 'institution', 'alumni', 'community')),
  adviser_status text not null default 'pending' check (adviser_status in ('pending', 'endorsed', 'not_endorsed')),
  adviser_note text check (adviser_note is null or char_length(adviser_note) <= 300),
  contact_name text check (contact_name is null or char_length(contact_name) <= 80),
  contact text check (contact is null or char_length(contact) <= 120),
  notes text check (notes is null or char_length(notes) <= 500),
  status text not null default 'proposed' check (status in ('proposed', 'returned', 'active', 'inactive')),
  mayor_note text check (mayor_note is null or char_length(mayor_note) <= 300),
  created_by uuid default auth.uid(), created_by_name text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.v2_vp_activities (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid references public.v2_vp_partners(id) on delete set null,
  title text not null check (char_length(title) between 2 and 100),
  details text check (details is null or char_length(details) <= 1000),
  planned_on date,
  papers text check (papers is null or char_length(papers) <= 300),   -- letters, MOA and other papers, and where they are kept
  adviser_status text not null default 'pending' check (adviser_status in ('pending', 'endorsed', 'not_endorsed')),   -- the adviser reviews partnership proposals
  adviser_note text check (adviser_note is null or char_length(adviser_note) <= 300),
  authority_ok boolean not null default false,   -- the wording of outside communications states SAILS authority correctly
  status text not null default 'proposed' check (status in ('proposed', 'returned', 'approved', 'ongoing', 'done')),
  mayor_note text check (mayor_note is null or char_length(mayor_note) <= 300),
  created_by uuid default auth.uid(), created_by_name text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.v2_vp_reps (
  id uuid primary key default gen_random_uuid(),
  held_on date not null,
  title text not null check (char_length(title) between 2 and 120),
  organizer text check (organizer is null or char_length(organizer) <= 100),
  delegated_by text check (delegated_by is null or char_length(delegated_by) <= 80),
  notes text check (notes is null or char_length(notes) <= 1000),
  created_by uuid default auth.uid(), created_by_name text, created_at timestamptz not null default now()
);
create table if not exists public.v2_vp_council (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'agenda' check (kind in ('agenda', 'resolution')),
  title text not null check (char_length(title) between 2 and 120),
  body text check (body is null or char_length(body) <= 1500),
  meet_on date,
  status text not null default 'open' check (status in ('open', 'adopted', 'dropped')),
  created_by uuid default auth.uid(), created_by_name text, created_at timestamptz not null default now()
);
create index if not exists v2_vp_meetings_on on public.v2_vp_meetings (held_on desc);
create index if not exists v2_vp_reps_on on public.v2_vp_reps (held_on desc);

-- 4. Who may read and write
do $$ declare t text; begin
  foreach t in array array['v2_vp_meetings','v2_vp_tasks','v2_vp_resolutions','v2_vp_delegations','v2_vp_partners','v2_vp_activities','v2_vp_reps','v2_vp_council'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.v2_is_staff())', t || '_read', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- the Mayor can do everything; the VPs only in their own area
drop policy if exists vp_meetings_write on public.v2_vp_meetings;
create policy vp_meetings_write on public.v2_vp_meetings for all to authenticated
  using (public.v2_role() in ('mayor', 'vp_internal', 'vice_mayor')) with check (public.v2_role() in ('mayor', 'vp_internal', 'vice_mayor'));
drop policy if exists vp_tasks_write on public.v2_vp_tasks;
create policy vp_tasks_write on public.v2_vp_tasks for all to authenticated
  using (public.v2_has_role('mayor', 'vice_mayor')) with check (public.v2_has_role('mayor', 'vice_mayor'));
drop policy if exists vp_res_write on public.v2_vp_resolutions;
create policy vp_res_write on public.v2_vp_resolutions for all to authenticated
  using (public.v2_role() in ('mayor', 'vp_internal', 'vice_mayor')) with check (public.v2_role() in ('mayor', 'vp_internal', 'vice_mayor'));
drop policy if exists vp_deleg_write on public.v2_vp_delegations;
create policy vp_deleg_write on public.v2_vp_delegations for all to authenticated
  using (public.v2_has_role('mayor')) with check (public.v2_has_role('mayor'));
drop policy if exists vp_partners_write on public.v2_vp_partners;
create policy vp_partners_write on public.v2_vp_partners for all to authenticated
  using (public.v2_role() in ('mayor', 'vp_external', 'vice_mayor')) with check (public.v2_role() in ('mayor', 'vp_external', 'vice_mayor'));
drop policy if exists vp_acts_write on public.v2_vp_activities;
create policy vp_acts_write on public.v2_vp_activities for all to authenticated
  using (public.v2_role() in ('mayor', 'vp_external', 'vice_mayor')) with check (public.v2_role() in ('mayor', 'vp_external', 'vice_mayor'));
drop policy if exists vp_reps_write on public.v2_vp_reps;
create policy vp_reps_write on public.v2_vp_reps for all to authenticated
  using (public.v2_role() in ('mayor', 'vp_external', 'vice_mayor')) with check (public.v2_role() in ('mayor', 'vp_external', 'vice_mayor'));
drop policy if exists vp_council_write on public.v2_vp_council;
create policy vp_council_write on public.v2_vp_council for all to authenticated
  using (public.v2_role() in ('mayor', 'vp_external', 'vice_mayor')) with check (public.v2_role() in ('mayor', 'vp_external', 'vice_mayor'));

-- 5. The approval rule: a VP can only propose, and can only move things the way the flow allows. The Mayor can set any stage.
create or replace function public.v2_vp_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r text := public.v2_role(); ok boolean := false;
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid(); new.created_by_name := public.v2__who();
    if r <> 'mayor' then
      if new.status <> 'proposed' then raise exception 'A new proposal starts as proposed. The Mayor approves it.'; end if;
      new.mayor_note := null;
    end if;
    return new;
  end if;
  new.updated_at := now();
  if r = 'mayor' then return new; end if;
  if new.mayor_note is distinct from old.mayor_note then raise exception 'Only the Mayor writes the approval note'; end if;
  if new.status = old.status then
    if old.status in ('proposed', 'returned') or tg_table_name = 'v2_vp_partners' or (tg_table_name = 'v2_vp_meetings' and old.status in ('approved', 'done')) or (tg_table_name = 'v2_vp_activities' and old.status in ('approved', 'ongoing')) then return new; end if;
    raise exception 'This is already % and cannot be edited', old.status;
  end if;
  ok := case tg_table_name
    when 'v2_vp_meetings' then (old.status = 'returned' and new.status = 'proposed') or (old.status = 'approved' and new.status in ('done', 'cancelled')) or (old.status in ('proposed', 'returned') and new.status = 'cancelled')
    when 'v2_vp_partners' then (old.status = 'returned' and new.status = 'proposed') or (old.status = 'active' and new.status = 'inactive') or (old.status = 'inactive' and new.status = 'active')
    when 'v2_vp_activities' then (old.status = 'returned' and new.status = 'proposed') or (old.status = 'approved' and new.status in ('ongoing', 'done')) or (old.status = 'ongoing' and new.status = 'done')
    else false end;
  if not ok then raise exception 'Only the Mayor can change this from % to %', old.status, new.status; end if;
  return new;
end $$;
revoke all on function public.v2_vp_guard() from public, anon;

-- the name stamp for the rows that need no approval
create or replace function public.v2_vp_stamp() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then new.created_by := auth.uid(); new.created_by_name := public.v2__who(); end if;
  if tg_table_name in ('v2_vp_tasks', 'v2_vp_resolutions') then new.updated_at := now(); end if;
  return new;
end $$;
revoke all on function public.v2_vp_stamp() from public, anon;

do $$ declare t text; begin
  foreach t in array array['v2_vp_meetings','v2_vp_partners','v2_vp_activities'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_guard', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.v2_vp_guard()', t || '_guard', t);
  end loop;
  foreach t in array array['v2_vp_tasks','v2_vp_resolutions','v2_vp_delegations','v2_vp_reps','v2_vp_council'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_stamp', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.v2_vp_stamp()', t || '_stamp', t);
  end loop;
  foreach t in array array['v2_vp_meetings','v2_vp_tasks','v2_vp_resolutions','v2_vp_delegations','v2_vp_partners','v2_vp_activities','v2_vp_reps','v2_vp_council'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or delete or update on public.%I for each row execute function public.v2_audit_trigger()', t || '_audit', t);
  end loop;
end $$;

-- 6. A VP marks a task the Mayor handed over as done (they cannot edit the task itself)
create or replace function public.v2_deleg_done(p_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare r text := public.v2_role(); d record;
begin
  select * into d from public.v2_vp_delegations where id = p_id;
  if d.id is null then raise exception 'Task not found'; end if;
  if r not in ('mayor', 'vp_internal', 'vp_external', 'vice_mayor') then raise exception 'Not allowed'; end if;
  if r in ('vp_internal', 'vp_external') and d.to_role <> 'both' and d.to_role <> r then raise exception 'That task was given to the other Vice President'; end if;
  update public.v2_vp_delegations set status = 'done', done_note = nullif(btrim(coalesce(p_note, '')), ''), done_by_name = public.v2__who(), done_at = now() where id = p_id;
end $$;
revoke all on function public.v2_deleg_done(uuid, text) from public, anon;
grant execute on function public.v2_deleg_done(uuid, text) to authenticated;

do $$ declare t text; begin
  foreach t in array array['v2_vp_meetings','v2_vp_tasks','v2_vp_resolutions','v2_vp_delegations','v2_vp_partners','v2_vp_activities','v2_vp_reps','v2_vp_council'] loop
    begin execute format('alter publication supabase_realtime add table public.%I', t); exception when others then null; end;
  end loop;
end $$;
