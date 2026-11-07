-- v49 · President supervision: deputy for when the President is away, escalation alerts up the chain, section early-warning flags,
--       scorecards, a role-change log, calendar clash check, a read-only funds overview, and the monthly SAILS report.
-- Requires v46, v47, v48. Safe to run twice.

-- 1 · the President's deputy (a VP or the General Marshal, for a set period of up to 14 days)
create table if not exists public.v2_deputy (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  user_name text,
  from_on date not null,
  to_on date not null,
  named_by_name text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  check (to_on >= from_on and to_on - from_on <= 14)
);
alter table public.v2_deputy enable row level security;
revoke all on public.v2_deputy from anon; grant select on public.v2_deputy to authenticated;

create or replace function public.v2_is_real_president() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.v2_role() = 'sails_president' or (public.v2_role() = 'mayor' and not public.v2_president_exists()), false)
$$;
create or replace function public.v2__deputy_now() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.v2_deputy d where d.user_id = auth.uid() and d.revoked_at is null
                 and (now() at time zone 'Asia/Manila')::date between d.from_on and d.to_on)
$$;
create or replace function public.v2_is_president() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.v2_is_real_president() or public.v2__deputy_now(), false)
$$;
revoke all on function public.v2_is_real_president() from public, anon;
revoke all on function public.v2__deputy_now() from public, anon;
grant execute on function public.v2_is_real_president() to authenticated;
grant execute on function public.v2__deputy_now() to authenticated;

drop policy if exists deputy_read on public.v2_deputy;
create policy deputy_read on public.v2_deputy for select to authenticated using (user_id = auth.uid() or public.v2_is_real_president());

create or replace function public.v2_deputy_set(p_user uuid, p_from date, p_to date) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.v2_profiles;
begin
  if not public.v2_is_real_president() then raise exception 'Only the SAILS President names a deputy'; end if;
  select * into a from public.v2_profiles where user_id = p_user;
  if a.user_id is null or a.role not in ('vp_internal', 'vp_external', 'general_marshal') then raise exception 'The deputy must be a Vice President or the General Marshal'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Choose the dates'; end if;
  if p_to - p_from > 14 then raise exception 'A deputy can act for 14 days at most'; end if;
  if p_to < (now() at time zone 'Asia/Manila')::date then raise exception 'The end date has already passed'; end if;
  update public.v2_deputy set revoked_at = now() where revoked_at is null;
  insert into public.v2_deputy(user_id, user_name, from_on, to_on, named_by_name) values (a.user_id, a.full_name, p_from, p_to, public.v2__who());
  perform public.v2__directive_push(a.user_id, 'You are acting for the President', 'From ' || to_char(p_from, 'Mon FMDD') || ' to ' || to_char(p_to, 'Mon FMDD') || '. Open the President Desk.');
end $$;
grant execute on function public.v2_deputy_set(uuid, date, date) to authenticated;

create or replace function public.v2_deputy_revoke() returns void
language plpgsql security definer set search_path = '' as $$
declare d public.v2_deputy;
begin
  if not public.v2_is_real_president() then raise exception 'Only the SAILS President ends a deputy'; end if;
  select * into d from public.v2_deputy where revoked_at is null order by created_at desc limit 1;
  update public.v2_deputy set revoked_at = now() where revoked_at is null;
  if d.id is not null then perform public.v2__directive_push(d.user_id, 'You are no longer acting for the President', 'The President is back.'); end if;
end $$;
grant execute on function public.v2_deputy_revoke() to authenticated;

-- what the screen needs: the current deputy (for the President) or whether I am the deputy now
create or replace function public.v2_deputy_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object('user_id', d.user_id, 'user_name', d.user_name, 'from_on', d.from_on, 'to_on', d.to_on,
           'active_now', (now() at time zone 'Asia/Manila')::date between d.from_on and d.to_on, 'me', d.user_id = auth.uid())
         from public.v2_deputy d
         where d.revoked_at is null and d.to_on >= (now() at time zone 'Asia/Manila')::date and (d.user_id = auth.uid() or public.v2_is_real_president())
         order by d.created_at desc limit 1), 'null'::jsonb)
