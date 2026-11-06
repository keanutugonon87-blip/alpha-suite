-- v45 · The Marshal line: General Marshal and Department Marshals 1-4 get their own accounts, dashboards and chain of command.
-- Run v36, v37 and v44 first. Safe to run twice.
--
--   SAILS President  ->  General Marshal  ->  Department Marshals 1-4 (Alpha, Bravo, Charlie, Delta blocks)
--   A Department Marshal never orders a class officer. To ask a class for help at a department event, the Department Marshal sends a request
--   to that section's Class Mayor; the Mayor accepts (which sends directives to the class Marshals) or declines.
--   The General Marshal and Department Marshals see only their own tools. They are NOT general staff: they cannot read class records,
--   ledgers, students or incident files of a class. Incident files of a class stay with that class's Mayor and Marshals.

-- 1. two new roles, and they are not general "staff"
alter table public.v2_profiles drop constraint if exists v2_profiles_role_check;
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.v2_profiles'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%mayor%' loop
    execute format('alter table public.v2_profiles drop constraint %I', c);
  end loop;
end $$;
alter table public.v2_profiles add constraint v2_profiles_role_check
  check (role in ('pending', 'mayor', 'vice_mayor', 'vp_internal', 'vp_external', 'secretary', 'treasurer', 'auditor', 'marshall', 'sails', 'pio', 'general_marshal', 'dept_marshal'));

create or replace function public.v2_is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.v2_role() not in ('pending', 'general_marshal', 'dept_marshal'), false)
$$;

-- 2. the chain for directives: President -> General Marshal -> Department Marshals
create or replace function public.v2__directive_may(p_issuer text, p_assignee text) returns boolean
language sql immutable set search_path = '' as $$
  select case p_issuer
    when 'mayor' then p_assignee in ('vice_mayor', 'vp_internal', 'vp_external', 'secretary', 'treasurer', 'auditor', 'marshall', 'sails', 'pio', 'general_marshal')
    when 'vp_internal' then p_assignee in ('secretary', 'marshall', 'pio')
    when 'vp_external' then p_assignee in ('pio')
    when 'general_marshal' then p_assignee in ('dept_marshal')
    else false end
$$;

