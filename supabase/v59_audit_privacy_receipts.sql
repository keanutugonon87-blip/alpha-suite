-- v59 · Audit trail, meeting privacy, who-received-what, SAILS Marshal attendance, and setup checks.
--  * v2_admin_log: the President sees account removals, deputy changes and meeting privacy changes (role changes and inspections are already logged elsewhere).
--  * Each Council meeting can be kept from Class Mayors (share_mayors).
--  * v2_receipt_overview(): the SAILS Secretary, VP Internal and President see which Class Mayor has received what.
--  * SAILS Marshals can scan attendance events they are named on, for students in their own block. Class Mayors can see the SAILS Marshals so he can name them.
--  * v2_schema_marks(): lets the Setup page show which updates are installed.
-- Requires v55, v57 and v58. Safe to run twice.

-- 1 · meeting privacy
alter table public.v2_council_meetings add column if not exists share_mayors boolean not null default true;
drop policy if exists v2_council_meetings_mayor_read on public.v2_council_meetings;
create policy v2_council_meetings_mayor_read on public.v2_council_meetings for select to authenticated
  using (public.v2_role() = 'mayor' and share_mayors);

-- 2 · audit log
create table if not exists public.v2_admin_log (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  actor uuid, actor_name text,
  action text not null, detail text
);
alter table public.v2_admin_log enable row level security;
drop policy if exists adminlog_read on public.v2_admin_log;
create policy adminlog_read on public.v2_admin_log for select to authenticated using (public.v2_is_president());
revoke all on public.v2_admin_log from anon;
grant select on public.v2_admin_log to authenticated;

create or replace function public.v2__admin_log(p_action text, p_detail text) returns void
language sql security definer set search_path = '' as $$
  insert into public.v2_admin_log(actor, actor_name, action, detail) values (auth.uid(), coalesce(public.v2__who(), 'the database'), p_action, p_detail)
$$;
revoke all on function public.v2__admin_log(text, text) from public, anon, authenticated;

create or replace function public.v2__log_profile_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin perform public.v2__admin_log('Account removed', coalesce(old.full_name, old.email, '') || ' (' || old.role || ')'); return old; end $$;
drop trigger if exists v2_log_profile_delete on public.v2_profiles;
create trigger v2_log_profile_delete after delete on public.v2_profiles for each row execute function public.v2__log_profile_delete();

create or replace function public.v2__log_deputy() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform public.v2__admin_log('Deputy named', new.user_name || ', ' || new.from_on || ' to ' || new.to_on);
  elsif old.revoked_at is null and new.revoked_at is not null then
    perform public.v2__admin_log('Deputy revoked', new.user_name);
  end if;
  return new;
end $$;
drop trigger if exists v2_log_deputy on public.v2_deputy;
create trigger v2_log_deputy after insert or update on public.v2_deputy for each row execute function public.v2__log_deputy();