$$;
grant execute on function public.v2_deputy_status() to authenticated;

-- role changes and the creation of roles stay with the real President, not a deputy
do $$ declare src text; begin
  src := pg_get_functiondef('public.v2_profile_role_guard()'::regprocedure);
  src := replace(src, 'public.v2_is_president()', 'public.v2_is_real_president()');
  execute src;
end $$;
drop policy if exists profiles_mayor_upd on public.v2_profiles;
create policy profiles_mayor_upd on public.v2_profiles for update to authenticated
  using (user_id = (select auth.uid()) or public.v2_is_real_president()
         or (public.v2_role() = 'mayor' and role in ('pending', 'vice_mayor', 'secretary', 'treasurer', 'auditor', 'marshall', 'pio', 'sails')))
  with check (user_id = (select auth.uid()) or public.v2_is_real_president()
         or (public.v2_role() = 'mayor' and role in ('pending', 'vice_mayor', 'secretary', 'treasurer', 'auditor', 'marshall', 'pio', 'sails')));
drop policy if exists profiles_mayor_del on public.v2_profiles;
create policy profiles_mayor_del on public.v2_profiles for delete to authenticated
  using (user_id <> (select auth.uid()) and (public.v2_is_real_president()
         or (public.v2_role() = 'mayor' and role in ('pending', 'vice_mayor', 'secretary', 'treasurer', 'auditor', 'marshall', 'pio', 'sails'))));

