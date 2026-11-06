-- v43 · Line of authority: the SAILS President decides, the Vice Presidents work.
-- Before, the Mayor/President could open, add to, edit and delete everything inside the VP desks.
-- Now the VP desks belong to the Vice Presidents (and the Vice Mayor). The President:
--   * sees and decides on what is SENT UP: meetings/programs, partners and joint activities (approve, or return with a note), and records from the Secretary;
--   * can no longer read or change the VPs' working lists (tasks, resolutions, representations, council items);
--   * gives tasks through Directives, not by writing into the VP desks.
-- The President can change only the stage (status) and the approval note of a proposal, never what the VP wrote.
-- Run v28 first. Safe to run twice.

-- 1. Working lists: only the VPs and the Vice Mayor can read or write them
do $$ declare t text; begin
  foreach t in array array['v2_vp_tasks', 'v2_vp_resolutions', 'v2_vp_reps', 'v2_vp_council'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.v2_has_role(''vice_mayor''))', t || '_read', t);
  end loop;
end $$;
drop policy if exists vp_tasks_write on public.v2_vp_tasks;
create policy vp_tasks_write on public.v2_vp_tasks for all to authenticated
  using (public.v2_has_role('vice_mayor')) with check (public.v2_has_role('vice_mayor'));
drop policy if exists vp_res_write on public.v2_vp_resolutions;
create policy vp_res_write on public.v2_vp_resolutions for all to authenticated
  using (public.v2_role() in ('vp_internal', 'vice_mayor')) with check (public.v2_role() in ('vp_internal', 'vice_mayor'));
drop policy if exists vp_reps_write on public.v2_vp_reps;
create policy vp_reps_write on public.v2_vp_reps for all to authenticated
  using (public.v2_role() in ('vp_external', 'vice_mayor')) with check (public.v2_role() in ('vp_external', 'vice_mayor'));
drop policy if exists vp_council_write on public.v2_vp_council;
create policy vp_council_write on public.v2_vp_council for all to authenticated
  using (public.v2_role() in ('vp_external', 'vice_mayor')) with check (public.v2_role() in ('vp_external', 'vice_mayor'));

-- 2. Proposals: the VPs write them; the President can only move the stage
drop policy if exists vp_meetings_write on public.v2_vp_meetings;
create policy vp_meetings_write on public.v2_vp_meetings for all to authenticated
  using (public.v2_role() in ('vp_internal', 'vice_mayor')) with check (public.v2_role() in ('vp_internal', 'vice_mayor'));
drop policy if exists vp_partners_write on public.v2_vp_partners;
create policy vp_partners_write on public.v2_vp_partners for all to authenticated
  using (public.v2_role() in ('vp_external', 'vice_mayor')) with check (public.v2_role() in ('vp_external', 'vice_mayor'));
drop policy if exists vp_acts_write on public.v2_vp_activities;
create policy vp_acts_write on public.v2_vp_activities for all to authenticated
  using (public.v2_role() in ('vp_external', 'vice_mayor')) with check (public.v2_role() in ('vp_external', 'vice_mayor'));
do $$ declare t text; begin
  foreach t in array array['v2_vp_meetings', 'v2_vp_partners', 'v2_vp_activities'] loop
    execute format('drop policy if exists %I on public.%I', t || '_president_decides', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.v2_role() = ''mayor'') with check (public.v2_role() = ''mayor'')', t || '_president_decides', t);
  end loop;
end $$;

create or replace function public.v2_vp_president_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if public.v2_role() = 'mayor' and tg_op = 'UPDATE'
     and (to_jsonb(new) - 'status' - 'mayor_note' - 'updated_at') is distinct from (to_jsonb(old) - 'status' - 'mayor_note' - 'updated_at') then
    raise exception 'The President approves or returns a proposal. The Vice President who wrote it changes what it says.';
  end if;
  return new;
end $$;
revoke all on function public.v2_vp_president_limit() from public, anon;
do $$ declare t text; begin
  foreach t in array array['v2_vp_meetings', 'v2_vp_partners', 'v2_vp_activities'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_zpresident', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.v2_vp_president_limit()', t || '_zpresident', t);
  end loop;
end $$;
