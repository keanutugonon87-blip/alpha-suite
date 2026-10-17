-- Alpha ’28 · v9 · Phone alerts for the Mayor and Vice Mayor on sign-in problems, plus a starting history
-- Run AFTER v8. Safe to run more than once. Paste all of it into Supabase > SQL Editor > Run.
--   • A phone alert when a student gets locked out (at most one per student per hour).
--   • A phone alert when 10 or more wrong PINs happen within 10 minutes (possible guessing).
--   • A phone alert when someone other than the Mayor resets a student's PIN.
--   Alerts go to the Mayor's and Vice Mayor's phones that turned on officer alerts (the same switch as sign-up alerts).
--   Also fills the sign-in history with what is already known (when each PIN was made, each student's last sign-in).

create or replace function public.v2__alert_staff(p_title text, p_body text) returns void
language plpgsql security definer set search_path = '' as $$
declare s text;
begin
  select convert_from(value, 'UTF8') into s from public.v2_secrets where key = 'push_hook';
  if s is null then return; end if;
  perform net.http_post(url := 'https://gxwgkbplscsduscoeoph.supabase.co/functions/v1/notify-announcement',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-secret', s),
    body := jsonb_build_object('kind', 'signup', 'title', p_title, 'body', p_body, 'url', './#/staff/system'));
exception when others then null;   -- an alert problem must never block a sign-in
end $$;
revoke all on function public.v2__alert_staff(text, text) from public, anon, authenticated;

create or replace function public.v2__log_login(p_member uuid, p_event text) returns void
language plpgsql security definer set search_path = '' as $$
declare nm text; actor text; actor_role text;
begin
  insert into public.v2_login_log(member_id, event) values (p_member, p_event);
  if random() < 0.05 then delete from public.v2_login_log where at < now() - interval '90 days'; end if;
  begin
    select full_name into nm from public.v2_members where id = p_member;
    if p_event = 'locked' and (select count(*) from public.v2_login_log where member_id = p_member and event = 'locked' and at > now() - interval '1 hour') = 1 then
      perform public.v2__alert_staff('🔒 Locked out: ' || coalesce(nm, 'a student'), 'Too many wrong PINs. If this was not them, reset their PIN. Open System > Sign-in security.');
    elsif p_event = 'fail' and (select count(*) from public.v2_login_log where event = 'fail' and at > now() - interval '10 minutes') = 10 then
      perform public.v2__alert_staff('⚠️ Many wrong PINs', '10 wrong PINs in 10 minutes. Someone may be guessing. Open System > Sign-in security.');
    elsif p_event = 'reset' then
      select full_name, role into actor, actor_role from public.v2_profiles where user_id = auth.uid();
      if actor_role is distinct from 'mayor' then
        perform public.v2__alert_staff('PIN reset: ' || coalesce(nm, 'a student'), coalesce(actor, 'An officer') || ' reset this PIN. Open System > Sign-in security to review.');
      end if;
    end if;
  exception when others then null;
  end;
end $$;
revoke all on function public.v2__log_login(uuid, text) from public, anon, authenticated;

-- Starting history from what the database already knows (only once per student)
insert into public.v2_login_log(at, member_id, event)
  select p.set_at, p.member_id, 'setup' from public.v2_member_pins p
  where p.set_at is not null and not exists (select 1 from public.v2_login_log l where l.member_id = p.member_id and l.event = 'setup');
insert into public.v2_login_log(at, member_id, event)
  select a.last_login_at, a.member_id, 'login' from public.v2_member_accounts a
  where a.last_login_at is not null and not exists (select 1 from public.v2_login_log l where l.member_id = a.member_id and l.event = 'login');
