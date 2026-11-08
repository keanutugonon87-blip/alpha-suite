-- v53 · Only the SAILS President manages accounts: approve, remove and change roles. A Class Mayor has no account admin.
-- (Approval was already President-only in v51.)
-- Safe to run twice.
drop policy if exists profiles_mayor_del on public.v2_profiles;
create policy profiles_mayor_del on public.v2_profiles for delete to authenticated
  using (user_id <> (select auth.uid()) and public.v2_is_real_president());

do $$
declare d text;
begin
  select pg_get_functiondef('public.v2_delete_account(uuid)'::regprocedure) into d;
  d := replace(d, 'if not public.v2_has_role(''mayor'') then raise exception ''Only the Mayor can delete accounts''; end if;',
                  'if not public.v2_is_real_president() then raise exception ''Only the SAILS President can remove accounts''; end if;');
  if d not like '%Only the SAILS President can remove accounts%' and d not like '%v2_is_real_president()%' then
    raise exception 'v2_delete_account was not in the expected shape';
  end if;
  execute d;
end $$;

-- Class Mayor can no longer edit other people's profiles or change roles
drop policy if exists profiles_mayor_upd on public.v2_profiles;
create policy profiles_mayor_upd on public.v2_profiles for update to authenticated
  using (user_id = (select auth.uid()) or public.v2_is_real_president())
  with check (user_id = (select auth.uid()) or public.v2_is_real_president());

create or replace function public.v2_profile_role_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null then
    if old.user_id = auth.uid() then raise exception 'You cannot change your own role'; end if;
    if new.role = 'sails_president' and public.v2_president_exists() then raise exception 'The SAILS President role is given in the database only'; end if;
    if not public.v2_is_real_president() then raise exception 'Only the SAILS President manages accounts and roles'; end if;
  end if;
  return new;
end $$;
revoke all on function public.v2_profile_role_guard() from public, anon;
