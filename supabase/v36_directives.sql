-- v36 · Directives: the Mayor/President assigns a task to any officer; the officer is alerted on their phone right away.
-- Only the Mayor issues. The officer receives -> works -> marks done (with a note); the Mayor confirms.
-- An officer who cannot do it asks to be released ("revoke"); the Mayor approves or declines.
-- Safe to run twice.

create table if not exists public.v2_directives (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 3 and 140),
  details text,
  assignee_id uuid not null,
  assignee_name text not null,
  assignee_role text,
  due_on date,                                   -- optional
  priority text not null default 'normal' check (priority in ('low','normal','urgent')),
  link_note text,                                -- optional: event / budget request / document it relates to
  status text not null default 'sent' check (status in ('sent','received','working','done','confirmed','revoke_asked','revoked')),
  issued_by uuid, issued_by_name text,
  issued_at timestamptz not null default now(),
  received_at timestamptz, started_at timestamptz,
  done_at timestamptz, done_note text,
  confirmed_at timestamptz, return_note text,
  revoke_reason text, revoke_asked_at timestamptz, revoke_answer text,
  last_nudge_on date,
  updated_at timestamptz not null default now()
);
create index if not exists v2_directives_assignee_idx on public.v2_directives(assignee_id, status);
alter table public.v2_directives enable row level security;

drop policy if exists dir_read on public.v2_directives;
create policy dir_read on public.v2_directives for select to authenticated
  using (assignee_id = auth.uid() or public.v2_has_role('mayor','vice_mayor'));
-- no insert/update/delete policies: everything goes through the functions below.
revoke all on public.v2_directives from anon;
grant select on public.v2_directives to authenticated;

-- phone alert to one officer (uses the same hook as the duty alerts)
create or replace function public.v2__directive_push(p_user uuid, p_title text, p_body text) returns void
language plpgsql security definer set search_path = '' as $$
declare s text;
begin
  select convert_from(value, 'UTF8') into s from public.v2_secrets where key = 'push_hook';
  if s is null then return; end if;
  begin
    perform net.http_post(url := 'https://gxwgkbplscsduscoeoph.supabase.co/functions/v1/notify-announcement',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-secret', s),
      body := jsonb_build_object('kind', 'duty', 'items', jsonb_build_array(jsonb_build_object('user_id', p_user, 'title', p_title, 'body', p_body))));
  exception when others then null; end;
end $$;
revoke all on function public.v2__directive_push(uuid, text, text) from public, anon, authenticated;

