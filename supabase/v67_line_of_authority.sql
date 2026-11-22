-- v67: the SAILS Line of Authority, step 1 (roles and reporting lines).
--   General Assembly -> SAILS President -> VP Internal, VP External, Secretary, Treasurer, Auditor, PIO, General Marshal
--   VP Internal -> Class Mayor. SAILS Secretary -> Class Secretary. SAILS Treasurer -> Class Treasurer.
--   General Marshal -> SAILS Marshals -> Class Marshals. The Auditor is independent (the Treasurer cannot direct the Auditor).
-- Run once in the Supabase SQL editor. Safe to run again.

-- 1. A Class Secretary role (keeps the class records; answers to the SAILS Secretary)
alter table public.v2_profiles drop constraint if exists v2_profiles_role_check;
alter table public.v2_profiles add constraint v2_profiles_role_check check (role = any (array[
  'pending','mayor','vp_internal','vp_external','secretary','treasurer','class_treasurer','class_secretary','auditor','marshall','pio','general_marshal','dept_marshal','sails_president']));

-- 2. Who may direct whom
create or replace function public.v2__directive_may(p_issuer text, p_assignee text) returns boolean
language sql immutable set search_path = '' as $$
  select case p_issuer
    when 'president' then p_assignee in ('vp_internal', 'vp_external', 'secretary', 'treasurer', 'auditor', 'pio', 'general_marshal')
    when 'vp_internal' then p_assignee in ('mayor')
    when 'secretary' then p_assignee in ('class_secretary')
    when 'treasurer' then p_assignee in ('class_treasurer')
    when 'general_marshal' then p_assignee in ('dept_marshal')
    when 'dept_marshal' then p_assignee in ('marshall')
    else false end
$$;

-- 3. The directive functions: the SAILS Secretary may issue, the President is named for every officer under him, and the app name in the phone alert
do $do$
declare f record; src text; old text;
begin
  for f in select p.oid from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('v2__directive_make', 'v2__directive_make_for') loop
    src := pg_get_functiondef(f.oid); old := src;
    src := replace(src, '''mayor'', ''sails_president'', ''vp_internal'', ''vp_external'', ''general_marshal'', ''treasurer'', ''dept_marshal''', '''mayor'', ''sails_president'', ''vp_internal'', ''vp_external'', ''general_marshal'', ''treasurer'', ''secretary'', ''dept_marshal''');
    src := replace(src, 'a.role in (''vp_internal'', ''vp_external'', ''general_marshal'') then ''the President''', 'a.role in (''vp_internal'', ''vp_external'', ''secretary'', ''treasurer'', ''auditor'', ''pio'', ''general_marshal'') then ''the President''');
    src := replace(src, 'when r = ''treasurer'' then ''the SAILS Treasurer''', 'when r = ''treasurer'' then ''the SAILS Treasurer'' when r = ''secretary'' then ''the SAILS Secretary''');
    if src <> old then execute src; end if;
  end loop;
  -- every server message that still says Alpha ’28
  for f in select p.oid from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.prosrc like '%Alpha ’28%' loop
    src := pg_get_functiondef(f.oid); execute replace(src, 'Alpha ’28', 'SAILS ’28');
  end loop;
end $do$;

-- 4. Who can see whom: the SAILS Secretary sees the Class Secretaries; the Class Mayor and the Auditor also see them
alter policy profiles_read on public.v2_profiles using (
  (user_id = (select auth.uid())) or public.v2_is_president()
  or (public.v2_role() = any (array['vp_internal','vp_external','general_marshal']))
  or ((public.v2_role() = any (array['mayor','auditor'])) and (role = any (array['vice_mayor','secretary','treasurer','class_treasurer','class_secretary','auditor','marshall','pio','sails'])))
  or ((public.v2_role() = 'treasurer') and (role = 'class_treasurer'))
  or ((public.v2_role() = 'secretary') and (role = 'class_secretary'))
  or ((public.v2_role() = 'dept_marshal') and (role = 'marshall'))
);

-- 5. Setup page check
do $do$ declare src text;
begin
  select pg_get_functiondef('public.v2_schema_marks()'::regprocedure) into src;
  if src not like '%''v67''%' then
    src := replace(src, E'  return mk;', E'  mk := mk || jsonb_build_object(''v67'', exists (select 1 from pg_constraint where conname = ''v2_profiles_role_check'' and pg_get_constraintdef(oid) like ''%class_secretary%''));\n  return mk;');
    execute src;
  end if;
end $do$;
