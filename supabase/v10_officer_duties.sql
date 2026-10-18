-- v10: Officer duties and reminders.
-- Each post (Marshall, Secretary, ...) has a list of duties that repeat (daily, on set weekdays, monthly) or are one-off tasks with a due date.
-- Officers tick their duties off on the Today screen. The Mayor and Vice Mayor see who is on track.
-- Phone alerts: a morning reminder, then a follow-up only for officers who still have something undone.
-- Safe to run more than once.

-- ===========================================================================
-- 1. Tables (no direct access: everything goes through the functions below)
-- ===========================================================================
create table if not exists public.v2_duty_templates (
  id uuid primary key default gen_random_uuid(),
  role text not null check (role in ('mayor','vice_mayor','secretary','treasurer','auditor','marshall','sails','pio')),
  title text not null check (char_length(title) between 2 and 80),
  detail text check (detail is null or char_length(detail) <= 200),
  repeat text not null check (repeat in ('daily','weekly','monthly','once')),
  days int[],                                   -- weekly: ISO weekdays, 1 = Monday ... 7 = Sunday
  month_day int check (month_day is null or month_day between 1 and 31),
  due_on date,                                  -- once: the deadline
  active boolean not null default true,
  sort int not null default 100,
  created_on date not null default (now() at time zone 'Asia/Manila')::date,
  created_at timestamptz not null default now(),
  created_by uuid
);
create table if not exists public.v2_duty_log (
  duty_id uuid not null references public.v2_duty_templates(id) on delete cascade,
  on_date date not null,
  user_id uuid not null,
  done_at timestamptz not null default now(),
  note text check (note is null or char_length(note) <= 200),
  primary key (duty_id, on_date, user_id)
);
create index if not exists v2_duty_log_user_idx on public.v2_duty_log(user_id, on_date);
create table if not exists public.v2_duty_sent (
  kind text not null, on_date date not null, sent_at timestamptz not null default now(),
  primary key (kind, on_date)
);
alter table public.v2_duty_templates enable row level security;
alter table public.v2_duty_log enable row level security;
alter table public.v2_duty_sent enable row level security;
revoke all on public.v2_duty_templates, public.v2_duty_log, public.v2_duty_sent from anon, authenticated;

-- ===========================================================================
-- 2. Starting duties (only when the list is empty; the Mayor edits them afterwards)
-- ===========================================================================
insert into public.v2_duty_templates(role, title, detail, repeat, days, month_day, sort)
select * from (values
  ('mayor',      'Check Today and clear approvals',              'Open the Today screen and handle what is waiting.', 'weekly', array[1,2,3,4,5], null::int, 10),
  ('mayor',      'Read the officers'' duty report',              'Open System > Officer duties and follow up on missed duties.', 'weekly', array[1], null, 20),
  ('vice_mayor', 'Check violation decisions waiting for you',    null, 'weekly', array[1,2,3,4,5], null, 10),
  ('secretary',  'Update the class documents',                   'Minutes, letters, forms and the student list.', 'weekly', array[1,2,3,4,5], null, 10),
  ('secretary',  'File the day''s attendance and violation records', null, 'weekly', array[1,2,3,4,5], null, 20),
  ('treasurer',  'Record today''s collections and expenses',     'Keep every peso entered the same day.', 'weekly', array[1,2,3,4,5], null, 10),
  ('treasurer',  'Remind students whose dues are close',         null, 'weekly', array[1], null, 20),
  ('treasurer',  'Prepare the month-end count',                  'Count the cash and match it to the app.', 'monthly', null::int[], 28, 30),
  ('auditor',    'Check yesterday''s entries and receipts',      null, 'weekly', array[1,2,3,4,5], null, 10),
  ('auditor',    'Audit the week''s entries',                    null, 'weekly', array[7], null, 20),
  ('marshall',   'Do the daily inspection',                      'Uniform, grooming and ID before formation.', 'weekly', array[1,2,3,4,5], null, 10),
  ('marshall',   'Report the violations you found',              'Enter them in the Watch tab the same day.', 'weekly', array[1,2,3,4,5], null, 20),
  ('sails',      'Check the day''s class activities and report to the Mayor', null, 'weekly', array[1,2,3,4,5], null, 10),
  ('pio',        'Post today''s notice if there is one',         null, 'weekly', array[1,2,3,4,5], null, 10),
  ('pio',        'Update the officer profiles',                  null, 'weekly', array[5], null, 20)
) as v(role, title, detail, repeat, days, month_day, sort)
where not exists (select 1 from public.v2_duty_templates);

