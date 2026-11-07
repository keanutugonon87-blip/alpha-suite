-- v46 · The Class Mayor line.
--  * A separate SAILS President role ('sails_president'). Until one exists, the Mayor account keeps acting as President (nothing breaks).
--  * Class Vice Mayor, Secretary, Treasurer, PIO and Marshals lose their dashboards and tool access. They keep one thing: their inbox of directives.
--    The Auditor is NOT locked (the audit stays independent).
--  * The Class Mayor holds those tools, delegates by directive, and reports up to the VP Internal (weekly report + requests for approval).
--  * Chain: President -> VPs and General Marshal. VP Internal / VP External -> Class Mayor. Class Mayor -> his class officers.
-- Requires v36, v37, v44, v45. Safe to run twice.

-- 1 · roles
do $$ declare c record; begin
  for c in select conname from pg_constraint where conrelid = 'public.v2_profiles'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%mayor%' loop
    execute format('alter table public.v2_profiles drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.v2_profiles add constraint v2_profiles_role_check
  check (role in ('pending', 'mayor', 'vice_mayor', 'vp_internal', 'vp_external', 'secretary', 'treasurer', 'auditor', 'marshall', 'sails', 'pio', 'general_marshal', 'dept_marshal', 'sails_president'));

-- 2 · who is the President
create or replace function public.v2_president_exists() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.v2_profiles where role = 'sails_president')
$$;
create or replace function public.v2_is_president() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.v2_role() = 'sails_president' or (public.v2_role() = 'mayor' and not public.v2_president_exists()), false)
$$;
create or replace function public.v2__president_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select user_id from public.v2_profiles where role = 'sails_president'
  union
  select user_id from public.v2_profiles where role = 'mayor' and not exists (select 1 from public.v2_profiles where role = 'sails_president')
$$;
grant execute on function public.v2_is_president() to authenticated;
revoke all on function public.v2_president_exists() from public, anon, authenticated;
revoke all on function public.v2__president_ids() from public, anon, authenticated;

-- 3 · the lock: a class officer who is not the Mayor is treated like a pending account by every rule in the database
--     (the app still shows them their own profile and their directives, which are matched by their own user id).
create or replace function public.v2_role() returns text
language sql stable security definer set search_path = '' as $$
  select case when p.role in ('vice_mayor', 'secretary', 'treasurer', 'pio', 'marshall') then 'pending' else p.role end
  from public.v2_profiles p
  where p.user_id = auth.uid()
    and (not exists (select 1 from public.v2_member_accounts a where a.user_id = p.user_id)
         or exists (select 1 from public.v2_member_accounts a join public.v2_members m on m.id = a.member_id
                    where a.user_id = p.user_id and m.status = 'active' and a.last_login_at > now() - interval '30 days'))
$$;
-- the real role, for the app
create or replace function public.v2_real_role() returns text
language sql stable security definer set search_path = '' as $$
  select p.role from public.v2_profiles p where p.user_id = auth.uid()
$$;
grant execute on function public.v2_real_role() to authenticated;

-- 4 · the Class Mayor does the jobs the Treasurer, Secretary and PIO did
do $$ declare f record; p record; src text; q text; w text;
begin
  for f in select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f' and (p.prosrc like '%v2_has_role(''treasurer'')%' or p.prosrc like '%v2_has_role(''secretary'')%') loop
    src := pg_get_functiondef(f.oid);
    src := replace(src, 'public.v2_has_role(''treasurer'')', 'public.v2_has_role(''treasurer'', ''mayor'')');
    src := replace(src, 'public.v2_has_role(''secretary'')', 'public.v2_has_role(''secretary'', ''mayor'')');
    execute src;
  end loop;
  for p in select schemaname, tablename, policyname, cmd, roles, qual, with_check from pg_policies
           where schemaname = 'public' and (coalesce(qual, '') || coalesce(with_check, '')) like '%v2_has_role(''treasurer'')%' loop
    q := replace(p.qual, 'v2_has_role(''treasurer'')', 'v2_has_role(''treasurer'', ''mayor'')');
    w := replace(p.with_check, 'v2_has_role(''treasurer'')', 'v2_has_role(''treasurer'', ''mayor'')');
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    execute format('create policy %I on %I.%I as permissive for %s to authenticated %s %s', p.policyname, p.schemaname, p.tablename, p.cmd,
      case when q is not null then 'using (' || q || ')' else '' end, case when w is not null then 'with check (' || w || ')' else '' end);
  end loop;
