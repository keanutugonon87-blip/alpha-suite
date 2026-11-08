-- v52 · The Vice Mayor and SAILS Officer roles are retired. Nobody can be given them any more.
-- No account holds either role. Safe to run twice. The Class Mayor still moves his class officers between the five class roles.
alter table public.v2_profiles drop constraint if exists v2_profiles_role_check;
alter table public.v2_profiles add constraint v2_profiles_role_check
  check (role in ('pending', 'mayor', 'vp_internal', 'vp_external', 'secretary', 'treasurer', 'auditor', 'marshall', 'pio', 'general_marshal', 'dept_marshal', 'sails_president'));

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
      if old.role not in ('secretary', 'treasurer', 'auditor', 'marshall', 'pio')
         or new.role not in ('secretary', 'treasurer', 'auditor', 'marshall', 'pio') then
        raise exception 'The SAILS President approves new accounts and assigns that role';
      end if;
    else
      raise exception 'You cannot change roles';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.v2_profile_role_guard() from public, anon;