-- ===========================================================================
-- 3. Rules: does a duty fall on a given day?
-- ===========================================================================
create or replace function public.v2__duty_applies(t public.v2_duty_templates, d date) returns boolean
language sql stable set search_path = '' as $$
  select t.active and t.created_on <= d and case t.repeat
    when 'daily' then true
    when 'weekly' then extract(isodow from d)::int = any(coalesce(t.days, '{}'))
    when 'monthly' then extract(day from d)::int = least(coalesce(t.month_day, 1),
                         extract(day from (date_trunc('month', d) + interval '1 month' - interval '1 day'))::int)
    when 'once' then t.due_on = d
    else false end
$$;
revoke all on function public.v2__duty_applies(public.v2_duty_templates, date) from public, anon, authenticated;

-- What one officer has on a given (today) date. One-off tasks show from 2 days before the deadline and stay until done.
create or replace function public.v2__duty_rows(p_user uuid, p_role text, p_date date)
returns table(id uuid, title text, detail text, repeat text, due_on date, done boolean, note text, done_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select t.id, t.title, t.detail, t.repeat, t.due_on, (l.duty_id is not null), l.note, l.done_at
  from public.v2_duty_templates t
  left join public.v2_duty_log l on l.duty_id = t.id and l.user_id = p_user and (l.on_date = p_date or t.repeat = 'once')
  where t.active and t.role = p_role and (
    (t.repeat <> 'once' and public.v2__duty_applies(t, p_date))
    or (t.repeat = 'once' and t.due_on - p_date <= 2 and (l.duty_id is null or l.on_date = p_date)))
  order by t.sort, t.created_at
$$;
revoke all on function public.v2__duty_rows(uuid, text, date) from public, anon, authenticated;

-- ===========================================================================
-- 4. For the officer: my duties today, tick, untick
-- ===========================================================================
create or replace function public.v2_my_duties() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r text := public.v2_role(); d date := (now() at time zone 'Asia/Manila')::date;
begin
  if r is null or r = 'pending' then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'detail', x.detail, 'repeat', x.repeat,
      'due_on', x.due_on, 'done', x.done, 'note', x.note, 'done_at', x.done_at)) from public.v2__duty_rows(auth.uid(), r, d) x), '[]'::jsonb);
end $$;
revoke all on function public.v2_my_duties() from public, anon;
grant execute on function public.v2_my_duties() to authenticated;