end $$;

-- a request or report the Mayor prepared himself is approved by the VP Internal (or the President), never by the Mayor who prepared it
do $$ declare src text; begin
  src := pg_get_functiondef('public.v2_fbr_decide(uuid, boolean, text, text)'::regprocedure);
  src := replace(src, 'if not public.v2_has_role(''mayor'') then raise exception ''Only the President (Mayor) approves a budget request''; end if;',
    'if public.v2_role() not in (''mayor'', ''vp_internal'', ''sails_president'') then raise exception ''Only the Mayor, the VP Internal or the President approves a budget request''; end if;');
  src := replace(src, 'if not found then raise exception ''Request not found''; end if;',
    'if not found then raise exception ''Request not found''; end if; if public.v2_role() = ''mayor'' and r.prepared_by = auth.uid() then raise exception ''You prepared this request. The VP Internal approves it.''; end if;');
  execute src;
  src := pg_get_functiondef('public.v2_liq_decide(uuid, boolean, text, text)'::regprocedure);
  src := replace(src, 'if not public.v2_has_role(''mayor'') then raise exception ''Only the President (Mayor) approves a liquidation report''; end if;',
    'if public.v2_role() not in (''mayor'', ''vp_internal'', ''sails_president'') then raise exception ''Only the Mayor, the VP Internal or the President approves a liquidation report''; end if;');
  src := replace(src, 'if not found then raise exception ''Report not found''; end if;',
    'if not found then raise exception ''Report not found''; end if; if public.v2_role() = ''mayor'' and l.prepared_by_name is not distinct from public.v2__who() then raise exception ''You prepared this report. The VP Internal approves it.''; end if;');
  execute src;
end $$;

-- 5 · the President's own powers: the President account, or the Mayor while no President account exists
do $$ declare f record; src text; p record; q text; w text;
begin
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f'
             and (p.proname like 'v2_coa%' or p.proname like 'v2_trash%' or p.proname in ('v2_approval_tick', 'v2_weekly_summary', 'v2_incident_review', 'v2_vp_president_limit', 'v2_directive_decide')) loop
    src := pg_get_functiondef(f.oid);
    src := replace(src, 'public.v2_has_role(''secretary'', ''mayor'')', '(public.v2_has_role(''secretary'', ''mayor'') or public.v2_is_president())');
    src := replace(src, 'not public.v2_has_role(''mayor'') and', 'not public.v2_is_president() and');
    src := replace(src, 'public.v2_has_role(''mayor'')', 'public.v2_is_president()');
    src := replace(src, 'select user_id from public.v2_profiles where role = ''mayor''', 'select i as user_id from public.v2__president_ids() i');
    src := replace(src, 'public.v2_role() = ''mayor'' and tg_op', 'public.v2_is_president() and tg_op');
    src := replace(src, 'public.v2_role() = ''mayor'' or d.issued_by', 'public.v2_is_president() or d.issued_by');
    execute src;
  end loop;
  for p in select policyname, tablename, qual, with_check from pg_policies where schemaname = 'public' and tablename in ('v2_vp_meetings', 'v2_vp_partners', 'v2_vp_activities') and policyname like '%president_decides' loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
    execute format('create policy %I on public.%I for update to authenticated using (public.v2_is_president()) with check (public.v2_is_president())', p.policyname, p.tablename);
  end loop;
end $$;
drop policy if exists decisions_read on public.v2_decisions;
create policy decisions_read on public.v2_decisions for select to authenticated using (public.v2_is_president() or public.v2_role() = 'auditor');

