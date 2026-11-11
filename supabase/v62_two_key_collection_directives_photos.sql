-- v62: two-key collection (Class Treasurer records, SAILS Treasurer counts and confirms), directives to Class Treasurer and Class Marshal,
-- progress figures pulled from the collection records, photos on progress reports. Run v61 first. Safe to run again.

-- 1. Who may give a directive to whom
create or replace function public.v2__directive_may(p_issuer text, p_assignee text) returns boolean
language sql immutable set search_path = '' as $$
  select case p_issuer
    when 'president' then p_assignee in ('vp_internal', 'vp_external', 'general_marshal')
    when 'vp_internal' then p_assignee in ('mayor')
    when 'vp_external' then p_assignee in ('mayor')
    when 'general_marshal' then p_assignee in ('dept_marshal')
    when 'treasurer' then p_assignee in ('class_treasurer')
    when 'dept_marshal' then p_assignee in ('marshall')
    else false end
$$;

create or replace function public.v2__directive_make(p_assignee uuid, p_title text, p_details text, p_due date, p_priority text, p_link text, p_batch uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare me text := public.v2__who(); r text := public.v2_role(); a public.v2_profiles; rid uuid; src text;
begin
  if r not in ('mayor', 'sails_president', 'vp_internal', 'vp_external', 'general_marshal', 'treasurer', 'dept_marshal') then raise exception 'You cannot issue directives'; end if;
  select * into a from public.v2_profiles where user_id = p_assignee;
  if a.user_id is null or not (public.v2__directive_may(r, a.role) or (public.v2_is_president() and public.v2__directive_may('president', a.role))) then
    raise exception 'You cannot give a directive to that officer';
  end if;
  -- a SAILS Marshal directs only the Class Marshal of his own block (a Class Marshal with no class seat yet can be reached by any SAILS Marshal)
  if r = 'dept_marshal' then
    if not exists (select 1 from public.v2_marshal_blocks b where b.user_id = auth.uid()) then raise exception 'You are not assigned to a block yet'; end if;
    if exists (select 1 from public.v2_seat_holders s join public.v2_units u on u.id = s.unit_id and u.kind = 'section' where s.user_id = a.user_id and s.status in ('active', 'acting'))
       and not exists (select 1 from public.v2_seat_holders s join public.v2_units u on u.id = s.unit_id and u.kind = 'section'
                       join public.v2_marshal_blocks b on lower(b.letter) = lower(u.section_name) and b.user_id = auth.uid()
                       where s.user_id = a.user_id and s.status in ('active', 'acting')) then
      raise exception 'That Class Marshal is not in your block';
    end if;
  end if;
  if p_assignee = auth.uid() then raise exception 'Assign directives to other officers'; end if;
  if p_due is not null and p_due < (now() at time zone 'Asia/Manila')::date then raise exception 'The due date has already passed'; end if;
  if length(btrim(coalesce(p_title, ''))) < 3 then raise exception 'Write the task'; end if;
  src := case when a.role in ('vp_internal', 'vp_external', 'general_marshal') then 'the President' when r = 'vp_internal' then 'the VP Internal' when r = 'vp_external' then 'the VP External'
    when r = 'general_marshal' then 'the General Marshal' when r = 'treasurer' then 'the SAILS Treasurer' when r = 'dept_marshal' then 'the SAILS Marshal' else 'the Class Mayor' end;
  insert into public.v2_directives(title, details, assignee_id, assignee_name, assignee_role, due_on, priority, link_note, issued_by, issued_by_name, issuer_role, batch_id)
  values (btrim(p_title), nullif(btrim(coalesce(p_details, '')), ''), a.user_id, a.full_name, a.role, p_due, coalesce(nullif(p_priority, ''), 'normal'), nullif(btrim(coalesce(p_link, '')), ''), auth.uid(), me, r, p_batch)
  returning id into rid;
  perform public.v2__directive_push(a.user_id, case when p_priority = 'urgent' then '🔴 Urgent directive from ' || src else 'New directive from ' || src end,
    btrim(p_title) || case when p_due is not null then ' · due ' || to_char(p_due, 'Mon FMDD') else '' end || '. Open Alpha ’28 to receive it.');
  return rid;
end $$;

-- The SAILS Treasurer can see the Class Treasurer, and the SAILS Marshal the Class Marshal (to pick them for a directive)
alter policy profiles_read on public.v2_profiles using (
  (user_id = (select auth.uid())) or public.v2_is_president()
  or (public.v2_role() = any (array['vp_internal','vp_external','general_marshal']))
  or ((public.v2_role() = any (array['mayor','auditor'])) and (role = any (array['vice_mayor','secretary','treasurer','class_treasurer','auditor','marshall','pio','sails'])))
  or (public.v2_role() = 'treasurer' and role = 'class_treasurer')
  or (public.v2_role() = 'dept_marshal' and role = 'marshall')
);

-- 2. Two keys on the money. The Class Treasurer records a collection (it counts at once and the student gets a receipt, as before).
--    The SAILS Treasurer then counts the cash handed over and confirms it. The Class Mayor sees what is still unconfirmed.
alter policy entries_insert on public.v2_entries with check (public.v2_role() = 'class_treasurer');

-- v61 let the Class Treasurer act as a treasurer in the rules; the Class Treasurer's expenses must still wait for approval like the Treasurer's did
do $$ declare src text;
begin
  select pg_get_functiondef('public.v2_entries_before()'::regprocedure) into src;
  if src like '%if r = ''treasurer'' and new.kind <> ''collection''%' then
    src := replace(src, 'if r = ''treasurer'' and new.kind <> ''collection''', 'if r in (''treasurer'', ''class_treasurer'') and new.kind <> ''collection''');
    execute src;
  elsif src not like '%class_treasurer%' then raise exception 'v2_entries_before changed shape; the Class Treasurer expense rule was not applied';
  end if;
end $$;

-- Only the real roles that approve expenses may call v2_approve_entry (the Class Treasurer shares the treasurer rules but must not approve)
create or replace function public.v2_approve_entry(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.v2_entries; r text := public.v2_role(); thr numeric := coalesce(nullif(public.v2__setting('expense_second_approval'), '')::numeric, 500); second boolean; nm text;
begin
  if r not in ('mayor', 'vp_internal', 'vp_external', 'secretary', 'treasurer') then raise exception 'Not allowed'; end if;
  select * into e from public.v2_entries where id = p_id for update;
  if e.id is null then raise exception 'Unknown entry'; end if;
  if e.status <> 'pending' then raise exception 'This entry is not waiting for approval'; end if;
  second := e.kind = 'expense' and thr > 0 and e.amount >= thr and coalesce(e.source, 'manual') = 'manual';
  if second then
    if e.recorded_by is not distinct from auth.uid() then raise exception 'You recorded this expense, so another officer must approve it'; end if;
    if e.receipt_image is null then raise exception 'This expense has no receipt photo yet. Add one before approving'; end if;
  elsif r <> 'mayor' then raise exception 'Only the Mayor can approve this entry'; end if;
  select full_name into nm from public.v2_profiles where user_id = auth.uid();
  perform set_config('alpha.approving', '1', true);
  update public.v2_entries set status = 'approved', approved_by_name = nm where id = p_id;
  perform set_config('alpha.approving', '', true);
end $$;
revoke execute on function public.v2_approve_entry(uuid) from public, anon;
grant execute on function public.v2_approve_entry(uuid) to authenticated, service_role;

alter table public.v2_entries add column if not exists confirmed_at timestamptz;
alter table public.v2_entries add column if not exists confirmed_by_name text;

-- What is recorded but not yet confirmed (approved collections only)
create or replace function public.v2_unconfirmed() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.v2_role() not in ('mayor', 'class_treasurer', 'treasurer', 'auditor') and not public.v2_is_president() then raise exception 'Not allowed'; end if;
  return (select jsonb_build_object('n', count(*), 'amount', coalesce(sum(amount), 0), 'oldest', min(occurred_at))
    from public.v2_entries where kind = 'collection' and status = 'approved' and confirmed_at is null and coalesce(source, 'manual') = 'manual');
end $$;
revoke execute on function public.v2_unconfirmed() from public, anon;
grant execute on function public.v2_unconfirmed() to authenticated, service_role;

-- The SAILS Treasurer confirms collections he has counted (never one he recorded himself: he cannot record any)
create or replace function public.v2_confirm_collections(p_ids uuid[]) returns int
language plpgsql security definer set search_path = '' as $$
declare n int; nm text;
begin
  if public.v2_role() <> 'treasurer' then raise exception 'Only the SAILS Treasurer confirms collections'; end if;
  if coalesce(array_length(p_ids, 1), 0) = 0 then raise exception 'Choose what to confirm'; end if;
  if array_length(p_ids, 1) > 500 then raise exception 'Confirm at most 500 at a time'; end if;
  select full_name into nm from public.v2_profiles where user_id = auth.uid();
  update public.v2_entries set confirmed_at = now(), confirmed_by_name = nm
    where id = any(p_ids) and kind = 'collection' and status = 'approved' and confirmed_at is null and recorded_by is distinct from auth.uid();
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.v2_confirm_collections(uuid[]) from public, anon;
grant execute on function public.v2_confirm_collections(uuid[]) to authenticated, service_role;

-- The Class Treasurer hands the money over: every SAILS Treasurer gets a phone alert with the amount waiting
create or replace function public.v2_handover() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb; v record;
begin
  if public.v2_role() <> 'class_treasurer' then raise exception 'Only the Class Treasurer hands over collections'; end if;
  s := public.v2_unconfirmed();
  if (s->>'n')::int = 0 then raise exception 'Nothing to hand over. Everything is confirmed'; end if;
  for v in select user_id from public.v2_profiles where role = 'treasurer' loop
    perform public.v2__directive_push(v.user_id, 'Collections handed over', (s->>'n') || ' collection(s), ₱' || to_char((s->>'amount')::numeric, 'FM999,999,990.00') || ', waiting for your count and confirmation.');
  end loop;
  return s;
end $$;
revoke execute on function public.v2_handover() from public, anon;
grant execute on function public.v2_handover() to authenticated, service_role;

-- 3. Progress figures for the Nameplate or Siglakas, taken from the confirmed collection records of the charge with that name
create or replace function public.v2_progress_figures(p_item text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare pat text; ids uuid[]; per numeric; mem int; got numeric; pend numeric; paid int;
begin
  if public.v2_role() not in ('mayor', 'class_treasurer', 'treasurer', 'vp_internal') and not public.v2_is_president() then raise exception 'Not allowed'; end if;
  pat := case p_item when 'nameplate' then '%nameplate%' when 'siglakas' then '%siglakas%' end;
  if pat is null then raise exception 'Choose the Nameplate or the Siglakas shirt'; end if;
  select coalesce(array_agg(id), '{}'), coalesce(sum(amount), 0) into ids, per from public.v2_charges where title ilike pat;
  if coalesce(array_length(ids, 1), 0) = 0 then return jsonb_build_object('found', false); end if;
  select count(*) into mem from public.v2_members where status = 'active';
  select coalesce(sum(amount), 0) into got from public.v2_entries where charge_id = any(ids) and kind = 'collection' and status = 'approved';
  select coalesce(sum(amount), 0) into pend from public.v2_entries where charge_id = any(ids) and kind = 'collection' and status = 'pending';
  select count(*) into paid from (select member_id from public.v2_entries where charge_id = any(ids) and kind = 'collection' and status = 'approved' and member_id is not null
    group by member_id having sum(amount) >= per) x;
  return jsonb_build_object('found', true, 'charges', array_length(ids, 1), 'members', mem, 'paid', paid, 'collected', got, 'pending', pend, 'target', per * mem);
end $$;
revoke execute on function public.v2_progress_figures(text) from public, anon;
grant execute on function public.v2_progress_figures(text) to authenticated, service_role;

-- 4. Photos on a progress report (supplier receipt, sample, delivered stock). The VP Internal adds them; the Class Mayor who sent the report sees them.
create table if not exists public.v2_class_ask_photos (
  id uuid primary key default gen_random_uuid(),
  ask_id uuid not null references public.v2_class_asks(id) on delete cascade,
  image text not null check (char_length(image) <= 700000),
  caption text check (caption is null or char_length(caption) <= 200),
  by_id uuid not null default auth.uid(),
  by_name text,
  created_at timestamptz not null default now()
);
create index if not exists v2_class_ask_photos_ask on public.v2_class_ask_photos(ask_id);
alter table public.v2_class_ask_photos enable row level security;
drop policy if exists caphotos_read on public.v2_class_ask_photos;
create policy caphotos_read on public.v2_class_ask_photos for select to authenticated using (
  exists (select 1 from public.v2_class_asks a where a.id = ask_id and (a.from_id = (select auth.uid()) or public.v2_role() = 'vp_internal' or public.v2_is_president())));
drop policy if exists caphotos_ins on public.v2_class_ask_photos;
create policy caphotos_ins on public.v2_class_ask_photos for insert to authenticated with check (
  by_id = (select auth.uid()) and (public.v2_role() = 'vp_internal' or public.v2_is_president()));
drop policy if exists caphotos_del on public.v2_class_ask_photos;
create policy caphotos_del on public.v2_class_ask_photos for delete to authenticated using (by_id = (select auth.uid()));
revoke all on public.v2_class_ask_photos from anon;
grant select, insert, delete on public.v2_class_ask_photos to authenticated;

create or replace function public.v2__caphoto_fill() returns trigger
language plpgsql security definer set search_path = '' as $$
declare a public.v2_class_asks;
begin
  new.by_name := public.v2__who();
  select * into a from public.v2_class_asks where id = new.ask_id;
  if a.from_id is not null then perform public.v2__directive_push(a.from_id, 'New photo on your progress report', coalesce(nullif(new.caption, ''), a.title)); end if;
  return new;
end $$;
drop trigger if exists v2_caphoto_fill on public.v2_class_ask_photos;
create trigger v2_caphoto_fill before insert on public.v2_class_ask_photos for each row execute function public.v2__caphoto_fill();
revoke execute on function public.v2__caphoto_fill() from public, anon, authenticated;

do $$ begin
  begin alter publication supabase_realtime add table public.v2_class_ask_photos; exception when others then null; end;
end $$;

-- 5. Setup page check (full definition, v51 to v62)
create or replace function public.v2_schema_marks() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare g text; mk jsonb;
begin
  select pg_get_functiondef('public.v2_profile_role_guard()'::regprocedure) into g;
  mk := jsonb_build_object(
    'v51', g like '%pending%' or g like '%manages accounts%',
    'v52', (select pg_get_constraintdef(oid) not like '%vice_mayor%' from pg_constraint where conname = 'v2_profiles_role_check'),
    'v53', g like '%manages accounts%',
    'v54', (select pg_get_functiondef('public.v2__directive_may(text,text)'::regprocedure) not like '%when ''mayor''%'),
    'v55', to_regclass('public.v2_desk_receipts') is not null,
    'v56', (select pg_get_functiondef('public.v2_role()'::regprocedure) not like '%''pending'' else%'),
    'v57', to_regprocedure('public.v2__marshal_sees(uuid)') is not null,
    'v58', to_regclass('public.v2_inspections') is not null,
    'v59', to_regclass('public.v2_admin_log') is not null,
    'v60', not has_function_privilege('anon', 'public.v2_inspection_open(text)', 'execute'),
    'v61', to_regprocedure('public.v2_class_progress(text,text,int,int,numeric,numeric,date,text)') is not null,
    'v62', to_regclass('public.v2_class_ask_photos') is not null and to_regprocedure('public.v2_progress_figures(text)') is not null and to_regprocedure('public.v2_confirm_collections(uuid[])') is not null);
  return mk;
end $$;
revoke execute on function public.v2_schema_marks() from public, anon;
grant execute on function public.v2_schema_marks() to authenticated, service_role;
