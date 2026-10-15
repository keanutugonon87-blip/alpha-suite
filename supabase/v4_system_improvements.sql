-- Alpha ’28 — system improvements: backup log + health, month close, second approval for big expenses,
-- reminder roster + automatic due-date nudges, payment note, rotate alert secret.
-- Run once in the Supabase SQL editor (project gxwgkbplscsduscoeoph). Safe to run again.
-- Needs v3_reminders_statements_backups.sql to have been run first.

-- ===========================================================================
-- 0. Small settings (Mayor edits them in the app: System tab)
-- ===========================================================================
create or replace function public.v2__setting(k text) returns text
language sql stable security definer set search_path = '' as $$ select value from public.v2_settings where key = k $$;
revoke all on function public.v2__setting(text) from public, anon, authenticated;

create or replace function public.v2_set_setting(p_key text, p_value text) returns void
language plpgsql security definer set search_path = '' as $$
declare v text := btrim(coalesce(p_value, ''));
begin
  if p_key = 'pay_note' then
    if not public.v2_has_role('mayor', 'treasurer') then raise exception 'Only the Mayor or Treasurer can change this'; end if;
    if length(v) > 300 then raise exception 'Keep the payment note under 300 characters'; end if;
  elsif p_key = 'expense_second_approval' then
    if not public.v2_has_role('mayor') then raise exception 'Only the Mayor can change this'; end if;
    if v !~ '^\d{1,7}(\.\d{1,2})?$' then raise exception 'Enter an amount in pesos (0 turns the rule off)'; end if;
  elsif p_key = 'auto_nudge' then
    if not public.v2_has_role('mayor') then raise exception 'Only the Mayor can change this'; end if;
    if v not in ('on', 'off') then raise exception 'Use on or off'; end if;
  else raise exception 'Unknown setting'; end if;
  insert into public.v2_settings(key, value) values (p_key, v) on conflict (key) do update set value = excluded.value;
end $$;
revoke all on function public.v2_set_setting(text, text) from public, anon;
grant execute on function public.v2_set_setting(text, text) to authenticated;

-- Shown to students on My Status (e.g. "GCash 09xx xxx xxxx · Treasurer name"). Empty until the Treasurer writes it.
create or replace function public.v2_public_pay_note() returns text
language sql stable security definer set search_path = '' as $$ select coalesce(public.v2__setting('pay_note'), '') $$;
grant execute on function public.v2_public_pay_note() to anon, authenticated;

-- ===========================================================================
-- 1. Backup log (the backup function writes one row per run) + health page + rotate the alert secret
-- ===========================================================================
create table if not exists public.v2_backup_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  ok boolean not null, name text, bytes int, errors jsonb, note text);
alter table public.v2_backup_log enable row level security;
drop policy if exists v2_backup_log_read on public.v2_backup_log;
create policy v2_backup_log_read on public.v2_backup_log for select to authenticated using (public.v2_has_role('mayor', 'vice_mayor'));

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
    'last_backup', (select to_jsonb(b) from (select at, ok, name, bytes from public.v2_backup_log order by at desc limit 1) b),
    'last_ok_backup', (select max(at) from public.v2_backup_log where ok),
    'last_reminder', (select max(created_at) from public.v2_reminders),
    'auto_nudge', coalesce(public.v2__setting('auto_nudge'), 'off'),
    'threshold', coalesce(public.v2__setting('expense_second_approval'), '500'),
    'pay_note', coalesce(public.v2__setting('pay_note'), ''),
    'jobs', (select coalesce(jsonb_agg(jsonb_build_object('name', j.jobname, 'schedule', j.schedule, 'active', j.active,
        'last_run', (select r.start_time from cron.job_run_details r where r.jobid = j.jobid order by r.start_time desc limit 1),
        'last_status', (select r.status from cron.job_run_details r where r.jobid = j.jobid order by r.start_time desc limit 1))), '[]'::jsonb)
      from cron.job j where j.jobname like 'alpha28-%'));
