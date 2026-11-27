-- v77: fund transparency requests. A student asks to see where the money went.
--   1. The SAILS Treasurer writes the answer (grant, with where to see the figures, or decline with the reason).
--   2. The SAILS Auditor verifies it. Only then does the student see the answer. The Auditor can also send it back with a note.
--   3. The SAILS Secretary and the SAILS VP Internal each sign as witness once it is released; their names show on the answer.
-- Nobody writes the table directly; everything goes through the functions below. Needs v33 (v2__req_member).

create table if not exists public.v2_fund_requests (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.v2_members(id) on delete cascade,
  requester_name text not null,
  title text not null check (char_length(title) between 3 and 120),
  note text check (note is null or char_length(note) <= 500),
  status text not null default 'open' check (status in ('open', 'review', 'granted', 'declined')),
  proposed_ok boolean,
  answer_note text check (answer_note is null or char_length(answer_note) <= 1000),
  answered_by_name text, answered_at timestamptz,
  audit_note text check (audit_note is null or char_length(audit_note) <= 500),
  audited_by_name text, audited_at timestamptz,
  sec_witness_name text, sec_witness_at timestamptz,
  vpi_witness_name text, vpi_witness_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists v2_fund_requests_member_idx on public.v2_fund_requests (member_id, created_at desc);
alter table public.v2_fund_requests enable row level security;
revoke all on public.v2_fund_requests from anon, authenticated;
grant select on public.v2_fund_requests to authenticated;
drop policy if exists fund_requests_read on public.v2_fund_requests;
create policy fund_requests_read on public.v2_fund_requests for select to authenticated
  using (public.v2_role() in ('treasurer', 'auditor', 'secretary', 'vp_internal', 'sails_president'));

create or replace function public.v2_fund_request(p_title text, p_note text default null, p_token text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare mid uuid := public.v2__req_member(p_token); nm text; rid uuid;
begin
  if mid is null then raise exception 'Sign in as a student to ask about the funds'; end if;
  if char_length(btrim(coalesce(p_title, ''))) < 3 then raise exception 'Say what you want to see'; end if;
  if (select count(*) from public.v2_fund_requests where member_id = mid and status in ('open', 'review')) >= 5 then raise exception 'You already have 5 open requests. Wait for the answers first.'; end if;
  select full_name into nm from public.v2_members where id = mid;
  insert into public.v2_fund_requests (member_id, requester_name, title, note) values (mid, coalesce(nm, ''), left(btrim(p_title), 120), nullif(left(btrim(coalesce(p_note, '')), 500), '')) returning public.v2_fund_requests.id into rid;
  return rid;
end $$;

-- what the student sees: the answer stays hidden until the Auditor has verified it
create or replace function public.v2_my_fund_requests(p_token text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare mid uuid;
begin
  begin mid := public.v2__req_member(p_token); exception when others then return '[]'::jsonb; end;
  if mid is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'note', note, 'status', status, 'created_at', created_at,
      'answer_note', case when status in ('granted', 'declined') then answer_note end,
      'answered_by_name', case when status in ('granted', 'declined') then answered_by_name end,
      'audited_by_name', case when status in ('granted', 'declined') then audited_by_name end,
      'audited_at', case when status in ('granted', 'declined') then audited_at end,
      'sec_witness_name', sec_witness_name, 'sec_witness_at', sec_witness_at, 'vpi_witness_name', vpi_witness_name, 'vpi_witness_at', vpi_witness_at) order by created_at desc)
    from public.v2_fund_requests where member_id = mid), '[]'::jsonb);
end $$;

create or replace function public.v2_fund_answer(p_id uuid, p_ok boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.v2_fund_requests; n text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if public.v2_role() is distinct from 'treasurer' then raise exception 'Only the SAILS Treasurer answers fund transparency requests'; end if;
  select * into r from public.v2_fund_requests where id = p_id for update;
  if r.id is null then raise exception 'Request not found'; end if;
  if r.status <> 'open' then raise exception 'This request is already with the Auditor or answered'; end if;
  if n is null or char_length(n) < 3 then raise exception 'Write the answer (or the reason, if you decline)'; end if;
  update public.v2_fund_requests set status = 'review', proposed_ok = coalesce(p_ok, false), answer_note = left(n, 1000), answered_by_name = public.v2__who(), answered_at = now() where id = p_id;
end $$;

create or replace function public.v2_fund_verify(p_id uuid, p_ok boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.v2_fund_requests; n text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if public.v2_role() is distinct from 'auditor' then raise exception 'Only the SAILS Auditor verifies fund transparency answers'; end if;
  select * into r from public.v2_fund_requests where id = p_id for update;
  if r.id is null then raise exception 'Request not found'; end if;
  if r.status <> 'review' then raise exception 'This request is not waiting for the Auditor'; end if;
  if coalesce(p_ok, false) then
    update public.v2_fund_requests set status = case when proposed_ok then 'granted' else 'declined' end, audit_note = left(n, 500), audited_by_name = public.v2__who(), audited_at = now() where id = p_id;
  else
    if n is null then raise exception 'Say what the Treasurer should fix'; end if;
    update public.v2_fund_requests set status = 'open', audit_note = left(n, 500), audited_by_name = public.v2__who(), audited_at = now() where id = p_id;
  end if;
end $$;

create or replace function public.v2_fund_witness(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.v2_fund_requests; me text := public.v2_role();
begin
  if me not in ('secretary', 'vp_internal') then raise exception 'Only the SAILS Secretary and the SAILS VP Internal witness fund transparency answers'; end if;
  select * into r from public.v2_fund_requests where id = p_id for update;
  if r.id is null then raise exception 'Request not found'; end if;
  if r.status not in ('granted', 'declined') then raise exception 'Witness an answer only after the Auditor has released it'; end if;
  if me = 'secretary' then
    if r.sec_witness_at is not null then raise exception 'You already witnessed this'; end if;
    update public.v2_fund_requests set sec_witness_name = public.v2__who(), sec_witness_at = now() where id = p_id;
  else
    if r.vpi_witness_at is not null then raise exception 'You already witnessed this'; end if;
    update public.v2_fund_requests set vpi_witness_name = public.v2__who(), vpi_witness_at = now() where id = p_id;
  end if;
end $$;

revoke all on function public.v2_fund_request(text, text, text), public.v2_my_fund_requests(text), public.v2_fund_answer(uuid, boolean, text), public.v2_fund_verify(uuid, boolean, text), public.v2_fund_witness(uuid) from public, anon, authenticated;
grant execute on function public.v2_fund_request(text, text, text), public.v2_my_fund_requests(text) to anon, authenticated;
grant execute on function public.v2_fund_answer(uuid, boolean, text), public.v2_fund_verify(uuid, boolean, text), public.v2_fund_witness(uuid) to authenticated;

do $do$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'v2_fund_requests') then
    alter publication supabase_realtime add table public.v2_fund_requests;
  end if;
end $do$;

do $do$ declare src text;
begin
  select pg_get_functiondef('public.v2_schema_marks()'::regprocedure) into src;
  if src not like '%''v77''%' then
    src := replace(src, E'  return mk;', E'  mk := mk || jsonb_build_object(''v77'', to_regclass(''public.v2_fund_requests'') is not null);\n  return mk;');
    execute src;
  end if;
end $do$;
