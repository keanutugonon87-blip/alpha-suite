-- Alpha ’28 · v5 · Waivers (excuse a student from a charge) and receipt photo required for big expenses.
-- Safe to run more than once. Paste all of it into Supabase > SQL Editor > Run.

-- ===========================================================================
-- 1. Waivers
-- ===========================================================================
create table if not exists public.v2_waivers (
  id uuid primary key default gen_random_uuid(),
  charge_id uuid not null references public.v2_charges(id) on delete cascade,
  member_id uuid not null references public.v2_members(id) on delete cascade,
  reason text not null check (length(btrim(reason)) >= 3),
  waived_by uuid, waived_by_name text,
  created_at timestamptz not null default now(),
  unique (charge_id, member_id)
);
alter table public.v2_waivers enable row level security;
drop policy if exists v2_waivers_read on public.v2_waivers;
create policy v2_waivers_read on public.v2_waivers for select to authenticated using (public.v2_is_staff());
-- no insert/update/delete policies: changes only go through the two functions below
drop trigger if exists v2_waivers_audit on public.v2_waivers;
create trigger v2_waivers_audit after insert or delete or update on public.v2_waivers for each row execute function public.v2_audit_trigger();

create or replace function public.v2_waive_charge(p_charge uuid, p_member uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare nm text;
begin
  if not public.v2_has_role('mayor', 'vice_mayor') then raise exception 'Only the Mayor or Vice Mayor can excuse a student'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Please give a reason'; end if;
  if not exists (select 1 from public.v2_charges where id = p_charge) then raise exception 'Unknown charge'; end if;
  if not exists (select 1 from public.v2_members where id = p_member) then raise exception 'Unknown student'; end if;
  select full_name into nm from public.v2_profiles where user_id = auth.uid();
  insert into public.v2_waivers(charge_id, member_id, reason, waived_by, waived_by_name)
    values (p_charge, p_member, btrim(p_reason), auth.uid(), nm)
    on conflict (charge_id, member_id) do update set reason = excluded.reason, waived_by = excluded.waived_by, waived_by_name = excluded.waived_by_name;
end $$;
revoke all on function public.v2_waive_charge(uuid, uuid, text) from public, anon;
grant execute on function public.v2_waive_charge(uuid, uuid, text) to authenticated;

create or replace function public.v2_unwaive_charge(p_charge uuid, p_member uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.v2_has_role('mayor') then raise exception 'Only the Mayor can undo an excuse'; end if;
  delete from public.v2_waivers where charge_id = p_charge and member_id = p_member;
end $$;
revoke all on function public.v2_unwaive_charge(uuid, uuid) from public, anon;
grant execute on function public.v2_unwaive_charge(uuid, uuid) to authenticated;

-- Staff balances: an excused student owes nothing on that charge.
create or replace function public.v2_balances() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when public.v2_is_staff() then (
    select coalesce(jsonb_agg(jsonb_build_object('member_id', m.id, 'name', m.full_name, 'charge_id', c.id, 'charge', c.title,
        'due', case when w.id is null then c.amount else 0 end, 'paid', coalesce(p.paid, 0),
        'owed', case when w.id is null then greatest(c.amount - coalesce(p.paid, 0), 0) else 0 end,
        'waived', w.id is not null, 'waive_reason', w.reason) order by m.full_name, c.title), '[]'::jsonb)
    from public.v2_members m cross join public.v2_charges c
    left join public.v2_waivers w on w.member_id = m.id and w.charge_id = c.id
    left join (select member_id, charge_id, sum(amount) paid from public.v2_entries
               where kind = 'collection' and status in ('approved', 'pending') and charge_id is not null group by 1, 2) p
      on p.member_id = m.id and p.charge_id = c.id
    where m.status = 'active')
  else '[]'::jsonb end
$$;

-- Student's own page
create or replace function public.v2_self_check(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare mid uuid; m public.v2_members;
begin
  mid := public.v2_member_from_token(p_token);
  select * into m from public.v2_members where id = mid;
  return jsonb_build_object('name', m.full_name,
    'balances', (select coalesce(jsonb_agg(jsonb_build_object('charge', c.title,
          'due', case when w.id is null then c.amount else 0 end, 'paid', coalesce(p.paid, 0),
          'owed', case when w.id is null then greatest(c.amount - coalesce(p.paid, 0), 0) else 0 end,
          'waived', w.id is not null) order by c.created_at), '[]'::jsonb)
       from public.v2_charges c
       left join public.v2_waivers w on w.charge_id = c.id and w.member_id = m.id
       left join (select charge_id, sum(amount) paid from public.v2_entries where member_id = m.id and kind = 'collection'
                  and status in ('approved', 'pending') and charge_id is not null group by 1) p on p.charge_id = c.id
       where not c.closed),
    'violations', (select coalesce(jsonb_agg(jsonb_build_object('standard', q.title, 'date', q.occurred_on, 'status', q.status, 'offense', q.num) order by q.occurred_on desc), '[]'::jsonb)
       from (select coalesce(s.title, 'Violation') title, v.occurred_on, v.status, v.created_at, row_number() over (order by v.occurred_on, v.created_at) num
             from public.v2_violations v left join public.v2_standards s on s.id = v.standard_id
             where v.member_id = m.id and v.status not in ('awaiting_approval', 'rejected')) q));
end $$;
grant execute on function public.v2_self_check(text) to anon, authenticated;

create or replace function public.v2_self_statement(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare mid uuid; m public.v2_members;
begin
  mid := public.v2_member_from_token(p_token);
  select * into m from public.v2_members where id = mid;
  return jsonb_build_object(
    'name', m.full_name, 'student_no', m.student_no, 'at', now(),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object('at', e.occurred_at, 'receipt_no', e.receipt_no, 'code', e.verify_code,
          'for', coalesce(c.title, e.purpose, e.category), 'amount', e.amount, 'method', e.method, 'fund', coalesce(e.fund, c.fund), 'status', e.status)
          order by e.occurred_at desc), '[]'::jsonb)
        from public.v2_entries e left join public.v2_charges c on c.id = e.charge_id
        where e.member_id = mid and e.kind = 'collection' and e.status in ('approved', 'pending')),
    'balances', (select coalesce(jsonb_agg(jsonb_build_object('charge', c.title,
          'due', case when w.id is null then c.amount else 0 end, 'paid', coalesce(p.paid, 0),
          'owed', case when w.id is null then greatest(c.amount - coalesce(p.paid, 0), 0) else 0 end,
          'closed', c.closed, 'waived', w.id is not null) order by c.created_at), '[]'::jsonb)
        from public.v2_charges c
        left join public.v2_waivers w on w.charge_id = c.id and w.member_id = mid
        left join (select charge_id, sum(amount) paid from public.v2_entries
          where member_id = mid and kind = 'collection' and status in ('approved', 'pending') and charge_id is not null group by 1) p on p.charge_id = c.id));
end $$;
grant execute on function public.v2_self_statement(text) to anon, authenticated;

-- Class-wide progress: an excused student counts as settled.
create or replace function public.v2_public_progress() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('charge', c.title, 'amount', c.amount, 'due_on', c.due_on,
      'total', (select count(*) from public.v2_members where status = 'active'),
      'paid', (select count(*) from public.v2_members m where m.status = 'active' and (
          exists (select 1 from public.v2_waivers w where w.charge_id = c.id and w.member_id = m.id)
          or coalesce((select sum(e.amount) from public.v2_entries e where e.member_id = m.id and e.charge_id = c.id
                       and e.kind = 'collection' and e.status in ('approved', 'pending')), 0) >= c.amount)))
    order by c.created_at), '[]'::jsonb)
  from public.v2_charges c where not c.closed
$$;

-- Reminders skip excused students
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
    where m.status = 'active' and c.amount - coalesce(p.paid, 0) > 0
      and not exists (select 1 from public.v2_waivers w where w.charge_id = p_charge and w.member_id = m.id))
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
    where m.status = 'active' and c.amount - coalesce(p.paid, 0) > 0
      and not exists (select 1 from public.v2_waivers w where w.charge_id = p_charge and w.member_id = m.id));
end $$;

-- ===========================================================================
-- 2. Big expenses need a receipt photo before they can be approved
-- ===========================================================================
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
    if e.receipt_image is null then raise exception 'This expense has no receipt photo yet. Add one before approving'; end if;
  elsif r <> 'mayor' then raise exception 'Only the Mayor can approve this entry'; end if;
  select full_name into nm from public.v2_profiles where user_id = auth.uid();
  perform set_config('alpha.approving', '1', true);
  update public.v2_entries set status = 'approved', approved_by_name = nm where id = p_id;
  perform set_config('alpha.approving', '', true);
end $$;
revoke all on function public.v2_approve_entry(uuid) from public, anon;
grant execute on function public.v2_approve_entry(uuid) to authenticated;
