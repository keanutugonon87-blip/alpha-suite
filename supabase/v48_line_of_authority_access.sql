-- v48 · SAILS-level access belongs to the SAILS President (and the VPs where their work needs it). A Class Mayor sees and manages only his own class.
--  * Accounts: a Class Mayor manages only his class officers. The SAILS President assigns Class Mayors, VPs, the General Marshal and the Department Marshals.
--    The SAILS President role can be given only from the Supabase SQL editor (or by the acting Mayor while no President account exists yet).
--  * VP meetings, partners, activities and delegations: President and VPs only.
--  * Calendar: a Class Mayor sees approved activities and his own drafts.
--  * Sections, seats: a Class Mayor sees his own section only.
--  * Marshal blocks: not for a Class Mayor.
--  * New: the President's overview of every section.
-- Requires v37, v45, v46. Safe to run twice.

-- 1 · helpers
create or replace function public.v2__my_unit() returns uuid
language sql stable security definer set search_path = '' as $$
  select unit_id from public.v2_seat_holders where user_id = auth.uid() and status in ('active', 'acting') and unit_id is not null limit 1
$$;
revoke all on function public.v2__my_unit() from public, anon;
grant execute on function public.v2__my_unit() to authenticated;

-- 2 · accounts
drop policy if exists profiles_read on public.v2_profiles;
create policy profiles_read on public.v2_profiles for select to authenticated using (
  user_id = (select auth.uid())
  or public.v2_is_president()
  or public.v2_role() in ('vp_internal', 'vp_external', 'general_marshal')
  or (public.v2_role() in ('mayor', 'auditor') and role in ('pending', 'vice_mayor', 'secretary', 'treasurer', 'auditor', 'marshall', 'pio', 'sails')));
-- (the General Marshal's own policy keeps showing him the Department Marshals)

drop policy if exists profiles_mayor_upd on public.v2_profiles;
create policy profiles_mayor_upd on public.v2_profiles for update to authenticated
  using (user_id = (select auth.uid()) or public.v2_is_president()
         or (public.v2_role() = 'mayor' and role in ('pending', 'vice_mayor', 'secretary', 'treasurer', 'auditor', 'marshall', 'pio', 'sails')))
  with check (user_id = (select auth.uid()) or public.v2_is_president()
         or (public.v2_role() = 'mayor' and role in ('pending', 'vice_mayor', 'secretary', 'treasurer', 'auditor', 'marshall', 'pio', 'sails')));
drop policy if exists profiles_mayor_del on public.v2_profiles;
create policy profiles_mayor_del on public.v2_profiles for delete to authenticated
  using (user_id <> (select auth.uid()) and (public.v2_is_president()
         or (public.v2_role() = 'mayor' and role in ('pending', 'vice_mayor', 'secretary', 'treasurer', 'auditor', 'marshall', 'pio', 'sails'))));

-- who may change a role to what (the SQL editor, with no signed-in user, is not limited)
create or replace function public.v2_profile_role_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r text := public.v2_role();
begin
  if new.role is distinct from old.role and auth.uid() is not null then
    if old.user_id = auth.uid() then raise exception 'You cannot change your own role'; end if;
    if new.role = 'sails_president' and public.v2_president_exists() then raise exception 'The SAILS President role is given in the database only'; end if;
    if public.v2_is_president() then
      null;
    elsif r = 'mayor' then
      if old.role not in ('pending', 'vice_mayor', 'secretary', 'treasurer', 'auditor', 'marshall', 'pio', 'sails')
         or new.role not in ('pending', 'vice_mayor', 'secretary', 'treasurer', 'auditor', 'marshall', 'pio', 'sails') then
        raise exception 'The SAILS President assigns that role';
      end if;
    else
      raise exception 'You cannot change roles';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.v2_profile_role_guard() from public, anon;
drop trigger if exists v2_profile_role_guard on public.v2_profiles;
create trigger v2_profile_role_guard before update on public.v2_profiles for each row execute function public.v2_profile_role_guard();

-- 3 · VP work: President and VPs
do $$ declare t text; begin
  foreach t in array array['v2_vp_meetings', 'v2_vp_partners', 'v2_vp_activities', 'v2_vp_delegations'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.v2_is_president() or public.v2_role() in (''vp_internal'', ''vp_external''))', t || '_read', t);
  end loop;
end $$;
drop policy if exists vp_deleg_write on public.v2_vp_delegations;
create policy vp_deleg_write on public.v2_vp_delegations for all to authenticated using (public.v2_is_president()) with check (public.v2_is_president());

-- 4 · the calendar: approved activities for everyone on staff; drafts and proposals only for their author, the VPs and the President
drop policy if exists coa_read on public.v2_coa;
create policy coa_read on public.v2_coa for select to authenticated using (
  (public.v2_is_staff() and status in ('approved', 'cancelled'))
  or created_by = auth.uid() or public.v2_is_president() or public.v2_role() in ('vp_internal', 'vp_external', 'auditor'));

-- 5 · sections and seats: a Class Mayor sees his own section
drop policy if exists units_read on public.v2_units;
create policy units_read on public.v2_units for select to authenticated using (
  public.v2_is_president() or public.v2_role() in ('vp_internal', 'vp_external', 'general_marshal') or id = public.v2__my_unit());
drop policy if exists seat_holders_read on public.v2_seat_holders;
create policy seat_holders_read on public.v2_seat_holders for select to authenticated using (
  public.v2_is_president() or public.v2_role() in ('vp_internal', 'vp_external', 'general_marshal') or unit_id = public.v2__my_unit() or user_id = auth.uid());

-- 6 · Marshal blocks: President, General Marshal, Department Marshals
create or replace function public.v2_marshal_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r text := public.v2_role();
begin
  if not (public.v2_is_president() or r in ('sails_president', 'general_marshal', 'dept_marshal')) then raise exception 'Not allowed'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'letter', b.letter, 'user_id', b.user_id, 'user_name', (select full_name from public.v2_profiles where user_id = b.user_id),
      'sections', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name, 'year_level', u.year_level,
                   'students', (select count(*) from public.v2_members m where m.unit_id = u.id and m.status = 'active'),
                   'has_mayor', exists (select 1 from public.v2_seat_holders h where h.unit_id = u.id and h.seat = 'mayor' and h.status in ('active', 'acting') and h.user_id is not null)) order by u.year_level)
                   from public.v2_units u where u.kind = 'section' and u.active and lower(u.section_name) = lower(b.letter)), '[]'::jsonb))
    order by b.letter) from public.v2_marshal_blocks b where r <> 'dept_marshal' or b.user_id = auth.uid()), '[]'::jsonb);
