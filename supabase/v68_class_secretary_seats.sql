-- v68: Line of Authority step 2: the Class Secretary can take attendance, and the seat list matches the new chart.
-- Run once in the Supabase SQL editor. Safe to run again.

-- 1. Seat list: a class has a Mayor, a Secretary, a Treasurer and one Marshal (no Vice Mayor or PIO seats); SAILS has the officers and marshals of the chart
delete from public.v2_seat_types t where t.unit_kind = 'section' and t.seat in ('vice_mayor', 'pio')
  and not exists (select 1 from public.v2_seat_holders h join public.v2_units u on u.id = h.unit_id and u.kind = 'section' where h.seat = t.seat);
update public.v2_seat_types set seats = 1 where unit_kind = 'section' and seat = 'marshal';
update public.v2_seat_types set app_role = 'class_secretary' where unit_kind = 'section' and seat = 'secretary';
update public.v2_seat_types set app_role = 'class_treasurer' where unit_kind = 'section' and seat = 'treasurer';
update public.v2_seat_types set app_role = 'dept_marshal', label = 'SAILS Marshal' where unit_kind = 'department' and seat = 'marshal';
update public.v2_seat_types set app_role = 'general_marshal' where unit_kind = 'department' and seat = 'general_marshal';
update public.v2_seat_types set app_role = 'sails_president' where unit_kind = 'department' and seat = 'president';

-- 2. The Class Secretary takes attendance (scans at events) like the other class officers
alter policy escans_insert on public.v2_event_scans with check (public.v2_has_role('mayor', 'vice_mayor', 'secretary', 'marshall', 'sails') or public.v2_role() = 'class_secretary');
alter policy escans_delete on public.v2_event_scans using (
  public.v2_has_role('mayor', 'vice_mayor') or ((scanned_by = auth.uid()) and (public.v2_has_role('secretary', 'marshall', 'sails') or public.v2_role() = 'class_secretary')));

-- 3. Setup page check
do $do$ declare src text;
begin
  select pg_get_functiondef('public.v2_schema_marks()'::regprocedure) into src;
  if src not like '%''v68''%' then
    src := replace(src, E'  return mk;', E'  mk := mk || jsonb_build_object(''v68'', not exists (select 1 from public.v2_seat_types where unit_kind = ''section'' and seat = ''secretary'' and app_role <> ''class_secretary''));\n  return mk;');
    execute src;
  end if;
end $do$;