end $$;
revoke all on function public.v2_health() from public, anon;
grant execute on function public.v2_health() to authenticated;

-- New random key for the shared secret that the database and the edge functions use to talk to each other.
-- The functions read it from the database on every call, so nothing else needs changing.
create or replace function public.v2_rotate_hook_secret() returns void
language plpgsql security definer set search_path = '' as $$
declare nm text;
begin
  if not public.v2_has_role('mayor') then raise exception 'Only the Mayor can do this'; end if;
  update public.v2_secrets set value = convert_to(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'UTF8') where key = 'push_hook';
  select full_name into nm from public.v2_profiles where user_id = auth.uid();
  insert into public.v2_audit(actor, actor_name, action, table_name, row_id) values (auth.uid(), nm, 'ROTATE', 'v2_secrets', 'push_hook');
end $$;
revoke all on function public.v2_rotate_hook_secret() from public, anon;
grant execute on function public.v2_rotate_hook_secret() to authenticated;

-- ===========================================================================
-- 2. Month close: the Auditor/Vice Mayor counts the money, the Mayor closes the month, then it is locked
-- ===========================================================================
create table if not exists public.v2_month_close (
  month text primary key check (month ~ '^\d{4}-\d{2}$'),
  status text not null default 'checked' check (status in ('checked', 'closed', 'reopened')),
  system_balance numeric not null, cash_counted numeric not null, diff numeric not null, note text,
  checked_by uuid, checked_by_name text, checked_at timestamptz not null default now(),
  closed_by uuid, closed_by_name text, closed_at timestamptz, reopen_reason text,
  id uuid not null default gen_random_uuid());
alter table public.v2_month_close enable row level security;
drop policy if exists v2_month_close_read on public.v2_month_close;
create policy v2_month_close_read on public.v2_month_close for select to authenticated using (public.v2_is_staff());
drop trigger if exists v2_month_close_audit on public.v2_month_close;
create trigger v2_month_close_audit after insert or delete or update on public.v2_month_close for each row execute function public.v2_audit_trigger();

-- Fund balance at the end of a month (Manila time): first opening balance + every approved entry up to and including that month.
create or replace function public.v2__balance_at(p_month text) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce((select opening_balance from public.v2_periods order by opened_at limit 1), 0)
       + coalesce((select sum(case when kind = 'collection' then amount else -amount end) from public.v2_entries
                   where status = 'approved' and to_char(occurred_at at time zone 'Asia/Manila', 'YYYY-MM') <= p_month), 0)
$$;
revoke all on function public.v2__balance_at(text) from public, anon, authenticated;

create or replace function public.v2_verify_month(p_month text, p_cash numeric, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare sys numeric; d numeric; nm text; cur text := to_char(now() at time zone 'Asia/Manila', 'YYYY-MM');
begin
  if not public.v2_has_role('auditor', 'vice_mayor', 'treasurer', 'mayor') then raise exception 'Only the Auditor, Vice Mayor, Treasurer or Mayor can verify a month'; end if;
  if p_month !~ '^\d{4}-\d{2}$' or p_month > cur then raise exception 'Pick a month that has started'; end if;
  if p_cash is null or p_cash < 0 then raise exception 'Enter the money counted (cash plus GCash)'; end if;
  if exists (select 1 from public.v2_month_close where month = p_month and status = 'closed') then raise exception 'That month is already closed'; end if;
  sys := public.v2__balance_at(p_month); d := round(p_cash - sys, 2);
  if d <> 0 and btrim(coalesce(p_note, '')) = '' then raise exception 'The count is off by ₱% compared with the records. Add a note that explains the difference', d; end if;
  select full_name into nm from public.v2_profiles where user_id = auth.uid();
  insert into public.v2_month_close(month, status, system_balance, cash_counted, diff, note, checked_by, checked_by_name, checked_at)
  values (p_month, 'checked', sys, p_cash, d, nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), nm, now())
  on conflict (month) do update set status = 'checked', system_balance = excluded.system_balance, cash_counted = excluded.cash_counted, diff = excluded.diff,
    note = excluded.note, checked_by = excluded.checked_by, checked_by_name = excluded.checked_by_name, checked_at = now(), closed_by = null, closed_by_name = null, closed_at = null;
  return jsonb_build_object('system_balance', sys, 'diff', d);
