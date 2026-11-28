-- v80: student onboarding with officer approval (needs v79).
-- A student reads the welcome and rules, scans the QR card the officers gave them, and waits.
-- The SAILS VP Internal approves first, then the SAILS President. Only then can the student set a PIN and sign in.
-- Students who already had a PIN or account are approved automatically. The President can also approve directly (and revoke).
-- The Secretary, VP Internal and President can read one request log: who asked for what, and when.

create table if not exists public.v2_access (
  member_id uuid primary key references public.v2_members(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'vpi_ok', 'approved', 'denied')),
  rules_version text, rules_at timestamptz,
  requested_at timestamptz not null default now(),
  vpi_name text, vpi_at timestamptz,
  pres_name text, pres_at timestamptz, pres_direct boolean not null default false,
  deny_note text, denied_by_name text, denied_at timestamptz,
  grandfathered boolean not null default false
);
alter table public.v2_access enable row level security;
create policy access_read on public.v2_access for select to authenticated
  using (public.v2_role() in ('secretary', 'vp_internal') or public.v2_is_president());

insert into public.v2_access(member_id, status, grandfathered, pres_name, pres_at)
select m.id, 'approved', true, 'Existing account', now() from public.v2_members m
where exists (select 1 from public.v2_member_pins p where p.member_id = m.id) or exists (select 1 from public.v2_member_accounts a where a.member_id = m.id)
on conflict (member_id) do nothing;

do $do$ begin alter publication supabase_realtime add table public.v2_access; exception when others then null; end $do$;

create or replace function public.v2__approved(p_member uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.v2_access where member_id = p_member and status = 'approved')
$$;

-- The old QR check, kept under a new name. It proves the card is real but not that the officers approved the student.
create or replace function public.v2__member_raw(p_token text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare parts text[]; m public.v2_members; k bytea; good text;
begin
  parts := string_to_array(p_token, '.');
  if array_length(parts, 1) <> 4 or parts[1] <> 'A1' then raise exception 'That is not an Alpha QR code'; end if;
  begin select * into m from public.v2_members where id = parts[2]::uuid;
  exception when others then raise exception 'That is not an Alpha QR code'; end;
  if m.id is null then raise exception 'Unknown student'; end if;
  select value into k from public.v2_secrets where key = 'qr_hmac';
  good := left(encode(extensions.hmac((m.id::text || '.' || parts[3])::bytea, k, 'sha256'), 'hex'), 16);
  if good <> parts[4] then raise exception 'QR code could not be verified'; end if;
  if m.token_revoked or m.token_version::text <> parts[3] then raise exception 'This QR code was replaced. Ask the Treasurer for your new card'; end if;
  return m.id;
end $$;

-- Every student screen that takes a QR token now needs approval.
create or replace function public.v2_member_from_token(p_token text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare mid uuid := public.v2__member_raw(p_token);
begin
  if not public.v2__approved(mid) then raise exception 'Your access is waiting for approval by the SAILS officers'; end if;
  return mid;
end $$;

create or replace function public.v2__access_json(p_member uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object('ok', true, 'status', a.status, 'name', m.full_name, 'student_no', m.student_no,
      'vpi_name', a.vpi_name, 'vpi_at', a.vpi_at, 'pres_name', a.pres_name, 'pres_at', a.pres_at,
      'deny_note', a.deny_note, 'denied_by', a.denied_by_name)
    from public.v2_access a join public.v2_members m on m.id = a.member_id where a.member_id = p_member),
    jsonb_build_object('ok', true, 'status', 'none'))
$$;

create or replace function public.v2_access_request(p_token text, p_rules text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare mid uuid := public.v2__member_raw(p_token); m public.v2_members; a public.v2_access;
begin
  select * into m from public.v2_members where id = mid;
  if m.status <> 'active' then return jsonb_build_object('ok', false, 'error', 'inactive'); end if;
  if m.student_no ~* '^pending' or public.v2__norm_id(m.student_no) = '' then return jsonb_build_object('ok', false, 'error', 'noid'); end if;
  select * into a from public.v2_access where member_id = mid;
  if a.member_id is null then
    insert into public.v2_access(member_id, rules_version, rules_at) values (mid, left(coalesce(p_rules, ''), 20), now());
  elsif a.status = 'denied' then
    update public.v2_access set status = 'pending', rules_version = left(coalesce(p_rules, ''), 20), rules_at = now(), requested_at = now(),
      vpi_name = null, vpi_at = null, pres_name = null, pres_at = null, pres_direct = false, deny_note = null, denied_by_name = null, denied_at = null
    where member_id = mid;
  end if;
  return public.v2__access_json(mid);
end $$;

create or replace function public.v2_access_status(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin return public.v2__access_json(public.v2__member_raw(p_token)); end $$;

create or replace function public.v2_access_list() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.v2_role() in ('secretary', 'vp_internal') or public.v2_is_president()) then raise exception 'Not allowed'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(x) order by (x.status in ('pending', 'vpi_ok')) desc, x.requested_at desc), '[]'::jsonb)
    from (select a.member_id, m.full_name as name, m.student_no, m.section, a.status, a.rules_version, a.rules_at, a.requested_at,
            a.vpi_name, a.vpi_at, a.pres_name, a.pres_at, a.pres_direct, a.deny_note, a.denied_by_name, a.denied_at, a.grandfathered
          from public.v2_access a join public.v2_members m on m.id = a.member_id) x);