create or replace function public.v2__directive_make(p_assignee uuid, p_title text, p_details text, p_due date, p_priority text, p_link text, p_batch uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me text := public.v2__who(); r text := public.v2_role(); a public.v2_profiles; rid uuid; src text;
begin
  if r not in ('mayor', 'vp_internal', 'vp_external', 'general_marshal') then raise exception 'Only the President, a Vice President or the General Marshal can issue directives'; end if;
  select * into a from public.v2_profiles where user_id = p_assignee;
  if a.user_id is null or not public.v2__directive_may(r, a.role) then raise exception 'You cannot give a directive to that officer'; end if;
  if p_assignee = auth.uid() then raise exception 'Assign directives to other officers'; end if;
  if p_due is not null and p_due < (now() at time zone 'Asia/Manila')::date then raise exception 'The due date has already passed'; end if;
  if length(btrim(coalesce(p_title, ''))) < 3 then raise exception 'Write the task'; end if;
  src := case r when 'mayor' then 'the President' when 'vp_internal' then 'the VP Internal' when 'vp_external' then 'the VP External' else 'the General Marshal' end;
  insert into public.v2_directives(title, details, assignee_id, assignee_name, assignee_role, due_on, priority, link_note, issued_by, issued_by_name, issuer_role, batch_id)
  values (btrim(p_title), nullif(btrim(coalesce(p_details, '')), ''), a.user_id, a.full_name, a.role, p_due, coalesce(nullif(p_priority, ''), 'normal'), nullif(btrim(coalesce(p_link, '')), ''), auth.uid(), me, r, p_batch)
  returning id into rid;
  perform public.v2__directive_push(a.user_id, case when p_priority = 'urgent' then '🔴 Urgent directive from ' || src else 'New directive from ' || src end,
    btrim(p_title) || case when p_due is not null then ' · due ' || to_char(p_due, 'Mon FMDD') else '' end || '. Open Alpha ’28 to receive it.');
  return rid;
end $$;
revoke all on function public.v2__directive_make(uuid, text, text, date, text, text, uuid) from public, anon, authenticated;

-- the General Marshal can see the Department Marshals' names (to assign blocks and send directives), nothing else about other accounts
drop policy if exists profiles_marshal_read on public.v2_profiles;
create policy profiles_marshal_read on public.v2_profiles for select to authenticated using (public.v2_role() = 'general_marshal' and role = 'dept_marshal');

-- 3. which Department Marshal covers which block (Marshal 1 = Alpha ... Marshal 4 = Delta)
create table if not exists public.v2_marshal_blocks (
  letter text primary key check (letter in ('Alpha', 'Bravo', 'Charlie', 'Delta')),
  user_id uuid,
  updated_at timestamptz not null default now()
);
insert into public.v2_marshal_blocks(letter) values ('Alpha'), ('Bravo'), ('Charlie'), ('Delta') on conflict do nothing;
alter table public.v2_marshal_blocks enable row level security;
drop policy if exists blocks_read on public.v2_marshal_blocks;
create policy blocks_read on public.v2_marshal_blocks for select to authenticated using (public.v2_role() in ('mayor', 'general_marshal', 'dept_marshal'));
revoke all on public.v2_marshal_blocks from anon; grant select on public.v2_marshal_blocks to authenticated;

create or replace function public.v2_marshal_block_set(p_letter text, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.v2_role() not in ('general_marshal', 'mayor') then raise exception 'Only the General Marshal assigns the blocks'; end if;
  if p_user is not null and not exists (select 1 from public.v2_profiles where user_id = p_user and role = 'dept_marshal') then raise exception 'Pick a Department Marshal'; end if;
  update public.v2_marshal_blocks set user_id = null where user_id = p_user and p_user is not null and letter <> p_letter;
  update public.v2_marshal_blocks set user_id = p_user, updated_at = now() where letter = p_letter;
  if not found then raise exception 'Unknown block'; end if;
end $$;
grant execute on function public.v2_marshal_block_set(text, uuid) to authenticated;

-- the blocks with their sections and student counts: all four for the General Marshal and the President, only their own for a Department Marshal
create or replace function public.v2_marshal_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r text := public.v2_role();
begin
  if r not in ('mayor', 'general_marshal', 'dept_marshal') then raise exception 'Not allowed'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'letter', b.letter, 'user_id', b.user_id, 'user_name', (select full_name from public.v2_profiles where user_id = b.user_id),
      'sections', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name, 'year_level', u.year_level,
                   'students', (select count(*) from public.v2_members m where m.unit_id = u.id and m.status = 'active'),
                   'has_mayor', exists (select 1 from public.v2_seat_holders h where h.unit_id = u.id and h.seat = 'mayor' and h.status in ('active', 'acting') and h.user_id is not null)) order by u.year_level)
                   from public.v2_units u where u.kind = 'section' and u.active and lower(u.section_name) = lower(b.letter)), '[]'::jsonb))
    order by b.letter) from public.v2_marshal_blocks b where r <> 'dept_marshal' or b.user_id = auth.uid()), '[]'::jsonb);
end $$;
grant execute on function public.v2_marshal_overview() to authenticated;

