-- v72: Attendance monitoring and all event reports move from the SAILS Secretary to the SAILS VP External.
-- The VP External (and the Class Mayor for his own section) sets events, compiles absences and sends the fines report.
-- The SAILS Secretary keeps the records work. The Class Secretary still scans. Run once; safe to run again.

do $do$
declare src text;
begin
  -- compile
  select pg_get_functiondef('public.v2_event_compile(uuid,uuid[])'::regprocedure) into src;
  src := replace(src, '''mayor'', ''secretary''', '''mayor'', ''vp_external''');
  src := replace(src, 'Only the Secretary or Mayor can compile attendance', 'Only the SAILS VP External or the Class Mayor can compile attendance');
  src := replace(src, '''Secretary '' || who', '''VP External '' || who');
  execute src;
  -- send report
  select pg_get_functiondef('public.v2_event_send_report(uuid,text)'::regprocedure) into src;
  src := replace(src, '''mayor'', ''secretary''', '''mayor'', ''vp_external''');
  src := replace(src, 'Only the Secretary or Mayor can send the report', 'Only the SAILS VP External or the Class Mayor can send the report');
  execute src;
  -- notify (message only)
  select pg_get_functiondef('public.v2_event_notify(uuid)'::regprocedure) into src;
  src := replace(src, 'The Secretary has not sent the report yet', 'The SAILS VP External has not sent the report yet');
  execute src;
  -- event order: Class Mayor or VP External; scanners can no longer be the SAILS Secretary
  select pg_get_functiondef('public.v2_event_order(uuid,uuid[],text)'::regprocedure) into src;
  src := replace(src, 'if public.v2_role() <> ''mayor'' then raise exception ''Only the Mayor issues an event order''; end if;',
                      'if public.v2_role() not in (''mayor'', ''vp_external'') then raise exception ''Only the Class Mayor or the SAILS VP External issues an event order''; end if;');
  src := replace(src, '''mayor'', ''vice_mayor'', ''vp_internal'', ''vp_external'', ''secretary'', ''marshall'', ''sails''',
                      '''mayor'', ''vp_internal'', ''vp_external'', ''class_secretary'', ''general_marshal'', ''marshall'', ''sails''');
  execute src;
end $do$;

-- who may create / close / delete events and scan
alter policy events_write on public.v2_events
  using (public.v2_has_role(variadic array['mayor', 'vp_external']) and public.v2__unit_ok(unit_id))
  with check (public.v2_has_role(variadic array['mayor', 'vp_external']) and public.v2__unit_ok(unit_id));
alter policy escans_insert on public.v2_event_scans
  with check ((public.v2_has_role(variadic array['mayor', 'vp_external', 'marshall', 'sails']) or public.v2_role() = 'class_secretary')
    and public.v2__unit_ok((select e.unit_id from public.v2_events e where e.id = event_id)));
alter policy escans_delete on public.v2_event_scans
  using ((public.v2_has_role(variadic array['mayor', 'vp_external'])
          or (scanned_by = auth.uid() and (public.v2_has_role(variadic array['marshall', 'sails']) or public.v2_role() = 'class_secretary')))
    and public.v2__unit_ok((select e.unit_id from public.v2_events e where e.id = event_id)));

do $do$ declare src text;
begin
  select pg_get_functiondef('public.v2_schema_marks()'::regprocedure) into src;
  if src not like '%''v72''%' then
    src := replace(src, E'  return mk;', E'  mk := mk || jsonb_build_object(''v72'', pg_get_functiondef(''public.v2_event_compile(uuid,uuid[])''::regprocedure) like ''%vp_external%'');\n  return mk;');
    execute src;
  end if;
end $do$;