end $$;
revoke all on function public.v2_verify_month(text, numeric, text) from public, anon;
grant execute on function public.v2_verify_month(text, numeric, text) to authenticated;

create or replace function public.v2_close_month(p_month text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.v2_month_close; nm text; pend int;
begin
  if not public.v2_has_role('mayor') then raise exception 'Only the Mayor can close a month'; end if;
  select * into r from public.v2_month_close where month = p_month;
  if r.month is null or r.status <> 'checked' then raise exception 'Someone must verify the month first'; end if;
  if r.checked_by = auth.uid() then raise exception 'A different officer (Treasurer, Auditor or Vice Mayor) must verify the count before you close it'; end if;
  select count(*) into pend from public.v2_entries where status = 'pending' and to_char(occurred_at at time zone 'Asia/Manila', 'YYYY-MM') = p_month;
  if pend > 0 then raise exception '% entr% still waiting for approval in that month', pend, case when pend = 1 then 'y is' else 'ies are' end; end if;
  if public.v2__balance_at(p_month) <> r.system_balance then raise exception 'The records changed after the count. Verify the month again'; end if;
  select full_name into nm from public.v2_profiles where user_id = auth.uid();
  update public.v2_month_close set status = 'closed', closed_by = auth.uid(), closed_by_name = nm, closed_at = now() where month = p_month;
end $$;
revoke all on function public.v2_close_month(text) from public, anon;
grant execute on function public.v2_close_month(text) to authenticated;

create or replace function public.v2_reopen_month(p_month text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.v2_has_role('mayor') then raise exception 'Only the Mayor can reopen a month'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Give a reason for reopening'; end if;
  update public.v2_month_close set status = 'reopened', reopen_reason = btrim(p_reason) where month = p_month and status = 'closed';
  if not found then raise exception 'That month is not closed'; end if;
end $$;
revoke all on function public.v2_reopen_month(text, text) from public, anon;
grant execute on function public.v2_reopen_month(text, text) to authenticated;

-- ===========================================================================
-- 3. Entry guard: keeps the old rules, adds (a) second approval for big expenses and (b) the closed-month lock
-- ===========================================================================
create or replace function public.v2_entries_before() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r text := public.v2_role(); thr numeric := coalesce(nullif(public.v2__setting('expense_second_approval'), '')::numeric, 500);
        second boolean; mn text; mo text; human boolean := auth.uid() is not null;   -- no signed-in officer = SQL editor / maintenance script: the rules below do not apply
begin
  second := human and new.kind = 'expense' and thr > 0 and new.amount >= thr and coalesce(new.source, 'manual') = 'manual';
  if tg_op = 'INSERT' then
    if new.kind = 'collection' and new.receipt_no is null then
      new.receipt_no := 'AT-' || to_char(now() at time zone 'Asia/Manila', 'YYYY') || '-' || lpad(nextval('public.v2_receipt_seq')::text, 6, '0');
    end if;
    if new.recorded_by is null then new.recorded_by := auth.uid(); end if;
    if r = 'treasurer' then new.status := 'pending'; end if;   -- treasurer entries wait for the Mayor
    if second and new.status = 'approved' then new.status := 'pending'; new.approved_by_name := null; end if;   -- big expenses always need a second officer
    if new.period_id is not null and not exists (select 1 from public.v2_periods where id = new.period_id and status = 'open') then
      raise exception 'That period is closed';
    end if;
  else
    if human and new.status is distinct from old.status and new.status = 'approved' then
      if coalesce(current_setting('alpha.approving', true), '') = '1' then null;   -- came through v2_approve_entry
      elsif r is distinct from 'mayor' then raise exception 'Only the Mayor can approve entries';
      elsif second then raise exception 'This expense needs a second officer to approve it';
      end if;
    end if;
    if old.status = 'voided' then raise exception 'Voided entries cannot be changed'; end if;
    if new.status = 'voided' then new.voided_at := now(); end if;
  end if;
  -- closed-month lock: money fields cannot change (moving a pending entry to the next period is still fine)
  if human and (tg_op = 'INSERT' or (new.amount, new.kind, new.status, new.occurred_at, new.member_id, new.charge_id, new.fund)
                         is distinct from (old.amount, old.kind, old.status, old.occurred_at, old.member_id, old.charge_id, old.fund)) then
    mn := to_char(new.occurred_at at time zone 'Asia/Manila', 'YYYY-MM');
    if exists (select 1 from public.v2_month_close where month = mn and status = 'closed') then raise exception 'The month % is closed. The Mayor can reopen it.', mn; end if;
    if tg_op = 'UPDATE' then
      mo := to_char(old.occurred_at at time zone 'Asia/Manila', 'YYYY-MM');
      if mo <> mn and exists (select 1 from public.v2_month_close where month = mo and status = 'closed') then raise exception 'The month % is closed. The Mayor can reopen it.', mo; end if;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- One door for approving. Anything at or above the limit must be approved by someone other than the person who recorded it.
create or replace function public.v2_approve_entry(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.v2_entries; r text := public.v2_role(); thr numeric := coalesce(nullif(public.v2__setting('expense_second_approval'), '')::numeric, 500); second boolean; nm text;
begin
  if r not in ('mayor', 'vice_mayor', 'auditor', 'treasurer') then raise exception 'Not allowed'; end if;
  select * into e from public.v2_entries where id = p_id for update;
  if e.id is null then raise exception 'Unknown entry'; end if;
  if e.status <> 'pending' then raise exception 'This entry is not waiting for approval'; end if;
  second := e.kind = 'expense' and thr > 0 and e.amount >= thr and coalesce(e.source, 'manual') = 'manual';
  if second then
    if e.recorded_by is not distinct from auth.uid() then raise exception 'You recorded this expense, so another officer must approve it'; end if;
  elsif r <> 'mayor' then raise exception 'Only the Mayor can approve this entry'; end if;
  select full_name into nm from public.v2_profiles where user_id = auth.uid();
  perform set_config('alpha.approving', '1', true);
  update public.v2_entries set status = 'approved', approved_by_name = nm where id = p_id;
  perform set_config('alpha.approving', '', true);
end $$;
revoke all on function public.v2_approve_entry(uuid) from public, anon;
grant execute on function public.v2_approve_entry(uuid) to authenticated;

-- ===========================================================================
-- 4. Reminders: shared sender, roster (who got it / who did not) and automatic due-date nudges
-- ===========================================================================
create or replace function public.v2__send_reminder_core(p_charge uuid, p_by uuid, p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.v2_charges; s text; items jsonb; n int; reach int; last_at timestamptz;
begin
  select * into c from public.v2_charges where id = p_charge;
  if c.id is null then raise exception 'Unknown charge'; end if;
  if c.closed then raise exception 'This charge is closed'; end if;
  select max(created_at) into last_at from public.v2_reminders where charge_id = p_charge;
  if last_at is not null and last_at > now() - interval '6 hours' then
    raise exception 'A reminder for this charge already went out less than 6 hours ago';
  end if;
  select convert_from(value, 'UTF8') into s from public.v2_secrets where key = 'push_hook';
  if s is null then raise exception 'Alerts are not set up yet'; end if;

  with ow as (
    select m.id, greatest(c.amount - coalesce(p.paid, 0), 0) owed from public.v2_members m
    left join (select member_id, sum(amount) paid from public.v2_entries
               where kind = 'collection' and status in ('approved', 'pending') and charge_id = p_charge group by 1) p on p.member_id = m.id
    where m.status = 'active' and c.amount - coalesce(p.paid, 0) > 0)
  select coalesce(jsonb_agg(jsonb_build_object('member_id', ow.id, 'title', 'Payment reminder · Alpha ’28',
      'body', c.title || ': you still owe ₱' || case when ow.owed = trunc(ow.owed) then trunc(ow.owed)::text else to_char(ow.owed, 'FM999990.00') end
              || case when c.due_on is not null then ' (due ' || to_char(c.due_on, 'Mon FMDD') || ')' else '' end
              || '. Please settle with the Treasurer. Salamat!')), '[]'::jsonb),
         count(*),
         count(*) filter (where exists (select 1 from public.v2_push_subs x where x.member_id = ow.id))
    into items, n, reach from ow;
  if n = 0 then raise exception 'Nobody owes this charge'; end if;

  perform net.http_post(url := 'https://gxwgkbplscsduscoeoph.supabase.co/functions/v1/notify-announcement',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-secret', s),
    body := jsonb_build_object('kind', 'reminder', 'items', items));
  insert into public.v2_reminders(charge_id, sent_by, sent_by_name, owing, reached) values (p_charge, p_by, p_name, n, reach);
  return jsonb_build_object('owing', n, 'reached', reach);
end $$;
revoke all on function public.v2__send_reminder_core(uuid, uuid, text) from public, anon, authenticated;

create or replace function public.v2_send_reminder(p_charge uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare who text;
begin
  if not public.v2_has_role('mayor', 'vice_mayor', 'treasurer', 'auditor') then raise exception 'Not allowed'; end if;
  select full_name into who from public.v2_profiles where user_id = auth.uid();
  return public.v2__send_reminder_core(p_charge, auth.uid(), who);
end $$;
grant execute on function public.v2_send_reminder(uuid) to authenticated;

-- Everyone who still owes a charge, and whether a phone is linked to them.
create or replace function public.v2_reminder_roster(p_charge uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.v2_has_role('mayor', 'vice_mayor', 'treasurer', 'auditor') then raise exception 'Not allowed'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object('name', m.full_name, 'owed', greatest(c.amount - coalesce(p.paid, 0), 0),
        'linked', exists (select 1 from public.v2_push_subs x where x.member_id = m.id)) order by m.full_name), '[]'::jsonb)
    from public.v2_members m join public.v2_charges c on c.id = p_charge
    left join (select member_id, sum(amount) paid from public.v2_entries
               where kind = 'collection' and status in ('approved', 'pending') and charge_id = p_charge group by 1) p on p.member_id = m.id
    where m.status = 'active' and c.amount - coalesce(p.paid, 0) > 0);
end $$;
revoke all on function public.v2_reminder_roster(uuid) from public, anon;
grant execute on function public.v2_reminder_roster(uuid) to authenticated;

-- Daily at 9 AM Manila: charges due in 2 days or today get a reminder (only when the Mayor turned it on).
create or replace function public.v2_auto_nudge() returns int
language plpgsql security definer set search_path = '' as $$
declare c record; n int := 0; today date := (now() at time zone 'Asia/Manila')::date;
begin
  if coalesce(public.v2__setting('auto_nudge'), 'off') <> 'on' then return 0; end if;
  for c in select id from public.v2_charges where not closed and due_on is not null and (due_on - today) in (0, 2) loop
    begin perform public.v2__send_reminder_core(c.id, null, 'Automatic reminder'); n := n + 1;
    exception when others then null; end;
  end loop;
  return n;
end $$;
revoke all on function public.v2_auto_nudge() from public, anon, authenticated;
select cron.schedule('alpha28-auto-nudge', '0 1 * * *', $$select public.v2_auto_nudge()$$);   -- 01:00 UTC = 9:00 Manila