-- 4. incident referrals: Department Marshals file, the General Marshal reviews and may refer to the President or the adviser
create table if not exists public.v2_marshal_incidents (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null default auth.uid(),
  reporter_name text,
  reporter_role text,
  block_letter text,
  section text,
  event text,
  occurred_on date not null default ((now() at time zone 'Asia/Manila')::date),
  summary text not null check (char_length(btrim(summary)) between 5 and 1000),
  action_taken text check (action_taken is null or char_length(action_taken) <= 500),
  status text not null default 'filed' check (status in ('filed', 'reviewed', 'referred', 'closed')),
  referred_to text check (referred_to is null or referred_to in ('president', 'adviser')),
  gm_note text check (gm_note is null or char_length(gm_note) <= 500),
  referred_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists v2_marshal_incidents_idx on public.v2_marshal_incidents (created_at desc);
alter table public.v2_marshal_incidents enable row level security;
drop policy if exists inc_read on public.v2_marshal_incidents;
create policy inc_read on public.v2_marshal_incidents for select to authenticated
  using (reporter_id = auth.uid() or public.v2_role() = 'general_marshal' or (public.v2_role() = 'mayor' and status = 'referred' and referred_to = 'president'));
revoke all on public.v2_marshal_incidents from anon; grant select on public.v2_marshal_incidents to authenticated;

create or replace function public.v2_incident_file(p_section text, p_event text, p_on date, p_summary text, p_action text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r text := public.v2_role(); rid uuid; bl text; g record;
begin
  if r not in ('dept_marshal', 'general_marshal') then raise exception 'Only the Marshals file department incident reports'; end if;
  select letter into bl from public.v2_marshal_blocks where user_id = auth.uid();
  insert into public.v2_marshal_incidents(reporter_name, reporter_role, block_letter, section, event, occurred_on, summary, action_taken)
  values (public.v2__who(), r, bl, nullif(btrim(coalesce(p_section, '')), ''), nullif(btrim(coalesce(p_event, '')), ''), coalesce(p_on, (now() at time zone 'Asia/Manila')::date), btrim(p_summary), nullif(btrim(coalesce(p_action, '')), ''))
  returning id into rid;
  if r = 'dept_marshal' then
    for g in select user_id from public.v2_profiles where role = 'general_marshal' loop
      perform public.v2__directive_push(g.user_id, 'New incident report', coalesce(nullif(btrim(coalesce(p_event, '')), ''), 'Department duty') || ' · ' || left(btrim(p_summary), 80));
    end loop;
  end if;
  return rid;
end $$;
grant execute on function public.v2_incident_file(text, text, date, text, text) to authenticated;

create or replace function public.v2_incident_review(p_id uuid, p_action text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare i public.v2_marshal_incidents; nt text := nullif(btrim(coalesce(p_note, '')), ''); m record;
begin
  if public.v2_role() <> 'general_marshal' then raise exception 'Only the General Marshal reviews incident reports'; end if;
  select * into i from public.v2_marshal_incidents where id = p_id for update;
  if i.id is null then raise exception 'Report not found'; end if;
  if p_action = 'review' then
    update public.v2_marshal_incidents set status = 'reviewed', gm_note = left(nt, 500), updated_at = now() where id = p_id and status = 'filed';
  elsif p_action = 'refer_president' then
    if nt is null then raise exception 'Add a short note for the President'; end if;
    update public.v2_marshal_incidents set status = 'referred', referred_to = 'president', gm_note = left(nt, 500), referred_at = now(), updated_at = now() where id = p_id and status <> 'closed';
    for m in select user_id from public.v2_profiles where role = 'mayor' loop
      perform public.v2__directive_push(m.user_id, 'Incident referred to you', coalesce(i.event, 'Department duty') || ' · ' || left(nt, 80));
    end loop;
  elsif p_action = 'refer_adviser' then
    if nt is null then raise exception 'Add a short note for the adviser'; end if;
    update public.v2_marshal_incidents set status = 'referred', referred_to = 'adviser', gm_note = left(nt, 500), referred_at = now(), updated_at = now() where id = p_id and status <> 'closed';
  elsif p_action = 'close' then
    update public.v2_marshal_incidents set status = 'closed', gm_note = coalesce(left(nt, 500), gm_note), updated_at = now() where id = p_id;
  else raise exception 'Unknown action'; end if;
end $$;
grant execute on function public.v2_incident_review(uuid, text, text) to authenticated;

-- 5. a Department Marshal asks a class for help: the request goes to that class's Mayor, never to the class officers
create table if not exists public.v2_marshal_requests (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null default auth.uid(),
  from_name text,
  unit_id uuid references public.v2_units(id),
  unit_name text,
  to_mayor_id uuid not null,
  title text not null check (char_length(btrim(title)) between 3 and 140),
  details text check (details is null or char_length(details) <= 600),
  needed_on date,
  status text not null default 'open' check (status in ('open', 'accepted', 'declined')),
  answer_note text,
  answered_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.v2_marshal_requests enable row level security;
drop policy if exists mreq_read on public.v2_marshal_requests;
create policy mreq_read on public.v2_marshal_requests for select to authenticated using (from_id = auth.uid() or to_mayor_id = auth.uid() or public.v2_role() = 'general_marshal');
revoke all on public.v2_marshal_requests from anon; grant select on public.v2_marshal_requests to authenticated;

create or replace function public.v2_marshal_ask(p_unit uuid, p_title text, p_details text, p_on date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare u public.v2_units; bl text; mayor uuid; rid uuid;
begin
  if public.v2_role() <> 'dept_marshal' then raise exception 'Only a Department Marshal sends this kind of request'; end if;
  select letter into bl from public.v2_marshal_blocks where user_id = auth.uid();
  select * into u from public.v2_units where id = p_unit and kind = 'section';
  if bl is null or u.id is null or lower(u.section_name) <> lower(bl) then raise exception 'You can only ask sections in your own block'; end if;
  select user_id into mayor from public.v2_seat_holders where unit_id = u.id and seat = 'mayor' and status in ('active', 'acting') and user_id is not null limit 1;
  if mayor is null then raise exception 'That section has no Mayor account yet'; end if;
  insert into public.v2_marshal_requests(from_name, unit_id, unit_name, to_mayor_id, title, details, needed_on)
  values (public.v2__who(), u.id, u.name, mayor, btrim(p_title), nullif(btrim(coalesce(p_details, '')), ''), p_on) returning id into rid;
  perform public.v2__directive_push(mayor, 'Request from a Department Marshal', btrim(p_title) || case when p_on is not null then ' · ' || to_char(p_on, 'Mon FMDD') else '' end);
  return rid;
end $$;
grant execute on function public.v2_marshal_ask(uuid, text, text, date) to authenticated;

-- the Class Mayor answers; accepting sends a directive to each Class Marshal of that section
create or replace function public.v2_marshal_answer(p_id uuid, p_accept boolean, p_note text) returns int
language plpgsql security definer set search_path = '' as $$
declare q public.v2_marshal_requests; nt text := nullif(btrim(coalesce(p_note, '')), ''); n int := 0; h record;
begin
  select * into q from public.v2_marshal_requests where id = p_id for update;
  if q.id is null or q.to_mayor_id <> auth.uid() then raise exception 'That request is not addressed to you'; end if;
  if q.status <> 'open' then raise exception 'Already answered'; end if;
  if not p_accept and nt is null then raise exception 'Give a short reason'; end if;
  update public.v2_marshal_requests set status = case when p_accept then 'accepted' else 'declined' end, answer_note = left(nt, 300), answered_at = now() where id = p_id;
  if p_accept then
    for h in select user_id from public.v2_seat_holders where unit_id = q.unit_id and seat = 'marshal' and status in ('active', 'acting') and user_id is not null loop
      perform public.v2__directive_make(h.user_id, q.title, q.details, q.needed_on, 'normal', 'Department event · requested by ' || q.from_name, null);
      n := n + 1;
    end loop;
  end if;
  perform public.v2__directive_push(q.from_id, case when p_accept then 'Your request was accepted' else 'Your request was declined' end, q.title || coalesce(' — ' || nt, ''));
  return n;
end $$;
grant execute on function public.v2_marshal_answer(uuid, boolean, text) to authenticated;
