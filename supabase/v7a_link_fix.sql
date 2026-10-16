-- Alpha ’28 · v7a · fix: linking an officer to a student who already made a PIN. Safe to run more than once.
create or replace function public.v2_link_officer(p_user uuid, p_member uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare nm text;
begin
  if not public.v2_has_role('mayor') then raise exception 'Only the Mayor can link an officer to a student'; end if;
  if not exists (select 1 from public.v2_profiles where user_id = p_user) then raise exception 'Unknown officer account'; end if;
  if not exists (select 1 from public.v2_members where id = p_member and status = 'active') then raise exception 'Pick an active student'; end if;
  -- If this student already made a plain student account (by creating a PIN), the officer account takes its place. The PIN stays.
  delete from auth.users where id in (select user_id from public.v2_member_accounts where member_id = p_member and user_id <> p_user and kind = 'student');
  if exists (select 1 from public.v2_member_accounts where member_id = p_member and user_id <> p_user) then raise exception 'That student is already linked to another officer'; end if;
  delete from public.v2_member_accounts where user_id = p_user and member_id <> p_member;
  -- 30 days of grace: the officer keeps working with their current sign-in while they set up their PIN
  insert into public.v2_member_accounts(member_id, user_id, kind, last_login_at) values (p_member, p_user, 'officer', now())
    on conflict (member_id) do update set kind = 'officer';
  select full_name into nm from public.v2_profiles where user_id = auth.uid();
  insert into public.v2_audit(actor, actor_name, action, table_name, row_id) values (auth.uid(), nm, 'LINK', 'v2_member_accounts', p_user::text);
end $$;
revoke all on function public.v2_link_officer(uuid, uuid) from public, anon;
grant execute on function public.v2_link_officer(uuid, uuid) to authenticated;
