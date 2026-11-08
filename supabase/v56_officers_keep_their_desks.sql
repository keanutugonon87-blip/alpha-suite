-- v56 · The SAILS Secretary, Treasurer, PIO and Marshal keep their own desks and tools.
-- v46 treated them as locked class officers (inbox only). They are SAILS officers; only the name changed.
-- Safe to run twice.
create or replace function public.v2_role() returns text
language sql stable security definer set search_path = '' as $$
  select p.role
  from public.v2_profiles p
  where p.user_id = auth.uid()
    and (not exists (select 1 from public.v2_member_accounts a where a.user_id = p.user_id)
         or exists (select 1 from public.v2_member_accounts a join public.v2_members m on m.id = a.member_id
                    where a.user_id = p.user_id and m.status = 'active' and a.last_login_at > now() - interval '30 days'))
$$;
