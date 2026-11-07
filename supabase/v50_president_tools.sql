-- v50 · President tools: memos to Class Mayors / VPs / Marshals with acknowledgment, the council meeting hub (agenda, attendance, minutes,
--       decisions that become directives), recurring and template directives, and "ask a question" on an approval.
-- Requires v36, v44, v46, v49. Safe to run twice.

-- 1 · memos with acknowledgment
create table if not exists public.v2_memos (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 3 and 140),
  body text check (body is null or char_length(body) <= 2000),
  audience text not null check (audience in ('mayors', 'vps', 'marshals', 'all')),
  urgent boolean not null default false,
  created_by uuid default auth.uid(),
  created_by_name text,
  created_at timestamptz not null default now()
);
create table if not exists public.v2_memo_acks (
  memo_id uuid not null references public.v2_memos(id) on delete cascade,
  user_id uuid not null,
  user_name text,
  acked_at timestamptz not null default now(),
  primary key (memo_id, user_id)
);
create or replace function public.v2__memo_for(p_audience text, p_role text) returns boolean
language sql immutable set search_path = '' as $$
  select case p_audience
    when 'mayors' then p_role = 'mayor'
    when 'vps' then p_role in ('vp_internal', 'vp_external')
    when 'marshals' then p_role in ('general_marshal', 'dept_marshal')
    else p_role in ('mayor', 'vp_internal', 'vp_external', 'general_marshal', 'dept_marshal') end
$$;
alter table public.v2_memos enable row level security;
alter table public.v2_memo_acks enable row level security;
drop policy if exists memos_read on public.v2_memos;
create policy memos_read on public.v2_memos for select to authenticated using (public.v2_is_president() or public.v2__memo_for(audience, public.v2_role()));
drop policy if exists acks_read on public.v2_memo_acks;
create policy acks_read on public.v2_memo_acks for select to authenticated using (user_id = auth.uid() or public.v2_is_president());
revoke all on public.v2_memos, public.v2_memo_acks from anon; grant select on public.v2_memos, public.v2_memo_acks to authenticated;

create or replace function public.v2_memo_send(p_title text, p_body text, p_audience text, p_urgent boolean) returns int
language plpgsql security definer set search_path = '' as $$
declare rid uuid; r record; n int := 0;
begin
  if not public.v2_is_president() then raise exception 'Only the SAILS President sends memos'; end if;
  insert into public.v2_memos(title, body, audience, urgent, created_by_name)
  values (btrim(p_title), nullif(btrim(coalesce(p_body, '')), ''), p_audience, coalesce(p_urgent, false), public.v2__who()) returning id into rid;
  for r in select user_id, role from public.v2_profiles where public.v2__memo_for(p_audience, role) and user_id <> auth.uid() loop
    perform public.v2__directive_push(r.user_id, case when p_urgent then '🔴 Urgent memo from the SAILS President' else 'Memo from the SAILS President' end, btrim(p_title) || '. Open Alpha ’28 and acknowledge it.');
    n := n + 1;
  end loop;
  return n;
end $$;
grant execute on function public.v2_memo_send(text, text, text, boolean) to authenticated;