create or replace function public.v2_council_share(p_id uuid, p_share boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare t text;
begin
  if not public.v2_is_president() then raise exception 'Only the SAILS President decides this'; end if;
  update public.v2_council_meetings set share_mayors = p_share where id = p_id returning title into t;
  if not found then raise exception 'Meeting not found'; end if;
  perform public.v2__admin_log(case when p_share then 'Meeting shared with Class Mayors' else 'Meeting kept from Class Mayors' end, t);
end $$;
grant execute on function public.v2_council_share(uuid, boolean) to authenticated;

-- 3 · who has received what
create or replace function public.v2_receipt_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare j jsonb;
begin
  if not (public.v2_is_president() or public.v2_role() in ('secretary', 'vp_internal')) then raise exception 'Not allowed'; end if;
  select jsonb_build_object(
    'mayors', coalesce((select jsonb_agg(jsonb_build_object('user_id', user_id, 'name', full_name) order by full_name) from public.v2_profiles where role = 'mayor'), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(x) from (select x from (
        select jsonb_build_object('src', 'agenda', 'id', m.id, 'title', m.title, 'kind', 'Agenda', 'at', coalesce(m.updated_at, m.created_at)) x
          from public.v2_council_meetings m where m.share_mayors and m.status = 'planned' and coalesce(m.agenda, '') <> ''
        union all
        select jsonb_build_object('src', 'minutes', 'id', m.id, 'title', m.title, 'kind', 'Minutes', 'at', coalesce(m.updated_at, m.created_at))
          from public.v2_council_meetings m where m.share_mayors and coalesce(m.minutes, '') <> ''
        union all
        select jsonb_build_object('src', 'record', 'id', r.id, 'title', r.title, 'kind', case r.kind when 'letter_in' then 'Letter received' when 'letter_out' then 'Letter sent' when 'resolution' then 'Resolution' else 'Minutes' end, 'at', coalesce(r.approved_at, r.updated_at))
          from public.v2_office_records r where r.kind in ('minutes', 'resolution', 'letter_in', 'letter_out') and r.flow in ('approved', 'classified', 'published') and coalesce(r.classification, '') <> 'confidential'
      ) u order by x ->> 'at' desc limit 80) z), '[]'::jsonb),
    'got', coalesce((select jsonb_agg(jsonb_build_object('src', src, 'id', src_id, 'user_id', user_id, 'at', seen_at)) from public.v2_desk_receipts), '[]'::jsonb)
  ) into j;
  return j;
end $$;
grant execute on function public.v2_receipt_overview() to authenticated;

-- 4 · SAILS Marshals scan attendance events they are named on, for students in their own block
drop policy if exists profiles_mayor_sees_marshals on public.v2_profiles;
create policy profiles_mayor_sees_marshals on public.v2_profiles for select to authenticated
  using (public.v2_role() = 'mayor' and role in ('general_marshal', 'dept_marshal'));

drop policy if exists events_marshal_read on public.v2_events;
create policy events_marshal_read on public.v2_events for select to authenticated
  using (public.v2_role() in ('general_marshal', 'dept_marshal') and auth.uid() = any (scanner_ids));

drop policy if exists escans_marshal_read on public.v2_event_scans;
create policy escans_marshal_read on public.v2_event_scans for select to authenticated
  using (public.v2_role() in ('general_marshal', 'dept_marshal')
         and exists (select 1 from public.v2_members m where m.id = member_id and public.v2__marshal_sees(m.unit_id)));
drop policy if exists escans_marshal_ins on public.v2_event_scans;
create policy escans_marshal_ins on public.v2_event_scans for insert to authenticated
  with check (public.v2_role() in ('general_marshal', 'dept_marshal')
              and exists (select 1 from public.v2_members m where m.id = member_id and public.v2__marshal_sees(m.unit_id)));
drop policy if exists escans_marshal_del on public.v2_event_scans;
create policy escans_marshal_del on public.v2_event_scans for delete to authenticated
  using (public.v2_role() in ('general_marshal', 'dept_marshal') and scanned_by = auth.uid());

-- 5 · which updates are installed (the Setup page reads this)
create or replace function public.v2_schema_marks() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare g text; mk jsonb;
begin
  select pg_get_functiondef('public.v2_profile_role_guard()'::regprocedure) into g;
  mk := jsonb_build_object(
    'v51', g like '%pending%' or g like '%manages accounts%',
    'v52', (select pg_get_constraintdef(oid) not like '%vice_mayor%' from pg_constraint where conname = 'v2_profiles_role_check'),
    'v53', g like '%manages accounts%',
    'v54', (select pg_get_functiondef('public.v2__directive_may(text,text)'::regprocedure) not like '%when ''mayor''%'),
    'v55', to_regclass('public.v2_desk_receipts') is not null,
    'v56', (select pg_get_functiondef('public.v2_role()'::regprocedure) not like '%''pending'' else%'),
    'v57', to_regprocedure('public.v2__marshal_sees(uuid)') is not null,
    'v58', to_regclass('public.v2_inspections') is not null,
    'v59', to_regclass('public.v2_admin_log') is not null,
    'v60', not has_function_privilege('anon', 'public.v2_inspection_open(text)', 'execute'));
  return mk;
end $$;
grant execute on function public.v2_schema_marks() to authenticated;