-- the Marshal desk: the President may see the blocks and the reports referred to him
drop policy if exists blocks_read on public.v2_marshal_blocks;
create policy blocks_read on public.v2_marshal_blocks for select to authenticated using (public.v2_is_president() or public.v2_role() in ('general_marshal', 'dept_marshal'));
drop policy if exists inc_read on public.v2_marshal_incidents;
create policy inc_read on public.v2_marshal_incidents for select to authenticated
  using (reporter_id = auth.uid() or public.v2_role() = 'general_marshal' or (public.v2_is_president() and status = 'referred' and referred_to = 'president'));
do $$ declare src text; begin
  src := pg_get_functiondef('public.v2_marshal_overview()'::regprocedure);
  src := replace(src, '(''mayor'', ''general_marshal'', ''dept_marshal'')', '(''mayor'', ''sails_president'', ''general_marshal'', ''dept_marshal'')');
  execute src;
  src := pg_get_functiondef('public.v2_marshal_block_set(text, uuid)'::regprocedure);
  src := replace(src, '(''general_marshal'', ''mayor'')', '(''general_marshal'', ''sails_president'', ''mayor'')');
  execute src;
end $$;

-- 6 · the chain of command
create or replace function public.v2__directive_may(p_issuer text, p_assignee text) returns boolean
language sql immutable set search_path = '' as $$
  select case p_issuer
    when 'president' then p_assignee in ('vp_internal', 'vp_external', 'general_marshal')
    when 'mayor' then p_assignee in ('vice_mayor', 'secretary', 'treasurer', 'auditor', 'marshall', 'sails', 'pio')
    when 'vp_internal' then p_assignee in ('mayor')
    when 'vp_external' then p_assignee in ('mayor')
    when 'general_marshal' then p_assignee in ('dept_marshal')
    else false end
