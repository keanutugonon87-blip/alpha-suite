-- v51 · Account creation requests are reviewed and approved by the SAILS President only.
--  * A Class Mayor no longer sees pending sign-ups and cannot approve or reject them.
--  * A Class Mayor can still move his own class officers between class roles. Everything else about roles stays with the President.
-- Requires v48 and v49. Safe to run twice.

drop policy if exists profiles_read on public.v2_profiles;
create policy profiles_read on public.v2_profiles for select to authenticated using (
  user_id = (select auth.uid())
  or public.v2_is_president()
  or public.v2_role() in ('vp_internal', 'vp_external', 'general_marshal')
  or (public.v2_role() in ('mayor', 'auditor') and role in ('vice_mayor', 'secretary', 'treasurer', 'auditor', 'marshall', 'pio', 'sails')));

drop policy if exists profiles_mayor_upd on public.v2_profiles;
create policy profiles_mayor_upd on public.v2_profiles for update to authenticated
  using (user_id = (select auth.uid()) or public.v2_is_real_president()
         or (public.v2_role() = 'mayor' and role in ('vice_mayor', 'secretary', 'treasurer', 'auditor', 'marshall', 'pio', 'sails')))
  with check (user_id = (select auth.uid()) or public.v2_is_real_president()
         or (public.v2_role() = 'mayor' and role in ('vice_mayor', 'secretary', 'treasurer', 'auditor', 'marshall', 'pio', 'sails')));
drop policy if exists profiles_mayor_del on public.v2_profiles;
create policy profiles_mayor_del on public.v2_profiles for delete to authenticated
  using (user_id <> (select auth.uid()) and (public.v2_is_real_president()
         or (public.v2_role() = 'mayor' and role in ('vice_mayor', 'secretary', 'treasurer', 'auditor', 'marshall', 'pio', 'sails'))));

create or replace function public.v2_profile_role_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r text := public.v2_role();
begin
  if new.role is distinct from old.role and auth.uid() is not null then
    if old.user_id = auth.uid() then raise exception 'You cannot change your own role'; end if;
    if new.role = 'sails_president' and public.v2_president_exists() then raise exception 'The SAILS President role is given in the database only'; end if;
    if public.v2_is_real_president() then
      null;
    elsif r = 'mayor' then
      if old.role not in ('vice_mayor', 'secretary', 'treasurer', 'auditor', 'marshall', 'pio', 'sails')
         or new.role not in ('vice_mayor', 'secretary', 'treasurer', 'auditor', 'marshall', 'pio', 'sails') then
        raise exception 'The SAILS President approves new accounts and assigns that role';
      end if;
    else
      raise exception 'You cannot change roles';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.v2_profile_role_guard() from public, anon;
