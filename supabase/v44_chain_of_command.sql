-- v44 · Chain of command, waiting alerts, decision history, routine meetings, many-at-once directives, Monday summary.
-- Run v36 (Directives), v28 (VP desks), v30 (document flow) and v42 (Calendar) first. Safe to run twice.
--
--  1. COMMAND CHAIN   The President directs every officer. VP Internal directs the Secretary, Marshals and PIOs; VP External directs the PIOs.
--                     The Treasurer and the Auditor take directives from the President only. Whoever issues a directive confirms, returns or cancels it.
--  3. WAITING ALERTS  A proposal waiting more than 3 days for the President is flagged; the President and the proposer get a phone alert (at most every 2 days).
--  4. HISTORY         Every approval, return and cancellation is written to a decision log the President can read, filter and print.
--  5. ROUTINE         A plain meeting written by VP Internal needs no approval. Programs, partners and joint activities still go up.
--  6. MANY AT ONCE    One directive can go to several officers, or to everyone, in one step (each gets their own copy to answer).
--  7. MONDAY          Every Monday 7:30 a.m. the President gets a week-ahead summary; officers with open directives get a reminder.

-- ---------------------------------------------------------------------------------------------- 1 + 6 · directives
alter table public.v2_directives add column if not exists batch_id uuid;
alter table public.v2_directives add column if not exists issuer_role text;

drop policy if exists dir_read on public.v2_directives;
create policy dir_read on public.v2_directives for select to authenticated
  using (assignee_id = auth.uid() or issued_by = auth.uid() or public.v2_role() in ('mayor', 'vice_mayor'));

create or replace function public.v2__directive_may(p_issuer text, p_assignee text) returns boolean
language sql immutable set search_path = '' as $$
  select case p_issuer
    when 'mayor' then p_assignee in ('vice_mayor', 'vp_internal', 'vp_external', 'secretary', 'treasurer', 'auditor', 'marshall', 'sails', 'pio')
    when 'vp_internal' then p_assignee in ('secretary', 'marshall', 'pio')
    when 'vp_external' then p_assignee in ('pio')
    else false end
$$;