$$;
create or replace function public.v2__directive_make(p_assignee uuid, p_title text, p_details text, p_due date, p_priority text, p_link text, p_batch uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me text := public.v2__who(); r text := public.v2_role(); a public.v2_profiles; rid uuid; src text;
begin
  if r not in ('mayor', 'sails_president', 'vp_internal', 'vp_external', 'general_marshal') then raise exception 'You cannot issue directives'; end if;
  select * into a from public.v2_profiles where user_id = p_assignee;
  if a.user_id is null or not (public.v2__directive_may(r, a.role) or (public.v2_is_president() and public.v2__directive_may('president', a.role))) then
    raise exception 'You cannot give a directive to that officer';
  end if;
  if p_assignee = auth.uid() then raise exception 'Assign directives to other officers'; end if;
  if p_due is not null and p_due < (now() at time zone 'Asia/Manila')::date then raise exception 'The due date has already passed'; end if;
  if length(btrim(coalesce(p_title, ''))) < 3 then raise exception 'Write the task'; end if;
  src := case when a.role in ('vp_internal', 'vp_external', 'general_marshal') then 'the President' when r = 'vp_internal' then 'the VP Internal' when r = 'vp_external' then 'the VP External' when r = 'general_marshal' then 'the General Marshal' else 'the Class Mayor' end;
  insert into public.v2_directives(title, details, assignee_id, assignee_name, assignee_role, due_on, priority, link_note, issued_by, issued_by_name, issuer_role, batch_id)
  values (btrim(p_title), nullif(btrim(coalesce(p_details, '')), ''), a.user_id, a.full_name, a.role, p_due, coalesce(nullif(p_priority, ''), 'normal'), nullif(btrim(coalesce(p_link, '')), ''), auth.uid(), me, r, p_batch)
  returning id into rid;
  perform public.v2__directive_push(a.user_id, case when p_priority = 'urgent' then '🔴 Urgent directive from ' || src else 'New directive from ' || src end,
    btrim(p_title) || case when p_due is not null then ' · due ' || to_char(p_due, 'Mon FMDD') else '' end || '. Open Alpha ’28 to receive it.');
  return rid;
end $$;
revoke all on function public.v2__directive_make(uuid, text, text, date, text, text, uuid) from public, anon, authenticated;

drop policy if exists dir_read on public.v2_directives;
create policy dir_read on public.v2_directives for select to authenticated
  using (assignee_id = auth.uid() or issued_by = auth.uid() or public.v2_is_president()
         or (public.v2_role() = 'mayor' and assignee_role in ('vice_mayor', 'secretary', 'treasurer', 'auditor', 'marshall', 'sails', 'pio')));

-- 7 · the Class Mayor reports to the VP Internal
create table if not exists public.v2_class_reports (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  mayor_id uuid not null default auth.uid(),
  mayor_name text,
  summary jsonb not null default '{}'::jsonb,
  note text check (note is null or char_length(note) <= 1000),
  submitted_at timestamptz not null default now(),
  reviewed_by_name text,
  reviewed_at timestamptz,
  review_note text,
  unique (mayor_id, week_start)
);
alter table public.v2_class_reports enable row level security;
drop policy if exists creport_read on public.v2_class_reports;
create policy creport_read on public.v2_class_reports for select to authenticated
  using (mayor_id = auth.uid() or public.v2_role() = 'vp_internal' or public.v2_is_president());
revoke all on public.v2_class_reports from anon; grant select on public.v2_class_reports to authenticated;

create table if not exists public.v2_class_asks (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null default auth.uid(),
  from_name text,
  kind text not null default 'other' check (kind in ('funds', 'activity', 'other')),
  title text not null check (char_length(btrim(title)) between 3 and 140),
  details text check (details is null or char_length(details) <= 800),
  amount numeric(12, 2) check (amount is null or amount >= 0),
  status text not null default 'open' check (status in ('open', 'approved', 'declined')),
  decided_by_name text,
  decision_note text,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.v2_class_asks enable row level security;
drop policy if exists casks_read on public.v2_class_asks;
create policy casks_read on public.v2_class_asks for select to authenticated
  using (from_id = auth.uid() or public.v2_role() = 'vp_internal' or public.v2_is_president());
revoke all on public.v2_class_asks from anon; grant select on public.v2_class_asks to authenticated;

-- this week (Monday to Sunday, Manila) as the Mayor's directives show it
create or replace function public.v2_class_report_build() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare wk date := date_trunc('week', (now() at time zone 'Asia/Manila'))::date; today date := (now() at time zone 'Asia/Manila')::date;
begin
  if public.v2_role() <> 'mayor' then raise exception 'Only the Class Mayor writes this report'; end if;
  return jsonb_build_object('week_start', wk,
    'issued', (select count(*) from public.v2_directives where issued_by = auth.uid() and issued_at >= wk::timestamptz),
    'confirmed', (select count(*) from public.v2_directives where issued_by = auth.uid() and status = 'confirmed' and confirmed_at >= wk::timestamptz),
    'open', (select count(*) from public.v2_directives where issued_by = auth.uid() and status in ('sent', 'received', 'working', 'done', 'revoke_asked')),
    'late', coalesce((select jsonb_agg(jsonb_build_object('title', title, 'who', assignee_name, 'due', due_on) order by due_on) from public.v2_directives
                      where issued_by = auth.uid() and status in ('sent', 'received', 'working') and due_on < today), '[]'::jsonb),
    'asks_open', (select count(*) from public.v2_class_asks where from_id = auth.uid() and status = 'open'));
end $$;
grant execute on function public.v2_class_report_build() to authenticated;

create or replace function public.v2_class_report_submit(p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare s jsonb; wk date; v record;
begin
  s := public.v2_class_report_build();
  wk := (s ->> 'week_start')::date;
  insert into public.v2_class_reports(week_start, mayor_name, summary, note) values (wk, public.v2__who(), s, nullif(btrim(coalesce(p_note, '')), ''))
  on conflict (mayor_id, week_start) do update set summary = excluded.summary, note = excluded.note, submitted_at = now(), reviewed_at = null, reviewed_by_name = null, review_note = null;
  for v in select user_id from public.v2_profiles where role = 'vp_internal' loop
    perform public.v2__directive_push(v.user_id, 'Weekly report from ' || public.v2__who(), (s ->> 'open') || ' open · ' || jsonb_array_length(s -> 'late') || ' late. Open Alpha ’28 to read it.');
  end loop;
end $$;
grant execute on function public.v2_class_report_submit(text) to authenticated;

create or replace function public.v2_class_report_review(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.v2_class_reports;
begin
  if public.v2_role() <> 'vp_internal' and not public.v2_is_president() then raise exception 'Only the VP Internal reviews class reports'; end if;
  select * into r from public.v2_class_reports where id = p_id for update;
  if r.id is null then raise exception 'Report not found'; end if;
  update public.v2_class_reports set reviewed_at = now(), reviewed_by_name = public.v2__who(), review_note = nullif(left(btrim(coalesce(p_note, '')), 500), '') where id = p_id;
  perform public.v2__directive_push(r.mayor_id, 'Your weekly report was reviewed', coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'The VP Internal read it.'));
end $$;
grant execute on function public.v2_class_report_review(uuid, text) to authenticated;

create or replace function public.v2_class_ask(p_kind text, p_title text, p_details text, p_amount numeric) returns uuid
language plpgsql security definer set search_path = '' as $$
declare rid uuid; v record;
begin
  if public.v2_role() <> 'mayor' then raise exception 'Only the Class Mayor sends a request up'; end if;
  insert into public.v2_class_asks(from_name, kind, title, details, amount)
  values (public.v2__who(), case when p_kind in ('funds', 'activity') then p_kind else 'other' end, btrim(p_title), nullif(btrim(coalesce(p_details, '')), ''), p_amount) returning id into rid;
  for v in select user_id from public.v2_profiles where role = 'vp_internal' loop
    perform public.v2__directive_push(v.user_id, 'Request from the Class Mayor', btrim(p_title));
  end loop;
  return rid;
end $$;
grant execute on function public.v2_class_ask(text, text, text, numeric) to authenticated;

create or replace function public.v2_class_ask_decide(p_id uuid, p_approve boolean, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.v2_class_asks; n text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if public.v2_role() <> 'vp_internal' and not public.v2_is_president() then raise exception 'Only the VP Internal decides on this'; end if;
  select * into a from public.v2_class_asks where id = p_id for update;
  if a.id is null then raise exception 'Request not found'; end if;
  if a.status <> 'open' then raise exception 'Already decided'; end if;
  if not p_approve and n is null then raise exception 'Say why it is declined'; end if;
  update public.v2_class_asks set status = case when p_approve then 'approved' else 'declined' end, decided_by_name = public.v2__who(), decision_note = left(n, 500), decided_at = now() where id = p_id;
  perform public.v2__directive_push(a.from_id, case when p_approve then 'Request approved' else 'Request declined' end, a.title || coalesce(' · ' || n, ''));
end $$;
grant execute on function public.v2_class_ask_decide(uuid, boolean, text) to authenticated;

-- Friday reminder to Mayors who have not sent this week's report (16:00 Manila)
create or replace function public.v2_class_report_nudge() returns int
language plpgsql security definer set search_path = '' as $$
declare wk date := date_trunc('week', (now() at time zone 'Asia/Manila'))::date; m record; n int := 0;
begin
  for m in select user_id from public.v2_profiles p where role = 'mayor' and not exists (select 1 from public.v2_class_reports r where r.mayor_id = p.user_id and r.week_start = wk) loop
    perform public.v2__directive_push(m.user_id, 'Weekly report due', 'Send this week’s report to the VP Internal. Open Class Mayor › Report up.');
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.v2_class_report_nudge() from public, anon, authenticated;
do $$ begin perform cron.unschedule('alpha28-class-report-nudge'); exception when others then null; end $$;
select cron.schedule('alpha28-class-report-nudge', '0 8 * * 5', $c$select public.v2_class_report_nudge()$c$);
