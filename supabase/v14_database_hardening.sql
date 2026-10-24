-- Alpha ’28 · v14 · Database hardening
-- 1. A list of which SQL files have been run (shown on the System page, so nobody has to guess).
-- 2. The audit log becomes append-only: rows can be added but never changed or deleted, by anyone.
-- 3. A daily system check (7:00 AM Manila). If a scheduled job failed or stalled, or the backup is old, failed or unverified,
--    the Mayor and Vice Mayor get a phone alert, and the problems show on the System page.
-- 4. Backups record whether they were checked (needs the updated weekly-backup function to be deployed; until then it shows "not checked").
-- Safe to run more than once.

-- ===========================================================================
-- 1. Which SQL files are applied
-- ===========================================================================
create table if not exists public.v2_sql_applied (
  name text primary key, applied_at timestamptz not null default now(), how text not null default 'file');
alter table public.v2_sql_applied enable row level security;
revoke all on public.v2_sql_applied from anon, authenticated;

-- Files run before this one are recognised by what they left behind in the database.
insert into public.v2_sql_applied(name, how)
select n, 'detected' from (values
  ('v3', to_regclass('public.v2_reminders') is not null),
  ('v4', to_regclass('public.v2_month_close') is not null),
  ('v5', to_regclass('public.v2_waivers') is not null),
  ('v6', to_regclass('public.v2_member_pins') is not null),
  ('v7', to_regclass('public.v2_member_accounts') is not null),
  ('v8', to_regclass('public.v2_login_log') is not null),
  ('v9', to_regprocedure('public.v2__alert_staff(text,text)') is not null),
  ('v10', to_regclass('public.v2_duty_templates') is not null),
  ('v11', coalesce((select c.reloptions @> array['security_invoker=true'] from pg_class c where c.oid = to_regclass('public.fund_totals')), false)),
  ('v12', not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'log_collection' and has_function_privilege('anon', p.oid, 'execute'))
          and to_regclass('public.v2_duty_templates') is not null),
  ('v13', exists (select 1 from pg_extension e join pg_namespace s on s.oid = e.extnamespace where e.extname = 'pg_net' and s.nspname = 'extensions'))
) as t(n, present) where present
on conflict (name) do nothing;
insert into public.v2_sql_applied(name) values ('v14') on conflict (name) do nothing;

-- ===========================================================================
-- 2. Audit log: append-only
-- ===========================================================================
create or replace function public.v2__audit_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'The audit log is history. It can be added to but never changed or deleted.';
end $$;
revoke all on function public.v2__audit_guard() from public, anon, authenticated;
drop trigger if exists v2_audit_no_change on public.v2_audit;
create trigger v2_audit_no_change before update or delete on public.v2_audit for each row execute function public.v2__audit_guard();
drop trigger if exists v2_audit_no_truncate on public.v2_audit;
create trigger v2_audit_no_truncate before truncate on public.v2_audit for each statement execute function public.v2__audit_guard();
revoke update, delete, truncate on public.v2_audit from anon, authenticated;

-- ===========================================================================
-- 3. Backups remember whether they were checked
-- ===========================================================================
alter table public.v2_backup_log add column if not exists verified boolean;
alter table public.v2_backup_log add column if not exists verify_note text;

-- ===========================================================================
-- 4. The system check
-- ===========================================================================
create or replace function public.v2__problems() returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare probs text[] := '{}'; j record; lr timestamptz; ls text; gap interval; lastok timestamptz; lb record;
begin
  for j in select jobid, jobname, active from cron.job where jobname like 'alpha28-%' loop
    select r.start_time, r.status into lr, ls from cron.job_run_details r where r.jobid = j.jobid order by r.start_time desc limit 1;
    if not j.active then probs := array_append(probs, (j.jobname || ' is switched off')); continue; end if;
    if ls is not null and ls <> 'succeeded' and lr > now() - interval '2 days' then probs := array_append(probs, (j.jobname || ' failed at ' || to_char(lr at time zone 'Asia/Manila', 'Mon DD HH24:MI'))); end if;
    gap := case j.jobname when 'alpha28-duty-alerts' then interval '90 minutes' when 'alpha28-weekly-backup' then interval '9 days' else interval '30 hours' end;
    if lr is not null and lr < now() - gap then probs := array_append(probs, (j.jobname || ' has not run since ' || to_char(lr at time zone 'Asia/Manila', 'Mon DD HH24:MI'))); end if;
  end loop;
  select max(at) into lastok from public.v2_backup_log where ok;
  if lastok is null then probs := array_append(probs, 'No backup has been made yet');
  elsif lastok < now() - interval '8 days' then probs := array_append(probs, ('The last good backup is ' || extract(day from now() - lastok)::int || ' days old')); end if;
  select ok, verified into lb from public.v2_backup_log order by at desc limit 1;
  if found and lb.ok is false then probs := array_append(probs, 'The latest backup failed'); end if;
  if found and lb.verified is false then probs := array_append(probs, 'The latest backup could not be verified against the database'); end if;
  return probs;
