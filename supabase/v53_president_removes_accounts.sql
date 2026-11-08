-- v53 · Only the SAILS President approves or removes accounts. A Class Mayor can no longer delete an account.
-- (Approval was already President-only in v51.) The Class Mayor can still move his class officers between class roles.
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