create or replace function public.v2__directive_make(p_assignee uuid, p_title text, p_details text, p_due date, p_priority text, p_link text, p_batch uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me text := public.v2__who(); r text := public.v2_role(); a public.v2_profiles; rid uuid; src text;
begin
  if r not in ('mayor', 'vp_internal', 'vp_external') then raise exception 'Only the President or a Vice President can issue directives'; end if;
  select * into a from public.v2_profiles where user_id = p_assignee;
  if a.user_id is null or not public.v2__directive_may(r, a.role) then raise exception 'You cannot give a directive to that officer'; end if;
  if p_assignee = auth.uid() then raise exception 'Assign directives to other officers'; end if;
  if p_due is not null and p_due < (now() at time zone 'Asia/Manila')::date then raise exception 'The due date has already passed'; end if;
  if length(btrim(coalesce(p_title, ''))) < 3 then raise exception 'Write the task'; end if;
  src := case r when 'mayor' then 'the President' when 'vp_internal' then 'the VP Internal' else 'the VP External' end;
  insert into public.v2_directives(title, details, assignee_id, assignee_name, assignee_role, due_on, priority, link_note, issued_by, issued_by_name, issuer_role, batch_id)
  values (btrim(p_title), nullif(btrim(coalesce(p_details, '')), ''), a.user_id, a.full_name, a.role, p_due, coalesce(nullif(p_priority, ''), 'normal'), nullif(btrim(coalesce(p_link, '')), ''), auth.uid(), me, r, p_batch)
  returning id into rid;
  perform public.v2__directive_push(a.user_id, case when p_priority = 'urgent' then '🔴 Urgent directive from ' || src else 'New directive from ' || src end,
    btrim(p_title) || case when p_due is not null then ' · due ' || to_char(p_due, 'Mon FMDD') else '' end || '. Open Alpha ’28 to receive it.');
  return rid;
end $$;
revoke all on function public.v2__directive_make(uuid, text, text, date, text, text, uuid) from public, anon, authenticated;

create or replace function public.v2_directive_issue(p_assignee uuid, p_title text, p_details text, p_due date, p_priority text, p_link text)
returns uuid language plpgsql security definer set search_path = '' as $$
begin return public.v2__directive_make(p_assignee, p_title, p_details, p_due, p_priority, p_link, null); end $$;
grant execute on function public.v2_directive_issue(uuid, text, text, date, text, text) to authenticated;

create or replace function public.v2_directive_issue_many(p_assignees uuid[], p_title text, p_details text, p_due date, p_priority text, p_link text)
returns int language plpgsql security definer set search_path = '' as $$
declare u uuid; n int := 0; b uuid := gen_random_uuid(); ids uuid[] := array(select distinct x from unnest(coalesce(p_assignees, '{}'::uuid[])) x where x is not null and x <> auth.uid());
begin
  if coalesce(array_length(ids, 1), 0) = 0 then raise exception 'Choose at least one officer'; end if;
  if array_length(ids, 1) > 60 then raise exception 'That is too many officers for one directive'; end if;
  foreach u in array ids loop perform public.v2__directive_make(u, p_title, p_details, p_due, p_priority, p_link, b); n := n + 1; end loop;
  return n;
end $$;
grant execute on function public.v2_directive_issue_many(uuid[], text, text, date, text, text) to authenticated;

-- whoever issued a directive (or the President) confirms, returns, releases, keeps or cancels it
create or replace function public.v2_directive_decide(p_id uuid, p_action text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.v2_directives; nt text := nullif(btrim(coalesce(p_note, '')), ''); who text := public.v2__who();
begin
  select * into d from public.v2_directives where id = p_id;
  if d.id is null then raise exception 'Unknown directive'; end if;
  if not (public.v2_role() = 'mayor' or d.issued_by = auth.uid()) then raise exception 'Only the officer who issued this directive can decide on it'; end if;
  if p_action = 'confirm' then
    if d.status <> 'done' then raise exception 'Not finished yet'; end if;
    update public.v2_directives set status = 'confirmed', confirmed_at = now(), updated_at = now() where id = p_id;
  elsif p_action = 'return' then
    if d.status <> 'done' then raise exception 'Not finished yet'; end if;
    if nt is null then raise exception 'Tell them what to fix'; end if;
    update public.v2_directives set status = 'working', return_note = nt, done_at = null, updated_at = now() where id = p_id;
    perform public.v2__directive_push(d.assignee_id, 'Directive returned by ' || who, d.title || ' — ' || nt);
  elsif p_action = 'release' then
    if d.status <> 'revoke_asked' then raise exception 'No release request'; end if;
    update public.v2_directives set status = 'revoked', revoke_answer = coalesce(nt, 'Released'), updated_at = now() where id = p_id;
    perform public.v2__directive_push(d.assignee_id, 'You are released from a directive', d.title);
  elsif p_action = 'keep' then
    if d.status <> 'revoke_asked' then raise exception 'No release request'; end if;
    if nt is null then raise exception 'Give a reason for keeping it'; end if;
    update public.v2_directives set status = 'working', revoke_answer = nt, updated_at = now() where id = p_id;
    perform public.v2__directive_push(d.assignee_id, 'Release declined by ' || who, d.title || ' — ' || nt);
  elsif p_action = 'cancel' then
    if d.status in ('confirmed', 'revoked') then raise exception 'Already closed'; end if;
    update public.v2_directives set status = 'revoked', revoke_answer = coalesce(nt, 'Cancelled by ' || who), updated_at = now() where id = p_id;
    perform public.v2__directive_push(d.assignee_id, 'Directive cancelled', d.title);
  else raise exception 'Unknown action'; end if;
end $$;
grant execute on function public.v2_directive_decide(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------- 4 · decision history
create table if not exists public.v2_decisions (
  id uuid primary key default gen_random_uuid(),
  src text not null check (src in ('vp_meeting', 'vp_partner', 'vp_activity', 'record', 'coa')),
  src_id uuid not null,
  title text not null,
  decision text not null check (decision in ('approved', 'returned', 'cancelled')),
  note text,
  proposer_name text,
  decided_by uuid default auth.uid(),
  decided_by_name text,
  decided_at timestamptz not null default now()
);
create index if not exists v2_decisions_at on public.v2_decisions (decided_at desc);
alter table public.v2_decisions enable row level security;
drop policy if exists decisions_read on public.v2_decisions;
create policy decisions_read on public.v2_decisions for select to authenticated using (public.v2_role() in ('mayor', 'vice_mayor', 'auditor', 'secretary'));
revoke all on public.v2_decisions from anon;
grant select on public.v2_decisions to authenticated;

create or replace function public.v2__log_decision() returns trigger
language plpgsql security definer set search_path = '' as $$
declare col text := tg_argv[1]; o jsonb := to_jsonb(old); n jsonb := to_jsonb(new); oldv text; newv text; dec text;
begin
  oldv := o ->> col; newv := n ->> col;
  if oldv is not distinct from newv then return new; end if;
  dec := case when newv in ('approved', 'active') and oldv in ('proposed', 'reviewed') then 'approved'
              when newv = 'returned' and oldv in ('proposed', 'reviewed') then 'returned'
              when newv = 'cancelled' and tg_argv[0] in ('coa', 'vp_meeting') then 'cancelled' end;
  if dec is null then return new; end if;
  insert into public.v2_decisions(src, src_id, title, decision, note, proposer_name, decided_by_name)
  values (tg_argv[0], (n ->> 'id')::uuid, coalesce(n ->> 'title', n ->> 'name', 'Untitled'), dec,
          coalesce(n ->> 'mayor_note', n ->> 'flow_note', n ->> 'return_note'), coalesce(n ->> 'created_by_name', n ->> 'reviewed_by_name'), public.v2__who());
  return new;
end $$;
revoke all on function public.v2__log_decision() from public, anon, authenticated;
drop trigger if exists v2_vp_meetings_zlog on public.v2_vp_meetings;
create trigger v2_vp_meetings_zlog after update on public.v2_vp_meetings for each row execute function public.v2__log_decision('vp_meeting', 'status');
drop trigger if exists v2_vp_partners_zlog on public.v2_vp_partners;
create trigger v2_vp_partners_zlog after update on public.v2_vp_partners for each row execute function public.v2__log_decision('vp_partner', 'status');
drop trigger if exists v2_vp_activities_zlog on public.v2_vp_activities;
create trigger v2_vp_activities_zlog after update on public.v2_vp_activities for each row execute function public.v2__log_decision('vp_activity', 'status');
drop trigger if exists v2_office_records_zlog on public.v2_office_records;
create trigger v2_office_records_zlog after update on public.v2_office_records for each row when (old.flow is distinct from new.flow) execute function public.v2__log_decision('record', 'flow');
drop trigger if exists v2_coa_zlog on public.v2_coa;
create trigger v2_coa_zlog after update on public.v2_coa for each row when (old.status is distinct from new.status) execute function public.v2__log_decision('coa', 'status');

-- ---------------------------------------------------------------------------------------------- 5 · routine meetings
create or replace function public.v2_vp_routine() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'meeting' and new.status = 'proposed' and public.v2_role() in ('vp_internal', 'vice_mayor') then
    new.status := 'approved'; new.mayor_note := 'Routine meeting: no approval needed';
  end if;
  return new;
end $$;
revoke all on function public.v2_vp_routine() from public, anon;
drop trigger if exists v2_vp_meetings_routine on public.v2_vp_meetings;
create trigger v2_vp_meetings_routine before insert on public.v2_vp_meetings for each row execute function public.v2_vp_routine();   -- runs after v2_vp_meetings_guard (alphabetical)

-- ---------------------------------------------------------------------------------------------- 3 · waiting alerts
create table if not exists public.v2_approval_nudges (src text not null, src_id uuid not null, last_on date not null, primary key (src, src_id));
alter table public.v2_approval_nudges enable row level security;
revoke all on public.v2_approval_nudges from anon, authenticated;

create or replace function public.v2__late_items() returns table (src text, src_id uuid, title text, owner uuid, since timestamptz)
language sql stable security definer set search_path = '' as $$
  select * from (
    select 'vp_meeting'::text, id, title, created_by, updated_at from public.v2_vp_meetings where status = 'proposed' and updated_at < now() - interval '3 days'
    union all select 'vp_partner', id, name, created_by, updated_at from public.v2_vp_partners where status = 'proposed' and updated_at < now() - interval '3 days'
    union all select 'vp_activity', id, title, created_by, updated_at from public.v2_vp_activities where status = 'proposed' and updated_at < now() - interval '3 days'
    union all select 'record', id, title, null::uuid, reviewed_at from public.v2_office_records where flow = 'reviewed' and reviewed_at < now() - interval '3 days'
    union all select 'coa', id, title, created_by, submitted_at from public.v2_coa where status = 'proposed' and submitted_at < now() - interval '3 days') x(src, src_id, title, owner, since)
$$;
revoke all on function public.v2__late_items() from public, anon, authenticated;

create or replace function public.v2_approval_tick() returns int
language plpgsql security definer set search_path = '' as $$
declare today date := (now() at time zone 'Asia/Manila')::date; nowm time := (now() at time zone 'Asia/Manila')::time; n int := 0; r record; m record; late int;
begin
  if nowm < time '07:00' or nowm > time '18:00' then return 0; end if;
  select count(*) into late from public.v2__late_items() l where not exists (select 1 from public.v2_approval_nudges k where k.src = l.src and k.src_id = l.src_id and k.last_on > today - 2);
  if late = 0 then return 0; end if;
  for r in select * from public.v2__late_items() l where not exists (select 1 from public.v2_approval_nudges k where k.src = l.src and k.src_id = l.src_id and k.last_on > today - 2) loop
    if r.owner is not null then perform public.v2__directive_push(r.owner, 'Still waiting for the President', r.title || ' · ' || extract(day from now() - r.since)::int || ' days'); end if;
    insert into public.v2_approval_nudges values (r.src, r.src_id, today) on conflict (src, src_id) do update set last_on = today;
    n := n + 1;
  end loop;
  for m in select user_id from public.v2_profiles where role = 'mayor' loop
    perform public.v2__directive_push(m.user_id, late || ' item' || case when late = 1 then '' else 's' end || ' waiting more than 3 days', 'Open President Desk › VP approvals to decide.');
  end loop;
  return n;
end $$;
revoke all on function public.v2_approval_tick() from public, anon, authenticated;
do $$ begin perform cron.unschedule('alpha28-approval-tick'); exception when others then null; end $$;
select cron.schedule('alpha28-approval-tick', '*/30 * * * *', $c$select public.v2_approval_tick()$c$);

-- ---------------------------------------------------------------------------------------------- 7 · Monday summary
create or replace function public.v2_weekly_summary() returns int
language plpgsql security definer set search_path = '' as $$
declare today date := (now() at time zone 'Asia/Manila')::date; n int := 0; m record; o record; wait int; od int; open_n int; done_n int; ahead int;
begin
  select (select count(*) from public.v2_vp_meetings where status = 'proposed') + (select count(*) from public.v2_vp_partners where status = 'proposed')
       + (select count(*) from public.v2_vp_activities where status = 'proposed') + (select count(*) from public.v2_office_records where flow = 'reviewed')
       + (select count(*) from public.v2_coa where status = 'proposed') into wait;
  select count(*) into od from public.v2_directives where status in ('sent', 'received', 'working') and due_on < today;
  select count(*) into open_n from public.v2_directives where status in ('sent', 'received', 'working', 'done', 'revoke_asked');
  select count(*) into done_n from public.v2_directives where status = 'confirmed' and confirmed_at > now() - interval '7 days';
  select count(*) into ahead from public.v2_coa where status = 'approved' and starts_on between today and today + 7;
  for m in select user_id from public.v2_profiles where role = 'mayor' loop
    perform public.v2__directive_push(m.user_id, 'Your week ahead',
      wait || ' waiting for you · ' || open_n || ' directives open (' || od || ' overdue) · ' || done_n || ' finished last week · ' || ahead || ' activities in the next 7 days');
    n := n + 1;
  end loop;
  for o in select assignee_id, count(*) c, count(*) filter (where due_on < today) late from public.v2_directives where status in ('sent', 'received', 'working') group by assignee_id loop
    perform public.v2__directive_push(o.assignee_id, 'Directives for you this week', o.c || ' open' || case when o.late > 0 then ', ' || o.late || ' overdue' else '' end || '. Open Alpha ’28 to update them.');
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.v2_weekly_summary() from public, anon, authenticated;
do $$ begin perform cron.unschedule('alpha28-weekly-summary'); exception when others then null; end $$;
select cron.schedule('alpha28-weekly-summary', '30 23 * * 0', $c$select public.v2_weekly_summary()$c$);   -- Sunday 23:30 UTC = Monday 7:30 a.m. in Manila