create or replace function public.v2_duty_tick_off(p_duty uuid, p_done boolean default true, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare r text := public.v2_role(); d date := (now() at time zone 'Asia/Manila')::date; n text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if r is null or r = 'pending' then raise exception 'Not allowed'; end if;
  if n is not null and char_length(n) > 200 then raise exception 'Keep the note under 200 characters'; end if;
  if not exists (select 1 from public.v2__duty_rows(auth.uid(), r, d) x where x.id = p_duty) then raise exception 'That duty is not on your list today'; end if;
  if coalesce(p_done, true) then
    delete from public.v2_duty_log l using public.v2_duty_templates t where l.duty_id = p_duty and l.user_id = auth.uid() and t.id = p_duty and t.repeat = 'once' and l.on_date <> d;
    insert into public.v2_duty_log(duty_id, on_date, user_id, note) values (p_duty, d, auth.uid(), n)
      on conflict (duty_id, on_date, user_id) do update set note = excluded.note;
  else
    delete from public.v2_duty_log where duty_id = p_duty and user_id = auth.uid() and on_date = d;
  end if;
  if random() < 0.02 then delete from public.v2_duty_log where on_date < d - 120; end if;
end $$;
revoke all on function public.v2_duty_tick_off(uuid, boolean, text) from public, anon;
grant execute on function public.v2_duty_tick_off(uuid, boolean, text) to authenticated;

-- ===========================================================================
-- 5. For the Mayor: the duty list editor and the settings
-- ===========================================================================
create or replace function public.v2_duty_templates_list() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.v2_has_role('mayor', 'vice_mayor') then raise exception 'Not allowed'; end if;
  return coalesce((select jsonb_agg(to_jsonb(t) - 'created_by' - 'created_at' order by t.role, t.sort, t.created_at) from public.v2_duty_templates t), '[]'::jsonb);
end $$;
revoke all on function public.v2_duty_templates_list() from public, anon;
grant execute on function public.v2_duty_templates_list() to authenticated;

create or replace function public.v2_duty_save(p_id uuid, p_role text, p_title text, p_detail text, p_repeat text,
                                               p_days int[], p_month_day int, p_due_on date, p_active boolean default true) returns uuid
language plpgsql security definer set search_path = '' as $$
declare ttl text := btrim(coalesce(p_title, '')); det text := nullif(btrim(coalesce(p_detail, '')), ''); rid uuid := p_id;
        dd int[] := null; md int := null; du date := null;
begin
  if not public.v2_has_role('mayor') then raise exception 'Only the Mayor can change the duty list'; end if;
  if p_role not in ('mayor','vice_mayor','secretary','treasurer','auditor','marshall','sails','pio') then raise exception 'Choose an officer post'; end if;
  if char_length(ttl) < 2 or char_length(ttl) > 80 then raise exception 'Write the duty in 2 to 80 characters'; end if;
  if det is not null and char_length(det) > 200 then raise exception 'Keep the details under 200 characters'; end if;
  if p_repeat = 'weekly' then
    select array_agg(distinct x order by x) into dd from unnest(coalesce(p_days, '{}')) x where x between 1 and 7;
    if dd is null then raise exception 'Pick at least one day of the week'; end if;
  elsif p_repeat = 'monthly' then
    if p_month_day is null or p_month_day not between 1 and 31 then raise exception 'Pick a day of the month (1 to 31)'; end if;
    md := p_month_day;
  elsif p_repeat = 'once' then
    if p_due_on is null then raise exception 'Pick the deadline'; end if;
    du := p_due_on;
  elsif p_repeat <> 'daily' then raise exception 'Choose how often it repeats'; end if;
  if rid is null then
    insert into public.v2_duty_templates(role, title, detail, repeat, days, month_day, due_on, active, created_by)
      values (p_role, ttl, det, p_repeat, dd, md, du, coalesce(p_active, true), auth.uid()) returning id into rid;
  else
    update public.v2_duty_templates set role = p_role, title = ttl, detail = det, repeat = p_repeat, days = dd, month_day = md, due_on = du, active = coalesce(p_active, true)
      where id = rid;
    if not found then raise exception 'That duty no longer exists'; end if;
  end if;
  insert into public.v2_audit(actor, actor_name, action, table_name, row_id, new_row)
    values (auth.uid(), (select full_name from public.v2_profiles where user_id = auth.uid()), 'DUTY', 'v2_duty_templates', rid::text, jsonb_build_object('role', p_role, 'title', ttl, 'repeat', p_repeat));
  return rid;
end $$;
revoke all on function public.v2_duty_save(uuid, text, text, text, text, int[], int, date, boolean) from public, anon;
grant execute on function public.v2_duty_save(uuid, text, text, text, text, int[], int, date, boolean) to authenticated;

create or replace function public.v2_duty_delete(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.v2_has_role('mayor') then raise exception 'Only the Mayor can change the duty list'; end if;
  delete from public.v2_duty_templates where id = p_id;
end $$;
revoke all on function public.v2_duty_delete(uuid) from public, anon;
grant execute on function public.v2_duty_delete(uuid) to authenticated;

create or replace function public.v2_duty_settings() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.v2_has_role('mayor', 'vice_mayor') then raise exception 'Not allowed'; end if;
  return jsonb_build_object('alerts', coalesce(public.v2__setting('duty_alerts'), 'on'),
    'morning', coalesce(public.v2__setting('duty_morning'), '06:30'), 'followup', coalesce(public.v2__setting('duty_followup'), '16:00'));
end $$;
revoke all on function public.v2_duty_settings() from public, anon;
grant execute on function public.v2_duty_settings() to authenticated;

-- same function as before plus the three duty settings (Mayor only)
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
  elsif p_key in ('auto_nudge', 'require_login', 'duty_alerts') then
    if not public.v2_has_role('mayor') then raise exception 'Only the Mayor can change this'; end if;
    if v not in ('on', 'off') then raise exception 'Use on or off'; end if;
  elsif p_key in ('duty_morning', 'duty_followup') then
    if not public.v2_has_role('mayor') then raise exception 'Only the Mayor can change this'; end if;
    if v !~ '^([01]\d|2[0-3]):[0-5]\d$' then raise exception 'Use a time like 06:30 or 16:00'; end if;
  else raise exception 'Unknown setting'; end if;
  insert into public.v2_settings(key, value) values (p_key, v) on conflict (key) do update set value = excluded.value;
  if p_key = 'require_login' then
    insert into public.v2_audit(actor, actor_name, action, table_name, row_id, new_row)
      values (auth.uid(), (select full_name from public.v2_profiles where user_id = auth.uid()), 'SETTING', 'v2_settings', p_key, jsonb_build_object('value', v));
  end if;
end $$;
revoke all on function public.v2_set_setting(text, text) from public, anon;
grant execute on function public.v2_set_setting(text, text) to authenticated;

-- ===========================================================================
-- 6. The report: every officer, today and the last 7 days (Mayor and Vice Mayor)
-- ===========================================================================
create or replace function public.v2_duty_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare today date := (now() at time zone 'Asia/Manila')::date;
begin
  if not public.v2_has_role('mayor', 'vice_mayor') then raise exception 'Not allowed'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', o.user_id, 'name', o.full_name, 'role', o.role,
      'items', coalesce((select jsonb_agg(jsonb_build_object('title', x.title, 'done', x.done, 'note', x.note, 'done_at', x.done_at)) from public.v2__duty_rows(o.user_id, o.role, today) x), '[]'::jsonb),
      'days', (
        select jsonb_agg(jsonb_build_object('d', g.d::date, 'total', c.total, 'done', c.done) order by g.d)
        from generate_series(today - 6, today, interval '1 day') as g(d)
        cross join lateral (
          select count(*)::int as total,
                 count(*) filter (where exists (select 1 from public.v2_duty_log l where l.duty_id = t.id and l.user_id = o.user_id
                                                and (l.on_date = g.d::date or (t.repeat = 'once' and l.on_date >= g.d::date))))::int as done
          from public.v2_duty_templates t where t.role = o.role and public.v2__duty_applies(t, g.d::date)) c
      )) order by array_position(array['mayor','vice_mayor','secretary','treasurer','auditor','marshall','sails','pio'], o.role), o.full_name)
    from public.v2_profiles o
    where o.role in ('mayor','vice_mayor','secretary','treasurer','auditor','marshall','sails','pio')), '[]'::jsonb);
