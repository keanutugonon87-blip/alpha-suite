-- v75: A Class Treasurer asks the office of the SAILS Treasurer for (1) permission to scan student QR cards when collecting,
-- or (2) the masterlist of the section. The SAILS Treasurer grants or denies. A scan permission lasts a set number of days
-- and can be taken back. Until it is granted, the Class Treasurer's QR scan is refused by the database.
-- Run once in the Supabase SQL editor. Safe to run again.

create table if not exists public.v2_treasury_requests (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.v2_units(id),
  kind text not null check (kind in ('scan', 'masterlist')),
  status text not null default 'open' check (status in ('open', 'granted', 'denied', 'revoked')),
  reason text,
  requested_by uuid not null default auth.uid(),
  requested_by_name text,
  requested_at timestamptz not null default now(),
  decided_by_name text,
  decided_at timestamptz,
  decision_note text,
  expires_at timestamptz,
  snapshot jsonb
);
create index if not exists v2_treq_idx on public.v2_treasury_requests(requested_by, kind, status);

alter table public.v2_treasury_requests enable row level security;
drop policy if exists treq_read on public.v2_treasury_requests;
create policy treq_read on public.v2_treasury_requests for select to authenticated
  using (public.v2_is_president() or public.v2_role() in ('treasurer', 'auditor', 'vp_internal')
         or (public.v2_role() in ('class_treasurer', 'mayor') and public.v2__unit_ok(unit_id)));
revoke insert, update, delete, truncate, references, trigger on public.v2_treasury_requests from anon, authenticated;
grant select on public.v2_treasury_requests to authenticated;