-- the decision history says when a deputy decided
do $$ declare src text; begin
  src := pg_get_functiondef('public.v2__log_decision()'::regprocedure);
  if position('public.v2__who());' in src) > 0 then
    src := replace(src, 'public.v2__who());', 'public.v2__who() || case when public.v2__deputy_now() and not public.v2_is_real_president() then '' (acting for the President)'' else '''' end);');
    execute src;
  end if;
end $$;

-- 2 · role change log (President only)
create table if not exists public.v2_role_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid, user_name text, old_role text, new_role text, by_name text,
  at timestamptz not null default now()
);
alter table public.v2_role_log enable row level security;
revoke all on public.v2_role_log from anon; grant select on public.v2_role_log to authenticated;
drop policy if exists rlog_read on public.v2_role_log;
create policy rlog_read on public.v2_role_log for select to authenticated using (public.v2_is_president());
create or replace function public.v2__role_log() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.role is distinct from old.role then
    insert into public.v2_role_log(user_id, user_name, old_role, new_role, by_name)
    values (new.user_id, new.full_name, old.role, new.role, case when auth.uid() is null then 'Database owner' else public.v2__who() end);
  end if;
  return new;
end $$;
revoke all on function public.v2__role_log() from public, anon;
drop trigger if exists v2_role_log_t on public.v2_profiles;
create trigger v2_role_log_t after update on public.v2_profiles for each row execute function public.v2__role_log();

-- 3 · escalation: a late directive alerts the issuer (day 1), the issuer's superior (day 3) and the President (day 5);
--     a weekly report or request the VP Internal leaves 3 days alerts the President. Each person is alerted once per item.
create table if not exists public.v2_escalations (
  src text not null, src_id uuid not null, user_id uuid not null, sent_at timestamptz not null default now(),
  primary key (src, src_id, user_id)
);
alter table public.v2_escalations enable row level security;
revoke all on public.v2_escalations from anon, authenticated;

create or replace function public.v2__escalate(p_src text, p_id uuid, p_user uuid, p_title text, p_body text) returns int
language plpgsql security definer set search_path = '' as $$
declare k int;
begin
  if p_user is null then return 0; end if;
  insert into public.v2_escalations(src, src_id, user_id) values (p_src, p_id, p_user) on conflict do nothing;
  get diagnostics k = row_count;
  if k > 0 then perform public.v2__directive_push(p_user, p_title, p_body); end if;
  return k;
end $$;
revoke all on function public.v2__escalate(text, uuid, uuid, text, text) from public, anon, authenticated;

create or replace function public.v2_escalation_tick() returns int
language plpgsql security definer set search_path = '' as $$
declare today date := (now() at time zone 'Asia/Manila')::date; n int := 0; d record; r record; late int; t uuid;
begin
  for d in select * from public.v2_directives where status in ('sent', 'received', 'working') and due_on is not null and due_on < today loop
    late := today - d.due_on;
    n := n + public.v2__escalate('dir', d.id, d.issued_by, 'Late: ' || d.title, d.assignee_name || ' · ' || late || ' day' || case when late = 1 then '' else 's' end || ' late');
    if late >= 3 then
      for t in select user_id from public.v2_profiles where role = 'vp_internal' and d.issuer_role = 'mayor'
               union select i from public.v2__president_ids() i where d.issuer_role in ('vp_internal', 'vp_external', 'general_marshal') loop
        n := n + public.v2__escalate('dir', d.id, t, 'Still late: ' || d.title, d.assignee_name || ' · ' || late || ' days late · issued by ' || coalesce(d.issued_by_name, 'an officer'));
      end loop;
    end if;
    if late >= 5 then
      for t in select i from public.v2__president_ids() i loop
        n := n + public.v2__escalate('dir', d.id, t, 'Very late: ' || d.title, d.assignee_name || ' · ' || late || ' days late');
      end loop;
    end if;
  end loop;
  for r in select * from public.v2_class_reports where reviewed_at is null and submitted_at < now() - interval '3 days' loop
    for t in select i from public.v2__president_ids() i loop
      n := n + public.v2__escalate('rep', r.id, t, 'A weekly report is unread', coalesce(r.mayor_name, 'A Class Mayor') || ' sent it more than 3 days ago');
    end loop;
  end loop;
  for r in select * from public.v2_class_asks where status = 'open' and created_at < now() - interval '3 days' loop
    for t in select i from public.v2__president_ids() i loop
      n := n + public.v2__escalate('ask', r.id, t, 'A request is waiting', coalesce(r.from_name, 'A Class Mayor') || ' · ' || r.title);
    end loop;
  end loop;
  return n;
end $$;
revoke all on function public.v2_escalation_tick() from public, anon, authenticated;
do $$ begin perform cron.unschedule('alpha28-escalation'); exception when others then null; end $$;
select cron.schedule('alpha28-escalation', '*/30 * * * *', $c$select public.v2_escalation_tick()$c$);

-- 4 · section overview with early-warning flags
create or replace function public.v2_president_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare today date := (now() at time zone 'Asia/Manila')::date;
begin
  if not (public.v2_is_president() or public.v2_role() in ('vp_internal', 'vp_external', 'general_marshal')) then raise exception 'Not allowed'; end if;
  return jsonb_build_object(
    'sections', coalesce((select jsonb_agg(jsonb_build_object(
        'id', u.id, 'name', u.name, 'students', (select count(*) from public.v2_members m where m.unit_id = u.id and m.status = 'active'),
        'mayor_id', h.user_id, 'mayor_name', p.full_name,
        'open', (select count(*) from public.v2_directives d where d.issued_by = h.user_id and d.status in ('sent', 'received', 'working', 'done', 'revoke_asked')),
        'late', (select count(*) from public.v2_directives d where d.issued_by = h.user_id and d.status in ('sent', 'received', 'working') and d.due_on < today),
        'report_week', (select max(r.week_start) from public.v2_class_reports r where r.mayor_id = h.user_id),
        'report_reviewed', (select (r.reviewed_at is not null) from public.v2_class_reports r where r.mayor_id = h.user_id order by r.week_start desc limit 1),
        'asks_open', (select count(*) from public.v2_class_asks a where a.from_id = h.user_id and a.status = 'open'),
        'flags', (select coalesce(jsonb_agg(q.f), '[]'::jsonb) from (
            select 'no_mayor' as f where h.user_id is null
            union all select 'no_report' where h.user_id is not null and coalesce((select max(r.week_start) from public.v2_class_reports r where r.mayor_id = h.user_id), date '2000-01-01') < today - 14
            union all select 'many_late' where (select count(*) from public.v2_directives d where d.issued_by = h.user_id and d.status in ('sent', 'received', 'working') and d.due_on < today) >= 3
            union all select 'idle' where h.user_id is not null and not exists (select 1 from public.v2_directives d where d.issued_by = h.user_id and d.issued_at > now() - interval '14 days')) q)
      ) order by u.year_level, u.name)
      from public.v2_units u
      left join public.v2_seat_holders h on h.unit_id = u.id and h.seat = 'mayor' and h.status in ('active', 'acting') and h.user_id is not null
      left join public.v2_profiles p on p.user_id = h.user_id
      where u.kind = 'section' and u.active), '[]'::jsonb),
    'officers', coalesce((select jsonb_object_agg(role, n) from (select role, count(*) n from public.v2_profiles group by role) x), '{}'::jsonb));
end $$;
grant execute on function public.v2_president_overview() to authenticated;

-- 5 · scorecards (President only)
create or replace function public.v2_scorecard(p_days int default 28) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare today date := (now() at time zone 'Asia/Manila')::date;
begin
  if not public.v2_is_president() then raise exception 'Only the President sees the scorecards'; end if;
  return coalesce((select jsonb_agg(to_jsonb(s) order by s.name) from (
    select a.assignee_id as user_id, max(a.assignee_name) as name, max(a.assignee_role) as role,
      count(*) as total,
      count(*) filter (where a.status = 'confirmed') as confirmed,
      count(*) filter (where a.status = 'confirmed' and (a.due_on is null or (a.confirmed_at at time zone 'Asia/Manila')::date <= a.due_on)) as on_time,
      count(*) filter (where a.status in ('sent', 'received', 'working') and a.due_on < today) as late_open,
      count(*) filter (where a.return_note is not null) as returned,
      round((avg(extract(epoch from (a.received_at - a.issued_at)) / 3600) filter (where a.received_at is not null))::numeric, 1) as avg_response_h,
      (select coalesce(jsonb_agg(x.pct order by x.k desc), '[]'::jsonb) from (
          select g.k, case when count(w.id) = 0 then null
                      else round(100.0 * count(w.id) filter (where w.due_on is null or (w.confirmed_at at time zone 'Asia/Manila')::date <= w.due_on) / count(w.id)) end as pct
          from generate_series(0, 3) g(k)
          left join public.v2_directives w on w.assignee_id = a.assignee_id and w.status = 'confirmed'
               and w.confirmed_at >= now() - make_interval(days => 7 * (g.k + 1)) and w.confirmed_at < now() - make_interval(days => 7 * g.k)
          group by g.k) x) as weeks
    from public.v2_directives a
    where a.assignee_role in ('vp_internal', 'vp_external', 'general_marshal', 'dept_marshal', 'mayor') and a.issued_at > now() - make_interval(days => p_days)
    group by a.assignee_id) s), '[]'::jsonb);
end $$;
grant execute on function public.v2_scorecard(int) to authenticated;

-- 6 · calendar clashes
create or replace function public.v2_coa_conflicts() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.v2_is_president() or public.v2_role() in ('vp_internal', 'vp_external')) then raise exception 'Not allowed'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('a', a.title, 'a_status', a.status, 'b', b.title, 'b_status', b.status, 'on', greatest(a.starts_on, b.starts_on)) order by greatest(a.starts_on, b.starts_on))
    from public.v2_coa a join public.v2_coa b on a.id < b.id
      and a.status in ('approved', 'proposed') and b.status in ('approved', 'proposed')
      and a.starts_on <= coalesce(b.ends_on, b.starts_on) and b.starts_on <= coalesce(a.ends_on, a.starts_on)
    where greatest(a.starts_on, b.starts_on) >= (now() at time zone 'Asia/Manila')::date), '[]'::jsonb);
end $$;
grant execute on function public.v2_coa_conflicts() to authenticated;

-- 7 · funds overview (read only)
create or replace function public.v2_funds_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare per public.v2_periods;
begin
  if not (public.v2_is_president() or public.v2_role() in ('vp_internal', 'vp_external')) then raise exception 'Not allowed'; end if;
  select * into per from public.v2_periods where status = 'open' order by opened_at desc limit 1;
  return jsonb_build_object(
    'opening', coalesce(per.opening_balance, 0),
    'collected', coalesce((select sum(amount) from public.v2_entries where period_id = per.id and kind = 'collection' and status = 'approved'), 0),
    'spent', coalesce((select sum(amount) from public.v2_entries where period_id = per.id and kind = 'expense' and status = 'approved'), 0),
    'pending', (select count(*) from public.v2_entries where period_id = per.id and status = 'pending'),
    'voided_30d', (select count(*) from public.v2_entries where status = 'voided' and occurred_at > now() - interval '30 days'),
    'largest', (select jsonb_build_object('amount', e.amount, 'purpose', e.purpose) from public.v2_entries e where e.period_id = per.id and e.kind = 'expense' and e.status = 'approved' order by e.amount desc limit 1),
    'budget_waiting', (select count(*) from public.v2_budget_requests where status = 'submitted'),
    'liquidation_waiting', (select count(*) from public.v2_liquidations where status = 'submitted'));
end $$;
grant execute on function public.v2_funds_overview() to authenticated;

-- 8 · monthly SAILS report (for the adviser)
create or replace function public.v2_sails_monthly(p_month date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare ms date := date_trunc('month', coalesce(p_month, (now() at time zone 'Asia/Manila')::date))::date; me date; today date := (now() at time zone 'Asia/Manila')::date;
begin
  if not (public.v2_is_president() or public.v2_role() = 'vp_internal') then raise exception 'Not allowed'; end if;
  me := (ms + interval '1 month')::date;
  return jsonb_build_object('month', ms,
    'decisions', coalesce((select jsonb_object_agg(decision, n) from (select decision, count(*) n from public.v2_decisions where decided_at >= ms and decided_at < me group by decision) x), '{}'::jsonb),
    'directives', jsonb_build_object(
      'issued', (select count(*) from public.v2_directives where issued_at >= ms and issued_at < me),
      'confirmed', (select count(*) from public.v2_directives where confirmed_at >= ms and confirmed_at < me),
      'late_now', (select count(*) from public.v2_directives where status in ('sent', 'received', 'working') and due_on < today)),
    'reports', jsonb_build_object('received', (select count(*) from public.v2_class_reports where week_start >= ms and week_start < me),
      'mayors', (select count(*) from public.v2_profiles where role = 'mayor')),
    'asks', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from public.v2_class_asks where created_at >= ms and created_at < me group by status) x), '{}'::jsonb),
    'incidents', jsonb_build_object('filed', (select count(*) from public.v2_marshal_incidents where created_at >= ms and created_at < me),
      'closed', (select count(*) from public.v2_marshal_incidents where status = 'closed' and updated_at >= ms and updated_at < me),
      'referred', (select count(*) from public.v2_marshal_incidents where referred_at >= ms and referred_at < me)),
    'funds', jsonb_build_object(
      'collected', coalesce((select sum(amount) from public.v2_entries where kind = 'collection' and status = 'approved' and occurred_at >= ms and occurred_at < me), 0),
      'spent', coalesce((select sum(amount) from public.v2_entries where kind = 'expense' and status = 'approved' and occurred_at >= ms and occurred_at < me), 0)),
    'activities', coalesce((select jsonb_agg(jsonb_build_object('title', title, 'on', starts_on) order by starts_on) from public.v2_coa where status = 'approved' and starts_on >= ms and starts_on < me), '[]'::jsonb));
end $$;
grant execute on function public.v2_sails_monthly(date) to authenticated;
