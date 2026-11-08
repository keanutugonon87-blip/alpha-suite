-- v57 · The SAILS Marshals get Watch and QR scan inspection, limited to the students in their own block.
--  * A Department Marshal sees and reports only students whose section matches his block (Alpha, Bravo, Charlie or Delta).
--  * The General Marshal sees all four blocks.
--  * They can report violations and request a resolve. They cannot delete, collect fines or change the standards.
-- Requires v37 and v45. Safe to run twice.

create or replace function public.v2__marshal_sees(p_unit uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case public.v2_role()
    when 'general_marshal' then true
    when 'dept_marshal' then exists (
      select 1 from public.v2_marshal_blocks b
      join public.v2_units u on lower(u.section_name) = lower(b.letter) and u.kind = 'section'
      where b.user_id = auth.uid() and u.id = p_unit)
    else false end
$$;
revoke all on function public.v2__marshal_sees(uuid) from public, anon;
grant execute on function public.v2__marshal_sees(uuid) to authenticated;

drop policy if exists members_marshal_read on public.v2_members;
create policy members_marshal_read on public.v2_members for select to authenticated
  using (public.v2_role() in ('general_marshal', 'dept_marshal') and public.v2__marshal_sees(unit_id));

drop policy if exists standards_marshal_read on public.v2_standards;
create policy standards_marshal_read on public.v2_standards for select to authenticated
  using (public.v2_role() in ('general_marshal', 'dept_marshal'));

drop policy if exists periods_marshal_read on public.v2_periods;
create policy periods_marshal_read on public.v2_periods for select to authenticated
  using (public.v2_role() in ('general_marshal', 'dept_marshal'));

drop policy if exists violations_marshal_read on public.v2_violations;
create policy violations_marshal_read on public.v2_violations for select to authenticated
  using (public.v2_role() in ('general_marshal', 'dept_marshal')
         and exists (select 1 from public.v2_members m where m.id = member_id and public.v2__marshal_sees(m.unit_id)));

drop policy if exists violations_marshal_ins on public.v2_violations;
create policy violations_marshal_ins on public.v2_violations for insert to authenticated
  with check (public.v2_role() in ('general_marshal', 'dept_marshal')
              and exists (select 1 from public.v2_members m where m.id = member_id and public.v2__marshal_sees(m.unit_id)));

drop policy if exists violations_marshal_upd on public.v2_violations;
create policy violations_marshal_upd on public.v2_violations for update to authenticated
  using (public.v2_role() in ('general_marshal', 'dept_marshal')
         and exists (select 1 from public.v2_members m where m.id = member_id and public.v2__marshal_sees(m.unit_id)))
  with check (public.v2_role() in ('general_marshal', 'dept_marshal')
              and exists (select 1 from public.v2_members m where m.id = member_id and public.v2__marshal_sees(m.unit_id)));

-- QR cards: the Marshals may scan, but only students in their own block
do $$
declare d text;
begin
  select pg_get_functiondef('public.v2_resolve_token(text)'::regprocedure) into d;
  if d not like '%dept_marshal%' then
    d := replace(d, '''marshall'', ''sails'')', '''marshall'', ''sails'', ''dept_marshal'', ''general_marshal'')');
    d := replace(d, 'if m.id is null then raise exception ''Unknown student''; end if;',
      'if m.id is null then raise exception ''Unknown student''; end if;' || E'\n  ' ||
      'if public.v2_role() in (''dept_marshal'', ''general_marshal'') and not public.v2__marshal_sees(m.unit_id) then raise exception ''That student is not in your block''; end if;');
    if d not like '%v2__marshal_sees%' then raise exception 'v2_resolve_token was not in the expected shape'; end if;
    execute d;
  end if;
end $$;