end $$;
revoke all on function public.v2_duty_overview() from public, anon;
grant execute on function public.v2_duty_overview() to authenticated;

-- ===========================================================================
-- 7. Phone alerts
-- ===========================================================================
create or replace function public.v2__duty_notify(p_kind text) returns int
language plpgsql security definer set search_path = '' as $$
declare today date := (now() at time zone 'Asia/Manila')::date; s text; items jsonb := '[]'::jsonb; o record; tot int; und int; names text; team text := ''; nteam int := 0;
begin
  select convert_from(value, 'UTF8') into s from public.v2_secrets where key = 'push_hook';
  if s is null then return 0; end if;
  for o in select user_id, full_name, role from public.v2_profiles
           where role in ('mayor','vice_mayor','secretary','treasurer','auditor','marshall','sails','pio') loop
    select count(*), count(*) filter (where not x.done),
           string_agg(x.title, ', ' order by x.title) filter (where p_kind = 'morning' or not x.done)
      into tot, und, names from public.v2__duty_rows(o.user_id, o.role, today) x;
    if p_kind = 'morning' and tot > 0 then
      items := items || jsonb_build_array(jsonb_build_object('user_id', o.user_id,
        'title', 'Today: ' || tot || ' dut' || case when tot = 1 then 'y' else 'ies' end, 'body', left(names, 180)));
    elsif p_kind = 'followup' and und > 0 then
      items := items || jsonb_build_array(jsonb_build_object('user_id', o.user_id,
        'title', 'Still to do: ' || und || ' dut' || case when und = 1 then 'y' else 'ies' end, 'body', left(names, 180)));
      nteam := nteam + 1;
      team := team || case when team = '' then '' else ', ' end || split_part(o.full_name, ' ', 1) || ' (' || und || ')';
    end if;
  end loop;
  if p_kind = 'followup' and nteam > 0 then
    for o in select user_id from public.v2_profiles where role in ('mayor', 'vice_mayor') loop
      items := items || jsonb_build_array(jsonb_build_object('user_id', o.user_id,
        'title', nteam || ' officer' || case when nteam = 1 then ' has' else 's have' end || ' duties undone', 'body', left(team, 180)));
    end loop;
  end if;
  if jsonb_array_length(items) = 0 then return 0; end if;
  begin
    perform net.http_post(url := 'https://gxwgkbplscsduscoeoph.supabase.co/functions/v1/notify-announcement',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-secret', s),
      body := jsonb_build_object('kind', 'duty', 'items', items));
  exception when others then return 0;
  end;
  return jsonb_array_length(items);
