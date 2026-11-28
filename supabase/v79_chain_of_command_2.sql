-- v79: line of authority, second round (needs v78).
-- School-wide security, health and guest pages are for the SAILS President and VPs, not every Class Mayor.
-- Adding sections is the President's or VP Internal's. Student record requests are answered by the SAILS Secretary.
-- PIN resets and the sign-up lists are limited to the officer's own class (the President and VPs see all classes).

do $do$ declare r record; src text; n text;
begin
  for r in select p.oid, p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('v2_health', 'v2_security_overview', 'v2_login_stats', 'v2_guest_list', 'v2_backup_now', 'v2_watchdog_check', 'v2_officer_links', 'v2_review_officer_edit', 'v2_push_subscribe_staff') loop
    src := pg_get_functiondef(r.oid);
    n := replace(replace(src, 'public.v2_has_role(''mayor'', ''vice_mayor'')', '(public.v2_has_role(''vice_mayor'') or public.v2_is_president())'), 'public.v2_has_role(''mayor'',''vice_mayor'')', '(public.v2_has_role(''vice_mayor'') or public.v2_is_president())');
    if n = src then raise exception 'patch missed: %', r.proname; end if;
    execute n;
  end loop;
  for r in select p.oid from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'v2_unit_add_section' loop
    src := pg_get_functiondef(r.oid);
    n := replace(replace(src, 'not public.v2_has_role(''mayor'')', 'not (public.v2_is_real_president() or public.v2_role() = ''vp_internal'')'), 'Only the Mayor can add a section', 'Only the SAILS President or VP Internal can add a section');
    if n = src then raise exception 'patch missed: v2_unit_add_section'; end if;
    execute n;
  end loop;
  for r in select p.oid from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'v2_record_answer' loop
    src := pg_get_functiondef(r.oid);
    n := replace(src, 'not public.v2_has_role(''secretary'', ''mayor'')', 'not (public.v2_role() = ''secretary'' or public.v2_is_real_president())');
    if n = src then raise exception 'patch missed: v2_record_answer'; end if;
    execute n;
  end loop;
end $do$;

create or replace function public.v2_reset_member_pin(p_member uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare nm text;
begin
  if not (public.v2_has_role('mayor', 'treasurer') or public.v2_is_real_president()) then raise exception 'Only the Mayor or Treasurer can reset a PIN'; end if;
  if not exists (select 1 from public.v2_members m where m.id = p_member and public.v2__unit_ok(m.unit_id)) then raise exception 'You can reset PINs only for students of your own class'; end if;
  delete from public.v2_member_pins where member_id = p_member;
  perform public.v2__log_login(p_member, 'reset');
  select full_name into nm from public.v2_profiles where user_id = auth.uid();
  insert into public.v2_audit(actor, actor_name, action, table_name, row_id) values (auth.uid(), nm, 'PIN_RESET', 'v2_member_pins', p_member::text);
end $$;

create or replace function public.v2_pin_members() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.v2_has_role('mayor', 'vice_mayor', 'treasurer', 'secretary', 'auditor') or public.v2_is_president()) then raise exception 'Not allowed'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('member_id', p.member_id, 'locked', coalesce(p.locked_until > now(), false), 'set_at', p.set_at)), '[]'::jsonb)
          from public.v2_member_pins p join public.v2_members m on m.id = p.member_id where public.v2__unit_ok(m.unit_id));
end $$;

create or replace function public.v2_signup_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.v2_has_role('mayor', 'vice_mayor', 'secretary', 'treasurer') or public.v2_is_president()) then raise exception 'Not allowed'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('member_id', m.id, 'name', m.full_name, 'student_no', m.student_no, 'has_pin', p.member_id is not null, 'set_at', p.set_at, 'locked', coalesce(p.locked_until > now(), false), 'last_login_at', a.last_login_at) order by m.full_name), '[]'::jsonb)
          from public.v2_members m left join public.v2_member_pins p on p.member_id = m.id left join public.v2_member_accounts a on a.member_id = m.id
          where m.status = 'active' and public.v2__unit_ok(m.unit_id));
end $$;

revoke all on function public.v2_reset_member_pin(uuid), public.v2_pin_members(), public.v2_signup_status() from public, anon;
grant execute on function public.v2_reset_member_pin(uuid), public.v2_pin_members(), public.v2_signup_status() to authenticated;

do $do$ declare src text;
begin
  select pg_get_functiondef('public.v2_schema_marks()'::regprocedure) into src;
  if src not like '%''v79''%' then
    src := replace(src, E'  return mk;', E'  mk := mk || jsonb_build_object(''v79'', pg_get_functiondef(''public.v2_security_overview()''::regprocedure) like ''%v2_is_president%'');\n  return mk;');
    execute src;
  end if;
end $do$;