end $$;
revoke all on function public.v2__problems() from public, anon, authenticated;

create or replace function public.v2_watchdog_check() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.v2_has_role('mayor', 'vice_mayor') then raise exception 'Not allowed'; end if;
  return to_jsonb(public.v2__problems());
end $$;
revoke all on function public.v2_watchdog_check() from public, anon;
grant execute on function public.v2_watchdog_check() to authenticated;

-- Daily: alert once per day while the same problems remain
create or replace function public.v2_watchdog() returns int
language plpgsql security definer set search_path = '' as $$
declare probs text[] := public.v2__problems(); sig text; today text := ((now() at time zone 'Asia/Manila')::date)::text;
begin
  if coalesce(array_length(probs, 1), 0) = 0 then
    delete from public.v2_settings where key = 'watchdog_last';
    return 0;
  end if;
  sig := today || ':' || md5(array_to_string(probs, '|'));
  if coalesce(public.v2__setting('watchdog_last'), '') = sig then return array_length(probs, 1); end if;
  insert into public.v2_settings(key, value) values ('watchdog_last', sig) on conflict (key) do update set value = excluded.value;
  perform public.v2__alert_staff('⚠️ System check: ' || array_length(probs, 1) || ' problem' || case when array_length(probs, 1) = 1 then '' else 's' end,
    left(array_to_string(probs[1:2], '. ') || case when array_length(probs, 1) > 2 then ' and more.' else '.' end, 180));
  return array_length(probs, 1);
end $$;
revoke all on function public.v2_watchdog() from public, anon, authenticated;
select cron.schedule('alpha28-watchdog', '0 23 * * *', $$select public.v2_watchdog()$$);   -- 23:00 UTC = 7:00 AM Manila

-- ===========================================================================
-- 5. The health page gets the new facts (same function as before, plus 'problems', 'applied', and backup check results)
-- ===========================================================================
create or replace function public.v2_health() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.v2_has_role('mayor', 'vice_mayor') then raise exception 'Not allowed'; end if;
  return jsonb_build_object(
    'now', now(),
    'members', (select count(*) from public.v2_members where status = 'active'),
    'linked', (select count(distinct member_id) from public.v2_push_subs where member_id is not null),
    'staff_devices', (select count(*) from public.v2_push_subs where user_id is not null),
    'open_charges', (select count(*) from public.v2_charges where not closed),
    'pending_entries', (select count(*) from public.v2_entries where status = 'pending'),
    'last_backup', (select to_jsonb(b) from (select at, ok, name, bytes, verified, verify_note from public.v2_backup_log order by at desc limit 1) b),
    'last_ok_backup', (select max(at) from public.v2_backup_log where ok),
    'last_reminder', (select max(created_at) from public.v2_reminders),
    'auto_nudge', coalesce(public.v2__setting('auto_nudge'), 'off'),
    'threshold', coalesce(public.v2__setting('expense_second_approval'), '500'),
    'pay_note', coalesce(public.v2__setting('pay_note'), ''),
    'problems', to_jsonb(public.v2__problems()),
    'applied', (select coalesce(jsonb_agg(name order by name), '[]'::jsonb) from public.v2_sql_applied),
    'jobs', (select coalesce(jsonb_agg(jsonb_build_object('name', j.jobname, 'schedule', j.schedule, 'active', j.active,
        'last_run', (select r.start_time from cron.job_run_details r where r.jobid = j.jobid order by r.start_time desc limit 1),
        'last_status', (select r.status from cron.job_run_details r where r.jobid = j.jobid order by r.start_time desc limit 1))), '[]'::jsonb)
      from cron.job j where j.jobname like 'alpha28-%'));
end $$;
revoke all on function public.v2_health() from public, anon;
grant execute on function public.v2_health() to authenticated;