create or replace function public.v2_memo_ack(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.v2_memos;
begin
  select * into m from public.v2_memos where id = p_id;
  if m.id is null or not public.v2__memo_for(m.audience, public.v2_role()) then raise exception 'This memo is not addressed to you'; end if;
  insert into public.v2_memo_acks(memo_id, user_id, user_name) values (p_id, auth.uid(), public.v2__who()) on conflict do nothing;
end $$;
grant execute on function public.v2_memo_ack(uuid) to authenticated;

create or replace function public.v2_memo_status(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare m public.v2_memos;
begin
  if not public.v2_is_president() then raise exception 'Not allowed'; end if;
  select * into m from public.v2_memos where id = p_id;
  return coalesce((select jsonb_agg(jsonb_build_object('name', p.full_name, 'role', p.role, 'acked_at', a.acked_at) order by (a.acked_at is null) desc, p.full_name)
    from public.v2_profiles p left join public.v2_memo_acks a on a.memo_id = p_id and a.user_id = p.user_id
    where public.v2__memo_for(m.audience, p.role) and p.user_id <> m.created_by), '[]'::jsonb);
end $$;
grant execute on function public.v2_memo_status(uuid) to authenticated;

-- 2 · council meeting hub
create table if not exists public.v2_council_meetings (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 3 and 140),
  held_on date not null,
  held_at text,
  venue text,
  agenda text check (agenda is null or char_length(agenda) <= 3000),
  status text not null default 'planned' check (status in ('planned', 'held', 'closed')),
  minutes text check (minutes is null or char_length(minutes) <= 8000),
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.v2_council_attendance (
  meeting_id uuid not null references public.v2_council_meetings(id) on delete cascade,
  person_id uuid not null, person_name text, role text,
  present boolean not null default false,
  primary key (meeting_id, person_id)
);
create table if not exists public.v2_council_actions (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.v2_council_meetings(id) on delete cascade,
  title text not null, owner_id uuid, owner_name text, due_on date, directive_id uuid,
  created_at timestamptz not null default now()
);
do $$ declare t text; begin
  foreach t in array array['v2_council_meetings', 'v2_council_attendance', 'v2_council_actions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.v2_is_president() or public.v2_role() in (''vp_internal'', ''vp_external'', ''general_marshal''))', t || '_read', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

create or replace function public.v2_council_save(p_id uuid, p_title text, p_held_on date, p_held_at text, p_venue text, p_agenda text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare rid uuid := p_id;
begin
  if not public.v2_is_president() then raise exception 'Only the SAILS President runs the council'; end if;
  if rid is null then
    insert into public.v2_council_meetings(title, held_on, held_at, venue, agenda, created_by_name)
    values (btrim(p_title), p_held_on, nullif(btrim(coalesce(p_held_at, '')), ''), nullif(btrim(coalesce(p_venue, '')), ''), nullif(btrim(coalesce(p_agenda, '')), ''), public.v2__who()) returning id into rid;
    insert into public.v2_council_attendance(meeting_id, person_id, person_name, role)
    select rid, user_id, full_name, role from public.v2_profiles where role in ('vp_internal', 'vp_external', 'general_marshal', 'dept_marshal', 'mayor');
  else
    update public.v2_council_meetings set title = btrim(p_title), held_on = p_held_on, held_at = nullif(btrim(coalesce(p_held_at, '')), ''), venue = nullif(btrim(coalesce(p_venue, '')), ''),
      agenda = nullif(btrim(coalesce(p_agenda, '')), ''), updated_at = now() where id = rid and status <> 'closed';
    if not found then raise exception 'That meeting is closed or does not exist'; end if;
  end if;
  return rid;
end $$;
grant execute on function public.v2_council_save(uuid, text, date, text, text, text) to authenticated;

create or replace function public.v2_council_attend(p_meeting uuid, p_present uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.v2_is_president() then raise exception 'Only the SAILS President takes attendance'; end if;
  update public.v2_council_attendance set present = (person_id = any(coalesce(p_present, '{}'))) where meeting_id = p_meeting;
  update public.v2_council_meetings set status = 'held', updated_at = now() where id = p_meeting and status = 'planned';
end $$;
grant execute on function public.v2_council_attend(uuid, uuid[]) to authenticated;

create or replace function public.v2_council_close(p_id uuid, p_minutes text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.v2_is_president() then raise exception 'Only the SAILS President closes a meeting'; end if;
  if char_length(btrim(coalesce(p_minutes, ''))) < 5 then raise exception 'Write the minutes first'; end if;
  update public.v2_council_meetings set minutes = btrim(p_minutes), status = 'closed', updated_at = now() where id = p_id;
end $$;
grant execute on function public.v2_council_close(uuid, text) to authenticated;

-- a decision of the council becomes a directive in one step (the President can direct the VPs and the General Marshal)
create or replace function public.v2_council_action(p_meeting uuid, p_title text, p_owner uuid, p_due date, p_details text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare m public.v2_council_meetings; o public.v2_profiles; did uuid; rid uuid;
begin
  if not public.v2_is_president() then raise exception 'Only the SAILS President assigns council decisions'; end if;
  select * into m from public.v2_council_meetings where id = p_meeting;
  if m.id is null then raise exception 'Meeting not found'; end if;
  select * into o from public.v2_profiles where user_id = p_owner;
  if o.user_id is null then raise exception 'Choose who carries it out'; end if;
  did := public.v2__directive_make(p_owner, p_title, p_details, p_due, 'normal', 'Council · ' || m.title, null);
  insert into public.v2_council_actions(meeting_id, title, owner_id, owner_name, due_on, directive_id) values (p_meeting, btrim(p_title), p_owner, o.full_name, p_due, did) returning id into rid;
  return rid;
end $$;
grant execute on function public.v2_council_action(uuid, text, uuid, date, text) to authenticated;

create or replace function public.v2_council_delete(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.v2_is_president() then raise exception 'Only the SAILS President removes a meeting'; end if;
  delete from public.v2_council_meetings where id = p_id and status = 'planned';
  if not found then raise exception 'Only a meeting that has not happened can be removed'; end if;
end $$;
grant execute on function public.v2_council_delete(uuid) to authenticated;

-- 3 · recurring and template directives
create table if not exists public.v2_directive_templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  owner_name text,
  title text not null check (char_length(btrim(title)) between 3 and 140),
  details text check (details is null or char_length(details) <= 800),
  to_role text not null,
  kind text not null default 'manual' check (kind in ('manual', 'weekly', 'monthly')),
  weekday int check (weekday between 1 and 7),
  month_day int check (month_day between 1 and 28),
  due_in int not null default 3 check (due_in between 0 and 30),
  active boolean not null default true,
  last_run date,
  created_at timestamptz not null default now()
);
alter table public.v2_directive_templates enable row level security;
drop policy if exists tpl_read on public.v2_directive_templates;
create policy tpl_read on public.v2_directive_templates for select to authenticated using (owner_id = auth.uid());
revoke all on public.v2_directive_templates from anon; grant select on public.v2_directive_templates to authenticated;

-- the same chain rules as v2__directive_make, for an issuer who is not the signed-in user (the schedule runs without a login)
create or replace function public.v2__directive_make_for(p_issuer uuid, p_assignee uuid, p_title text, p_details text, p_due date, p_link text, p_batch uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare i public.v2_profiles; a public.v2_profiles; rid uuid; src text;
begin
  select * into i from public.v2_profiles where user_id = p_issuer;
  select * into a from public.v2_profiles where user_id = p_assignee;
  if i.user_id is null or a.user_id is null or i.user_id = a.user_id then return null; end if;
  if not (public.v2__directive_may(i.role, a.role)
          or ((i.role = 'sails_president' or (i.role = 'mayor' and not public.v2_president_exists())) and public.v2__directive_may('president', a.role))) then return null; end if;
  src := case when a.role in ('vp_internal', 'vp_external', 'general_marshal') then 'the President' when i.role = 'vp_internal' then 'the VP Internal' when i.role = 'vp_external' then 'the VP External' when i.role = 'general_marshal' then 'the General Marshal' else 'the Class Mayor' end;
  insert into public.v2_directives(title, details, assignee_id, assignee_name, assignee_role, due_on, priority, link_note, issued_by, issued_by_name, issuer_role, batch_id)
  values (btrim(p_title), nullif(btrim(coalesce(p_details, '')), ''), a.user_id, a.full_name, a.role, p_due, 'normal', p_link, i.user_id, i.full_name, i.role, p_batch) returning id into rid;
  perform public.v2__directive_push(a.user_id, 'New directive from ' || src, btrim(p_title) || case when p_due is not null then ' · due ' || to_char(p_due, 'Mon FMDD') else '' end || '. Open Alpha ’28 to receive it.');
  return rid;
end $$;
revoke all on function public.v2__directive_make_for(uuid, uuid, text, text, date, text, uuid) from public, anon, authenticated;

create or replace function public.v2__template_run(p_id uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare t public.v2_directive_templates; u record; n int := 0; b uuid := gen_random_uuid(); today date := (now() at time zone 'Asia/Manila')::date;
begin
  select * into t from public.v2_directive_templates where id = p_id;
  if t.id is null then return 0; end if;
  for u in select user_id from public.v2_profiles where role = t.to_role loop
    if public.v2__directive_make_for(t.owner_id, u.user_id, t.title, t.details, today + t.due_in, 'Recurring task', b) is not null then n := n + 1; end if;
  end loop;
  update public.v2_directive_templates set last_run = today where id = p_id;
  return n;
end $$;
revoke all on function public.v2__template_run(uuid) from public, anon, authenticated;

create or replace function public.v2_template_save(p_id uuid, p_title text, p_details text, p_to_role text, p_kind text, p_weekday int, p_month_day int, p_due_in int, p_active boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r text := public.v2_role(); rid uuid := p_id;
begin
  if r not in ('mayor', 'sails_president', 'vp_internal', 'vp_external', 'general_marshal') then raise exception 'Only an officer who gives directives can make templates'; end if;
  if not (public.v2__directive_may(r, p_to_role) or (public.v2_is_president() and public.v2__directive_may('president', p_to_role))) then raise exception 'You cannot give directives to that role'; end if;
  if rid is null then
    insert into public.v2_directive_templates(owner_name, title, details, to_role, kind, weekday, month_day, due_in, active)
    values (public.v2__who(), btrim(p_title), nullif(btrim(coalesce(p_details, '')), ''), p_to_role, p_kind, case when p_kind = 'weekly' then p_weekday end, case when p_kind = 'monthly' then p_month_day end, coalesce(p_due_in, 3), coalesce(p_active, true)) returning id into rid;
  else
    update public.v2_directive_templates set title = btrim(p_title), details = nullif(btrim(coalesce(p_details, '')), ''), to_role = p_to_role, kind = p_kind,
      weekday = case when p_kind = 'weekly' then p_weekday end, month_day = case when p_kind = 'monthly' then p_month_day end, due_in = coalesce(p_due_in, 3), active = coalesce(p_active, true)
    where id = rid and owner_id = auth.uid();
    if not found then raise exception 'Template not found'; end if;
  end if;
  return rid;
end $$;
grant execute on function public.v2_template_save(uuid, text, text, text, text, int, int, int, boolean) to authenticated;

create or replace function public.v2_template_send_now(p_id uuid) returns int
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.v2_directive_templates where id = p_id and owner_id = auth.uid()) then raise exception 'Template not found'; end if;
  return public.v2__template_run(p_id);
end $$;
grant execute on function public.v2_template_send_now(uuid) to authenticated;

create or replace function public.v2_template_delete(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.v2_directive_templates where id = p_id and owner_id = auth.uid();
end $$;
grant execute on function public.v2_template_delete(uuid) to authenticated;

create or replace function public.v2_template_tick() returns int
language plpgsql security definer set search_path = '' as $$
declare today date := (now() at time zone 'Asia/Manila')::date; t record; n int := 0;
begin
  for t in select id from public.v2_directive_templates where active and last_run is distinct from today
           and ((kind = 'weekly' and weekday = extract(isodow from today)::int) or (kind = 'monthly' and month_day = extract(day from today)::int)) loop
    n := n + public.v2__template_run(t.id);
  end loop;
  return n;
end $$;
revoke all on function public.v2_template_tick() from public, anon, authenticated;
do $$ begin perform cron.unschedule('alpha28-template-tick'); exception when others then null; end $$;
select cron.schedule('alpha28-template-tick', '0 23 * * *', $c$select public.v2_template_tick()$c$);   -- 07:00 Manila

-- 4 · ask a question before deciding
create table if not exists public.v2_approval_questions (
  id uuid primary key default gen_random_uuid(),
  src text not null check (src in ('vp_meeting', 'vp_partner', 'vp_activity', 'record', 'coa')),
  src_id uuid not null,
  item_title text,
  asked_by uuid default auth.uid(),
  asked_by_name text,
  to_user uuid,
  to_name text,
  question text not null check (char_length(btrim(question)) between 3 and 500),
  answer text check (answer is null or char_length(answer) <= 800),
  answered_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.v2_approval_questions enable row level security;
drop policy if exists aq_read on public.v2_approval_questions;
create policy aq_read on public.v2_approval_questions for select to authenticated using (asked_by = auth.uid() or to_user = auth.uid() or public.v2_is_president());
revoke all on public.v2_approval_questions from anon; grant select on public.v2_approval_questions to authenticated;

create or replace function public.v2_question_ask(p_src text, p_id uuid, p_question text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare who uuid; ttl text; rid uuid; nm text;
begin
  if not public.v2_is_president() then raise exception 'Only the SAILS President asks questions on approvals'; end if;
  if p_src = 'vp_meeting' then select created_by, title into who, ttl from public.v2_vp_meetings where id = p_id;
  elsif p_src = 'vp_partner' then select created_by, name into who, ttl from public.v2_vp_partners where id = p_id;
  elsif p_src = 'vp_activity' then select created_by, title into who, ttl from public.v2_vp_activities where id = p_id;
  elsif p_src = 'coa' then select created_by, title into who, ttl from public.v2_coa where id = p_id;
  elsif p_src = 'record' then select created_by, title into who, ttl from public.v2_office_records where id = p_id;
  else raise exception 'Unknown item'; end if;
  if ttl is null then raise exception 'Item not found'; end if;
  if who is null then raise exception 'We do not know who wrote this item'; end if;
  select full_name into nm from public.v2_profiles where user_id = who;
  insert into public.v2_approval_questions(src, src_id, item_title, asked_by_name, to_user, to_name, question)
  values (p_src, p_id, ttl, public.v2__who(), who, nm, btrim(p_question)) returning id into rid;
  perform public.v2__directive_push(who, 'A question from the President', ttl || ' · ' || left(btrim(p_question), 100));
  return rid;
end $$;
grant execute on function public.v2_question_ask(text, uuid, text) to authenticated;

create or replace function public.v2_question_answer(p_id uuid, p_answer text) returns void
language plpgsql security definer set search_path = '' as $$
declare q public.v2_approval_questions;
begin
  select * into q from public.v2_approval_questions where id = p_id for update;
  if q.id is null or q.to_user <> auth.uid() then raise exception 'That question is not addressed to you'; end if;
  if q.answer is not null then raise exception 'Already answered'; end if;
  if char_length(btrim(coalesce(p_answer, ''))) < 2 then raise exception 'Write your answer'; end if;
  update public.v2_approval_questions set answer = left(btrim(p_answer), 800), answered_at = now() where id = p_id;
  perform public.v2__directive_push(q.asked_by, 'Answer to your question', coalesce(q.item_title, 'Your question') || ' · ' || left(btrim(p_answer), 100));
end $$;
grant execute on function public.v2_question_answer(uuid, text) to authenticated;