end $$;
grant execute on function public.v2_marshal_overview() to authenticated;

create or replace function public.v2_marshal_block_set(p_letter text, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (public.v2_is_president() or public.v2_role() in ('general_marshal', 'sails_president')) then raise exception 'Only the General Marshal assigns the blocks'; end if;
  if p_user is not null and not exists (select 1 from public.v2_profiles where user_id = p_user and role = 'dept_marshal') then raise exception 'Pick a Department Marshal'; end if;
  update public.v2_marshal_blocks set user_id = null where user_id = p_user and p_user is not null and letter <> p_letter;
  update public.v2_marshal_blocks set user_id = p_user, updated_at = now() where letter = p_letter;
  if not found then raise exception 'Unknown block'; end if;
end $$;
grant execute on function public.v2_marshal_block_set(text, uuid) to authenticated;

-- 7 · the President's overview of every section (also the VPs and the General Marshal)
create or replace function public.v2_president_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare today date := (now() at time zone 'Asia/Manila')::date;
begin
  if not (public.v2_is_president() or public.v2_role() in ('vp_internal', 'vp_external', 'general_marshal')) then raise exception 'Not allowed'; end if;
  return jsonb_build_object(
    'sections', coalesce((select jsonb_agg(jsonb_build_object(
        'id', u.id, 'name', u.name, 'students', (select count(*) from public.v2_members m where m.unit_id = u.id and m.status = 'active'),
        'mayor_id', h.user_id, 'mayor_name', p.full_name,
        'open', (select count(*) from public.v2_directives d where d.issued_by = h.user_id and d.status in ('sent', 'received', 'working', 'done', 'revoke_asked')),
        'late', (select count(*) from public.v2_directives d where d.issued_by = h.user_id and d.status in ('sent', 'received', 'working') and d.due_on < today),
        'report_week', (select max(r.week_start) from public.v2_class_reports r where r.mayor_id = h.user_id),
        'report_reviewed', (select (r.reviewed_at is not null) from public.v2_class_reports r where r.mayor_id = h.user_id order by r.week_start desc limit 1),
        'asks_open', (select count(*) from public.v2_class_asks a where a.from_id = h.user_id and a.status = 'open')) order by u.year_level, u.name)
      from public.v2_units u
      left join public.v2_seat_holders h on h.unit_id = u.id and h.seat = 'mayor' and h.status in ('active', 'acting') and h.user_id is not null
      left join public.v2_profiles p on p.user_id = h.user_id
      where u.kind = 'section' and u.active), '[]'::jsonb),
    'officers', coalesce((select jsonb_object_agg(role, n) from (select role, count(*) n from public.v2_profiles group by role) x), '{}'::jsonb));
end $$;
grant execute on function public.v2_president_overview() to authenticated;
