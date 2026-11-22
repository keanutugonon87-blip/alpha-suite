-- v69: SAILS Line of Authority, step 3a. Every class and section keeps its own money, students,
-- charges, events and violations. Each class sees only its own; the SAILS-level officers
-- (President, VPs, Secretary, Treasurer, Auditor, PIO, General Marshal) still see every class,
-- and a SAILS Marshal sees the sections of his letter.
-- Everything that exists today is filed under 1-Alpha. The other 11 classes start empty.
-- (Step 3b, next: a period and a month close for each class, and the student page by class.)
-- Run once in the Supabase SQL editor. Safe to run again.

-- 1. Helpers
create or replace function public.v2__alpha_unit() returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.v2_units where kind = 'section' and name = '1-Alpha' limit 1
$$;

create or replace function public.v2__global_view() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.v2_is_president()
    or public.v2_role() in ('vp_internal', 'vp_external', 'secretary', 'treasurer', 'auditor', 'pio', 'general_marshal'), false)
$$;

-- may the signed-in person see / write records of this class?
create or replace function public.v2__unit_ok(p_unit uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.v2__global_view()
    or (p_unit is not null and (p_unit = public.v2__my_unit()
        or (public.v2_role() = 'dept_marshal' and public.v2__marshal_sees(p_unit))))
$$;

-- 2. A class tag on every class record
do $do$
declare t text;
begin
  foreach t in array array['v2_charges', 'v2_entries', 'v2_events', 'v2_violations', 'v2_promises', 'v2_waivers', 'v2_periods', 'v2_month_close'] loop
    execute format('alter table public.%I add column if not exists unit_id uuid references public.v2_units(id)', t);
  end loop;
end $do$;

-- 3. Everything that exists today belongs to 1-Alpha
do $do$
declare a uuid := public.v2__alpha_unit(); t text;
begin
  if a is null then raise exception 'The 1-Alpha section is missing'; end if;
  foreach t in array array['v2_charges', 'v2_entries', 'v2_events', 'v2_violations', 'v2_promises', 'v2_waivers', 'v2_periods', 'v2_month_close', 'v2_members'] loop
    execute format('alter table public.%I disable trigger user', t);
  end loop;
  update public.v2_members set unit_id = a where unit_id is null;
  update public.v2_charges set unit_id = a where unit_id is null;
  update public.v2_events set unit_id = a where unit_id is null;
  update public.v2_periods set unit_id = a where unit_id is null;
  update public.v2_month_close set unit_id = a where unit_id is null;
  update public.v2_violations v set unit_id = coalesce((select m.unit_id from public.v2_members m where m.id = v.member_id), a) where v.unit_id is null;
  update public.v2_promises v set unit_id = coalesce((select m.unit_id from public.v2_members m where m.id = v.member_id), a) where v.unit_id is null;
  update public.v2_waivers v set unit_id = coalesce((select c.unit_id from public.v2_charges c where c.id = v.charge_id), a) where v.unit_id is null;
  update public.v2_entries e set unit_id = coalesce((select m.unit_id from public.v2_members m where m.id = e.member_id), (select c.unit_id from public.v2_charges c where c.id = e.charge_id), a) where e.unit_id is null;
  foreach t in array array['v2_charges', 'v2_entries', 'v2_events', 'v2_violations', 'v2_promises', 'v2_waivers', 'v2_periods', 'v2_month_close', 'v2_members'] loop
    execute format('alter table public.%I enable trigger user', t);
  end loop;
end $do$;

alter table public.v2_charges alter column unit_id set not null;
alter table public.v2_entries alter column unit_id set not null;
alter table public.v2_events alter column unit_id set not null;
alter table public.v2_violations alter column unit_id set not null;
alter table public.v2_promises alter column unit_id set not null;
alter table public.v2_waivers alter column unit_id set not null;
alter table public.v2_periods alter column unit_id set not null;
alter table public.v2_month_close alter column unit_id set not null;
alter table public.v2_members alter column unit_id set not null;

create index if not exists v2_charges_unit_idx on public.v2_charges(unit_id);
create index if not exists v2_entries_unit_idx on public.v2_entries(unit_id);
create index if not exists v2_events_unit_idx on public.v2_events(unit_id);
create index if not exists v2_violations_unit_idx on public.v2_violations(unit_id);
create index if not exists v2_members_unit_idx on public.v2_members(unit_id);

-- 4. New records pick up their class on their own (a student's class, a charge's class, else the signed-in person's class)
create or replace function public.v2__fill_unit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare u uuid := new.unit_id; mine uuid := public.v2__my_unit(); j jsonb := to_jsonb(new); mid uuid := nullif(j->>'member_id', '')::uuid; cid uuid := nullif(j->>'charge_id', '')::uuid;
begin
  if u is null and mid is not null then
    select m.unit_id into u from public.v2_members m where m.id = mid;
  end if;
  if u is null and cid is not null then
    select c.unit_id into u from public.v2_charges c where c.id = cid;
  end if;
  new.unit_id := coalesce(u, mine, public.v2__alpha_unit());
  return new;
end $$;

do $do$
declare t text;
begin
  foreach t in array array['v2_charges', 'v2_entries', 'v2_events', 'v2_violations', 'v2_promises', 'v2_waivers', 'v2_periods', 'v2_month_close', 'v2_members'] loop
    execute format('drop trigger if exists aa_fill_unit on public.%I', t);
    execute format('create trigger aa_fill_unit before insert on public.%I for each row execute function public.v2__fill_unit()', t);
  end loop;
end $do$;

-- 5. Each class sees and changes only its own records (SAILS Marshal policies already have their own rule)
do $do$
declare p record; ex text; q text; w text; cond text;
begin
  perform set_config('search_path', 'public', true);
  for p in
    select c.relname, pol.polname, pol.polcmd::text cmd, pol.polrelid,
           pg_get_expr(pol.polqual, pol.polrelid) uq, pg_get_expr(pol.polwithcheck, pol.polrelid) wq
    from pg_policy pol join pg_class c on c.oid = pol.polrelid
    where c.relnamespace = 'public'::regnamespace
      and c.relname in ('v2_charges', 'v2_entries', 'v2_events', 'v2_violations', 'v2_promises', 'v2_waivers', 'v2_periods', 'v2_month_close', 'v2_members', 'v2_event_scans', 'v2_reminders')
      and pol.polname not like '%marshal%'
  loop
    ex := case p.relname
      when 'v2_event_scans' then '(select e.unit_id from public.v2_events e where e.id = event_id)'
      when 'v2_reminders' then '(select c.unit_id from public.v2_charges c where c.id = charge_id)'
      else 'unit_id' end;
    cond := 'public.v2__unit_ok(' || ex || ')';
    if coalesce(p.uq, '') like '%v2__unit_ok%' or coalesce(p.wq, '') like '%v2__unit_ok%' then continue; end if;
    if p.cmd = 'a' then
      execute format('alter policy %I on public.%I with check ((%s) and %s)', p.polname, p.relname, p.wq, cond);
    elsif p.cmd in ('r', 'd') then
      execute format('alter policy %I on public.%I using ((%s) and %s)', p.polname, p.relname, p.uq, cond);
    else
      execute format('alter policy %I on public.%I using ((%s) and %s) with check ((%s) and %s)', p.polname, p.relname, p.uq, cond, coalesce(p.wq, p.uq), cond);
    end if;
  end loop;
end $do$;

-- 6. The server functions that bypass those rules
do $do$
declare src text; old text; f text;
begin
  -- balances: each student against his own class's charges
  src := pg_get_functiondef('public.v2_balances()'::regprocedure); old := src;
  src := replace(src, 'cross join public.v2_charges c', 'join public.v2_charges c on c.unit_id = m.unit_id');
  src := replace(src, 'where m.status = ''active'')', 'where m.status = ''active'' and public.v2__unit_ok(m.unit_id))');
  if src <> old then execute src; end if;

  -- collections waiting to be handed over / counted
  src := pg_get_functiondef('public.v2_unconfirmed()'::regprocedure); old := src;
  src := replace(src, 'and coalesce(source, ''manual'') = ''manual''', 'and coalesce(source, ''manual'') = ''manual'' and public.v2__unit_ok(unit_id)');
  if src <> old then execute src; end if;

  -- progress figures (Nameplate, Siglakas)
  src := pg_get_functiondef('public.v2_progress_figures(text)'::regprocedure); old := src;
  src := replace(src, 'from public.v2_charges where title ilike pat', 'from public.v2_charges where title ilike pat and public.v2__unit_ok(unit_id)');
  src := replace(src, 'from public.v2_members where status = ''active'';', 'from public.v2_members where status = ''active'' and public.v2__unit_ok(unit_id);');
  src := replace(src, 'where charge_id = any(ids) and kind = ''collection'' and status = ''approved'';', 'where charge_id = any(ids) and kind = ''collection'' and status = ''approved'';');
  if src <> old then execute src; end if;

  -- approving an entry: only the class's own Mayor (or the SAILS officers)
  src := pg_get_functiondef('public.v2_approve_entry(uuid)'::regprocedure); old := src;
  src := replace(src, 'if e.status <> ''pending'' then', 'if not public.v2__unit_ok(e.unit_id) then raise exception ''Not allowed''; end if; if e.status <> ''pending'' then');
  if src <> old then execute src; end if;

  -- excusing a student
  src := pg_get_functiondef('public.v2_waive_charge(uuid,uuid,text)'::regprocedure); old := src;
  src := replace(src, 'if not exists (select 1 from public.v2_charges where id = p_charge) then raise exception ''Unknown charge''; end if;',
    'if not exists (select 1 from public.v2_charges where id = p_charge and public.v2__unit_ok(unit_id)) then raise exception ''Unknown charge''; end if;');
  src := replace(src, 'if not exists (select 1 from public.v2_members where id = p_member) then raise exception ''Unknown student''; end if;',
    'if not exists (select 1 from public.v2_members m join public.v2_charges c on c.unit_id = m.unit_id where m.id = p_member and c.id = p_charge) then raise exception ''Unknown student''; end if;');
  if src <> old then execute src; end if;

  src := pg_get_functiondef('public.v2_unwaive_charge(uuid,uuid)'::regprocedure); old := src;
  src := replace(src, 'delete from public.v2_waivers where charge_id = p_charge', 'delete from public.v2_waivers where public.v2__unit_ok(unit_id) and charge_id = p_charge');
  if src <> old then execute src; end if;

  -- payment reminders: only that class's students, only its own charge
  for f in select unnest(array['public.v2_reminder_roster(uuid)', 'public.v2_reminder_status(uuid)', 'public.v2__send_reminder_core(uuid,uuid,text)']) loop
    src := pg_get_functiondef(f::regprocedure); old := src;
    src := replace(src, 'where m.status = ''active'' and c.amount', 'where m.status = ''active'' and m.unit_id = c.unit_id and (auth.uid() is null or public.v2__unit_ok(c.unit_id)) and c.amount');
    if src <> old then execute src; end if;
  end loop;
end $do$;

-- 7. Setup page check
do $do$ declare src text;
begin
  select pg_get_functiondef('public.v2_schema_marks()'::regprocedure) into src;
  if src not like '%''v69''%' then
    src := replace(src, E'  return mk;', E'  mk := mk || jsonb_build_object(''v69'', exists (select 1 from pg_trigger where tgname = ''aa_fill_unit'' and tgrelid = ''public.v2_entries''::regclass));\n  return mk;');
    execute src;
  end if;
end $do$;