-- Ask (Class Treasurer only)
create or replace function public.v2_treq_ask(p_kind text, p_reason text, p_unit uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare u uuid; nm text; rid uuid; v record; ttl text;
begin
  if public.v2_role() is distinct from 'class_treasurer' then raise exception 'Only the Class Treasurer sends this request'; end if;
  if p_kind not in ('scan', 'masterlist') then raise exception 'Choose what you are asking for'; end if;
  u := public.v2__act_unit(p_unit);
  if exists (select 1 from public.v2_treasury_requests where requested_by = auth.uid() and kind = p_kind and status = 'open') then
    raise exception 'You already have this request waiting for the SAILS Treasurer'; end if;
  if p_kind = 'scan' and exists (select 1 from public.v2_treasury_requests where requested_by = auth.uid() and kind = 'scan' and status = 'granted' and (expires_at is null or expires_at > now())) then
    raise exception 'QR scanning is already switched on for you'; end if;
  select full_name into nm from public.v2_profiles where user_id = auth.uid();
  insert into public.v2_treasury_requests(unit_id, kind, reason, requested_by_name) values (u, p_kind, nullif(left(btrim(coalesce(p_reason, '')), 300), ''), nm) returning id into rid;
  ttl := case p_kind when 'scan' then 'QR scanning request' else 'Masterlist request' end;
  for v in select user_id from public.v2_profiles where role = 'treasurer' loop
    perform public.v2__directive_push(v.user_id, ttl, coalesce(nm, 'A Class Treasurer') || ' is asking you');
  end loop;
  return rid;
end $$;

-- Decide (SAILS Treasurer only). A scan permission lasts p_days (1 to 30). A masterlist is issued as a copy of the section's active students.
create or replace function public.v2_treq_decide(p_id uuid, p_grant boolean, p_note text, p_days int default 7) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.v2_treasury_requests; nm text; snap jsonb; un text;
begin
  if public.v2_role() is distinct from 'treasurer' then raise exception 'Only the SAILS Treasurer decides this request'; end if;
  select * into r from public.v2_treasury_requests where id = p_id for update;
  if r.id is null then raise exception 'Request not found'; end if;
  if r.status <> 'open' then raise exception 'This request was already decided'; end if;
  if not p_grant and btrim(coalesce(p_note, '')) = '' then raise exception 'Say why the request is denied'; end if;
  select full_name into nm from public.v2_profiles where user_id = auth.uid();
  if p_grant and r.kind = 'masterlist' then
    select name into un from public.v2_units where id = r.unit_id;
    select jsonb_build_object('section', un, 'issued_at', now(), 'count', count(*),
             'students', coalesce(jsonb_agg(jsonb_build_object('name', full_name, 'student_no', student_no) order by full_name), '[]'::jsonb))
      into snap from public.v2_members where unit_id = r.unit_id and status = 'active';
  end if;
  update public.v2_treasury_requests set status = case when p_grant then 'granted' else 'denied' end, decided_by_name = nm, decided_at = now(),
    decision_note = nullif(left(btrim(coalesce(p_note, '')), 300), ''),
    expires_at = case when p_grant and r.kind = 'scan' then now() + make_interval(days => greatest(1, least(coalesce(p_days, 7), 30))) end,
    snapshot = snap where id = r.id;
  perform public.v2__directive_push(r.requested_by, case r.kind when 'scan' then 'QR scanning request' else 'Masterlist request' end,
    case when p_grant then 'Granted by the SAILS Treasurer' else 'Denied by the SAILS Treasurer' end);
end $$;

-- Take a scan permission back (SAILS Treasurer only)
create or replace function public.v2_treq_revoke(p_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.v2_treasury_requests; nm text;
begin
  if public.v2_role() is distinct from 'treasurer' then raise exception 'Only the SAILS Treasurer takes a permission back'; end if;
  select * into r from public.v2_treasury_requests where id = p_id for update;
  if r.id is null or r.kind <> 'scan' or r.status <> 'granted' then raise exception 'There is no scan permission to take back'; end if;
  select full_name into nm from public.v2_profiles where user_id = auth.uid();
  update public.v2_treasury_requests set status = 'revoked', decided_by_name = nm, decided_at = now(), decision_note = nullif(left(btrim(coalesce(p_note, '')), 300), ''), expires_at = now() where id = r.id;
  perform public.v2__directive_push(r.requested_by, 'QR scanning', 'The SAILS Treasurer switched your scanning off');
end $$;

-- The screens ask whether scanning is on (the Class Treasurer needs a permission; every other role is unchanged)
create or replace function public.v2_my_scan_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.v2_role() is distinct from 'class_treasurer'
      or exists (select 1 from public.v2_treasury_requests r where r.requested_by = auth.uid() and r.kind = 'scan' and r.status = 'granted' and (r.expires_at is null or r.expires_at > now()))
$$;

-- The gate itself: reading a student QR card
do $do$
declare src text; chk text := $q$  if public.v2_role() = 'class_treasurer' and not exists (select 1 from public.v2_treasury_requests r where r.requested_by = auth.uid() and r.kind = 'scan' and r.status = 'granted' and (r.expires_at is null or r.expires_at > now())) then raise exception 'QR scanning is not switched on for you. Ask the SAILS Treasurer in Requests to the Treasurer'; end if;
$q$;
begin
  select pg_get_functiondef('public.v2_resolve_token(text)'::regprocedure) into src;
  if src not like '%QR scanning is not switched on%' then
    src := replace(src, '  parts := string_to_array(p_token, ''.'');', chk || '  parts := string_to_array(p_token, ''.'');');
    execute src;
  end if;
end $do$;

revoke execute on function public.v2_treq_ask(text, text, uuid), public.v2_treq_decide(uuid, boolean, text, int), public.v2_treq_revoke(uuid, text), public.v2_my_scan_ok() from public, anon;
grant execute on function public.v2_treq_ask(text, text, uuid), public.v2_treq_decide(uuid, boolean, text, int), public.v2_treq_revoke(uuid, text), public.v2_my_scan_ok() to authenticated, service_role;

do $do$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'v2_treasury_requests') then
    alter publication supabase_realtime add table public.v2_treasury_requests;
  end if;
end $do$;

do $do$ declare src text;
begin
  select pg_get_functiondef('public.v2_schema_marks()'::regprocedure) into src;
  if src not like '%''v75''%' then
    src := replace(src, E'  return mk;', E'  mk := mk || jsonb_build_object(''v75'', to_regclass(''public.v2_treasury_requests'') is not null);\n  return mk;');
    execute src;
  end if;
end $do$;