-- Mayor issues
create or replace function public.v2_directive_issue(p_assignee uuid, p_title text, p_details text, p_due date, p_priority text, p_link text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me text; a public.v2_profiles; rid uuid;
begin
  if not public.v2_has_role('mayor') then raise exception 'Only the Mayor can issue directives'; end if;
  select * into a from public.v2_profiles where user_id = p_assignee;
  if a.user_id is null or a.role not in ('vice_mayor','vp_internal','vp_external','secretary','treasurer','auditor','marshall','sails','pio') then
    raise exception 'Pick an officer to assign this to'; end if;
  if p_assignee = auth.uid() then raise exception 'Assign directives to other officers'; end if;
  if p_due is not null and p_due < (now() at time zone 'Asia/Manila')::date then raise exception 'The due date has already passed'; end if;
  select full_name into me from public.v2_profiles where user_id = auth.uid();
  insert into public.v2_directives(title, details, assignee_id, assignee_name, assignee_role, due_on, priority, link_note, issued_by, issued_by_name)
  values (btrim(p_title), nullif(btrim(coalesce(p_details,'')), ''), a.user_id, a.full_name, a.role, p_due, coalesce(nullif(p_priority,''),'normal'), nullif(btrim(coalesce(p_link,'')), ''), auth.uid(), me)
  returning id into rid;
  perform public.v2__directive_push(a.user_id, case when p_priority = 'urgent' then '🔴 Urgent directive from the Mayor' else 'New directive from the Mayor' end,
    btrim(p_title) || case when p_due is not null then ' · due ' || to_char(p_due, 'Mon FMDD') else '' end || '. Open Alpha ’28 to receive it.');
  return rid;
end $$;
grant execute on function public.v2_directive_issue(uuid, text, text, date, text, text) to authenticated;

-- Officer actions: receive | work | done | revoke
create or replace function public.v2_directive_act(p_id uuid, p_action text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.v2_directives; nt text := nullif(btrim(coalesce(p_note,'')), '');
begin
  select * into d from public.v2_directives where id = p_id;
  if d.id is null or d.assignee_id <> auth.uid() then raise exception 'That directive is not assigned to you'; end if;
  if p_action = 'receive' then
    if d.status <> 'sent' then raise exception 'Already received'; end if;
    update public.v2_directives set status = 'received', received_at = now(), updated_at = now() where id = p_id;
  elsif p_action = 'work' then
    if d.status not in ('received','sent') then raise exception 'Cannot start from here'; end if;
    update public.v2_directives set status = 'working', received_at = coalesce(received_at, now()), started_at = now(), updated_at = now() where id = p_id;
  elsif p_action = 'done' then
    if d.status not in ('received','working','sent') then raise exception 'Cannot finish from here'; end if;
    if nt is null then raise exception 'Add a short note on what was done'; end if;
    update public.v2_directives set status = 'done', received_at = coalesce(received_at, now()), done_at = now(), done_note = nt, return_note = null, updated_at = now() where id = p_id;
    perform public.v2__directive_push(d.issued_by, d.assignee_name || ' finished a directive', d.title || ' — waiting for your confirmation.');
  elsif p_action = 'revoke' then
    if d.status not in ('sent','received','working') then raise exception 'Cannot ask to be released now'; end if;
    if nt is null then raise exception 'Say why you cannot do this'; end if;
    update public.v2_directives set status = 'revoke_asked', revoke_reason = nt, revoke_asked_at = now(), updated_at = now() where id = p_id;
    perform public.v2__directive_push(d.issued_by, d.assignee_name || ' asks to be released', d.title || ' — ' || nt);
  else raise exception 'Unknown action';
  end if;
end $$;
grant execute on function public.v2_directive_act(uuid, text, text) to authenticated;

-- Mayor actions: confirm | return | release | keep | cancel
create or replace function public.v2_directive_decide(p_id uuid, p_action text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.v2_directives; nt text := nullif(btrim(coalesce(p_note,'')), '');
begin
  if not public.v2_has_role('mayor') then raise exception 'Only the Mayor can decide'; end if;
  select * into d from public.v2_directives where id = p_id;
  if d.id is null then raise exception 'Unknown directive'; end if;
  if p_action = 'confirm' then
    if d.status <> 'done' then raise exception 'Not finished yet'; end if;
    update public.v2_directives set status = 'confirmed', confirmed_at = now(), updated_at = now() where id = p_id;
  elsif p_action = 'return' then
    if d.status <> 'done' then raise exception 'Not finished yet'; end if;
    if nt is null then raise exception 'Tell them what to fix'; end if;
    update public.v2_directives set status = 'working', return_note = nt, done_at = null, updated_at = now() where id = p_id;
    perform public.v2__directive_push(d.assignee_id, 'Directive returned by the Mayor', d.title || ' — ' || nt);
  elsif p_action = 'release' then
    if d.status <> 'revoke_asked' then raise exception 'No release request'; end if;
    update public.v2_directives set status = 'revoked', revoke_answer = coalesce(nt, 'Released'), updated_at = now() where id = p_id;
    perform public.v2__directive_push(d.assignee_id, 'You are released from a directive', d.title);
  elsif p_action = 'keep' then
    if d.status <> 'revoke_asked' then raise exception 'No release request'; end if;
    if nt is null then raise exception 'Give a reason for keeping it'; end if;
    update public.v2_directives set status = 'working', revoke_answer = nt, updated_at = now() where id = p_id;
    perform public.v2__directive_push(d.assignee_id, 'Release declined by the Mayor', d.title || ' — ' || nt);
  elsif p_action = 'cancel' then
    if d.status in ('confirmed','revoked') then raise exception 'Already closed'; end if;
    update public.v2_directives set status = 'revoked', revoke_answer = coalesce(nt, 'Cancelled by the Mayor'), updated_at = now() where id = p_id;
    perform public.v2__directive_push(d.assignee_id, 'Directive cancelled', d.title);
  else raise exception 'Unknown action';
  end if;
end $$;
grant execute on function public.v2_directive_decide(uuid, text, text) to authenticated;

-- Reminders: once a day, a nudge for directives due tomorrow / today / overdue; an unseen one after 24h is flagged to the Mayor.
create or replace function public.v2_directive_tick() returns int
language plpgsql security definer set search_path = '' as $$
declare today date := (now() at time zone 'Asia/Manila')::date; nowm time := (now() at time zone 'Asia/Manila')::time; d public.v2_directives; n int := 0;
begin
  if nowm < time '07:00' or nowm > time '18:00' then return 0; end if;
  for d in select * from public.v2_directives where status in ('sent','received','working') and (last_nudge_on is null or last_nudge_on < today) loop
    if d.due_on is not null and d.due_on <= today + 1 then
      perform public.v2__directive_push(d.assignee_id, case when d.due_on < today then '⏰ Overdue directive' when d.due_on = today then 'Directive due today' else 'Directive due tomorrow' end, d.title);
      update public.v2_directives set last_nudge_on = today where id = d.id; n := n + 1;
    elsif d.status = 'sent' and d.issued_at < now() - interval '24 hours' then
      perform public.v2__directive_push(d.assignee_id, 'Please receive your directive', d.title);
      perform public.v2__directive_push(d.issued_by, d.assignee_name || ' has not opened a directive yet', d.title);
      update public.v2_directives set last_nudge_on = today where id = d.id; n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public.v2_directive_tick() from public, anon, authenticated;
do $$ begin
  perform cron.unschedule('alpha28-directive-tick');
exception when others then null; end $$;
select cron.schedule('alpha28-directive-tick', '*/30 * * * *', $c$select public.v2_directive_tick()$c$);