end $$;

create or replace function public.v2_access_decide(p_member uuid, p_ok boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.v2_access; n text := nullif(btrim(coalesce(p_note, '')), ''); who text := public.v2__who(); ok boolean := coalesce(p_ok, false);
begin
  select * into a from public.v2_access where member_id = p_member for update;
  if a.member_id is null then raise exception 'No request from this student'; end if;
  if not ok and n is null then raise exception 'Say why it is declined'; end if;
  if public.v2_is_president() then
    if ok then
      if a.status not in ('pending', 'vpi_ok') then raise exception 'This request is already decided'; end if;
      update public.v2_access set status = 'approved', pres_name = who, pres_at = now(), pres_direct = (a.status = 'pending'), deny_note = null where member_id = p_member;
    else
      if a.status = 'denied' then raise exception 'This request is already declined'; end if;
      update public.v2_access set status = 'denied', deny_note = left(n, 300), denied_by_name = who, denied_at = now() where member_id = p_member;
    end if;
  elsif public.v2_role() = 'vp_internal' then
    if a.status <> 'pending' then raise exception 'This request is past your step'; end if;
    if ok then update public.v2_access set status = 'vpi_ok', vpi_name = who, vpi_at = now() where member_id = p_member;
    else update public.v2_access set status = 'denied', deny_note = left(n, 300), denied_by_name = who, denied_at = now() where member_id = p_member; end if;
  else
    raise exception 'Only the SAILS VP Internal or the SAILS President decide student access';
  end if;
  insert into public.v2_audit(actor, actor_name, action, table_name, row_id)
  values (auth.uid(), who, case when ok then 'ACCESS_OK' else 'ACCESS_DENIED' end, 'v2_access', p_member::text);
end $$;

-- One log of what students asked for, for the Secretary, VP Internal and President.
create or replace function public.v2_request_log() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.v2_role() in ('secretary', 'vp_internal') or public.v2_is_president()) then raise exception 'Not allowed'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(x) order by x.at desc), '[]'::jsonb) from (
    select * from (
      select 'fund'::text as kind, f.member_id, f.requester_name as name, m.student_no, f.title, f.status, f.created_at as at, f.answered_by_name as by_name, f.note as detail
        from public.v2_fund_requests f left join public.v2_members m on m.id = f.member_id
      union all
      select 'record', r.member_id, r.requester_name, m.student_no, r.title, r.status, r.created_at, r.answered_by_name, r.note
        from public.v2_record_requests r left join public.v2_members m on m.id = r.member_id
      union all
      select 'access', a.member_id, m.full_name, m.student_no, 'Access to the system', a.status, a.requested_at, coalesce(a.pres_name, a.vpi_name, a.denied_by_name), a.deny_note
        from public.v2_access a join public.v2_members m on m.id = a.member_id where not a.grandfathered
    ) u order by u.at desc limit 500) x);
end $$;

-- Wrong-status feedback for the sign-in function, and a revoked student's open session stops working.
do $do$ declare src text; n text;
begin
  src := pg_get_functiondef('public.v2_pin_setup(text,text,text)'::regprocedure);
  n := replace(src, 'mid := public.v2_member_from_token(p_token);', E'mid := public.v2__member_raw(p_token);\n  if not public.v2__approved(mid) then return jsonb_build_object(''ok'', false, ''error'', ''pending''); end if;');
  if n = src then raise exception 'patch missed: pin_setup'; end if;
  execute n;
  src := pg_get_functiondef('public.v2_pin_login(text,text)'::regprocedure);
  n := replace(src, 'if m.token_revoked then return jsonb_build_object(''ok'', false, ''error'', ''revoked''); end if;', E'if m.token_revoked then return jsonb_build_object(''ok'', false, ''error'', ''revoked''); end if;\n  if not public.v2__approved(m.id) then return jsonb_build_object(''ok'', false, ''error'', ''pending''); end if;');
  if n = src then raise exception 'patch missed: pin_login'; end if;
  execute n;
  src := pg_get_functiondef('public.v2__my_member()'::regprocedure);
  n := replace(src, 'a.last_login_at > now() - interval ''30 days''', 'a.last_login_at > now() - interval ''30 days'' and exists (select 1 from public.v2_access x where x.member_id = a.member_id and x.status = ''approved'')');
  if n = src then raise exception 'patch missed: my_member'; end if;
  execute n;
end $do$;

revoke all on function public.v2__approved(uuid), public.v2__member_raw(text), public.v2__access_json(uuid), public.v2_access_list(), public.v2_access_decide(uuid, boolean, text), public.v2_request_log() from public, anon;
revoke all on function public.v2_access_request(text, text), public.v2_access_status(text) from public;
grant execute on function public.v2_access_request(text, text), public.v2_access_status(text) to anon, authenticated;
grant execute on function public.v2_access_list(), public.v2_access_decide(uuid, boolean, text), public.v2_request_log() to authenticated;

do $do$ declare src text;
begin
  select pg_get_functiondef('public.v2_schema_marks()'::regprocedure) into src;
  if src not like '%''v80''%' then
    src := replace(src, E'  return mk;', E'  mk := mk || jsonb_build_object(''v80'', to_regclass(''public.v2_access'') is not null);\n  return mk;');
    execute src;
  end if;
end $do$;