end $$;
revoke all on function public.v2__duty_notify(text) from public, anon, authenticated;

-- Every 15 minutes: send each alert once a day, any time after its set time (so a missed run still catches up within the hour).
create or replace function public.v2_duty_tick() returns int
language plpgsql security definer set search_path = '' as $$
declare nowm timestamp := now() at time zone 'Asia/Manila'; today date := nowm::date; k text; tm time; n int := 0; got int;
begin
  if coalesce(public.v2__setting('duty_alerts'), 'on') = 'off' then return 0; end if;
  foreach k in array array['morning', 'followup'] loop
    begin tm := coalesce(public.v2__setting('duty_' || k), case k when 'morning' then '06:30' else '16:00' end)::time;
    exception when others then continue; end;
    if nowm::time >= tm and nowm::time < tm + interval '60 minutes' then
      insert into public.v2_duty_sent(kind, on_date) values (k, today) on conflict do nothing;
      get diagnostics got = row_count;
      if got = 1 then n := n + public.v2__duty_notify(k); end if;
    end if;
  end loop;
  if random() < 0.05 then delete from public.v2_duty_sent where on_date < today - 30; end if;
  return n;
end $$;
revoke all on function public.v2_duty_tick() from public, anon, authenticated;
select cron.schedule('alpha28-duty-alerts', '*/15 * * * *', $$select public.v2_duty_tick()$$);

-- "Send now" button for the Mayor (tests the alerts without waiting)
create or replace function public.v2_duty_remind_now(p_kind text) returns int
language plpgsql security definer set search_path = '' as $$
begin
  if not public.v2_has_role('mayor') then raise exception 'Only the Mayor can do this'; end if;
  if p_kind not in ('morning', 'followup') then raise exception 'Unknown reminder'; end if;
  return public.v2__duty_notify(p_kind);
end $$;
revoke all on function public.v2_duty_remind_now(text) from public, anon;
grant execute on function public.v2_duty_remind_now(text) to authenticated;
