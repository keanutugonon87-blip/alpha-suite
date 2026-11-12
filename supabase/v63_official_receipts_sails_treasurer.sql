-- v63: official receipts and supporting documents come only from the SAILS Treasurer. Run after v62. Safe to run again.
-- The Class Treasurer collects and records. He does not release an official receipt: it exists only after the SAILS Treasurer confirms the collection.

-- 1. Collections recorded before the confirmation step keep their receipts (marked as such)
update public.v2_entries set confirmed_at = coalesce(created_at, now()), confirmed_by_name = 'Recorded before the SAILS Treasurer confirmation'
 where kind = 'collection' and status = 'approved' and confirmed_at is null;

-- 2. Only the SAILS Treasurer issues the acknowledgment (official receipt), and only for a confirmed collection
create or replace function public.v2_entry_ack(p_ids uuid[]) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if public.v2_role() <> 'treasurer' then raise exception 'Only the SAILS Treasurer issues official receipts'; end if;
  update public.v2_entries set ack_at = now(), ack_by_name = public.v2__who()
   where id = any(p_ids) and kind = 'collection' and status = 'approved' and confirmed_at is not null and ack_at is null;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.v2_entry_ack(uuid[]) from public, anon;
grant execute on function public.v2_entry_ack(uuid[]) to authenticated, service_role;

-- 3. A student sees the receipt number and verify code only after the SAILS Treasurer has confirmed the payment
create or replace function public.v2_self_statement(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare mid uuid; m public.v2_members;
begin
  mid := public.v2_member_from_token(p_token);
  select * into m from public.v2_members where id = mid;
  return jsonb_build_object(
    'name', m.full_name, 'student_no', m.student_no, 'at', now(),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object('at', e.occurred_at,
          'receipt_no', case when e.confirmed_at is not null then e.receipt_no end, 'code', case when e.confirmed_at is not null then e.verify_code end, 'confirmed', e.confirmed_at is not null,
          'for', coalesce(c.title, e.purpose, e.category), 'amount', e.amount, 'method', e.method, 'fund', coalesce(e.fund, c.fund), 'status', e.status)
          order by e.occurred_at desc), '[]'::jsonb)
        from public.v2_entries e left join public.v2_charges c on c.id = e.charge_id
        where e.member_id = mid and e.kind = 'collection' and e.status in ('approved', 'pending')),
    'balances', (select coalesce(jsonb_agg(jsonb_build_object('charge', c.title,
          'due', case when w.id is null then c.amount else 0 end, 'paid', coalesce(p.paid, 0),
          'owed', case when w.id is null then greatest(c.amount - coalesce(p.paid, 0), 0) else 0 end,
          'closed', c.closed, 'waived', w.id is not null) order by c.created_at), '[]'::jsonb)
        from public.v2_charges c
        left join public.v2_waivers w on w.charge_id = c.id and w.member_id = mid
        left join (select charge_id, sum(amount) paid from public.v2_entries
          where member_id = mid and kind = 'collection' and status in ('approved', 'pending') and charge_id is not null group by 1) p on p.charge_id = c.id));
end $$;
grant execute on function public.v2_self_statement(text) to anon, authenticated, service_role;

-- 4. The receipt check page only knows confirmed receipts
do $$ declare src text;
begin
  select pg_get_functiondef('public.v2_verify_receipt(text)'::regprocedure) into src;
  if src not like '%confirmed_at%' then
    src := replace(src, 'e.status <> ''voided''', 'e.status <> ''voided'' and e.confirmed_at is not null');
    if src not like '%confirmed_at%' then raise exception 'v2_verify_receipt changed shape'; end if;
    execute src;
  end if;
end $$;

-- 5. Budget requests and liquidation reports (the supporting documents for spending) are the SAILS Treasurer's, not the Class Treasurer's
do $$ declare fn text; src text;
begin
  foreach fn in array array['public.v2_fbr_submit(uuid,text)', 'public.v2_liq_submit(uuid,numeric,text,text)'] loop
    select pg_get_functiondef(fn::regprocedure) into src;
    if src not like '%class_treasurer%' then
      src := regexp_replace(src, '(\mbegin\M)', E'\\1\n  if public.v2_role() = ''class_treasurer'' then raise exception ''Supporting documents go through the SAILS Treasurer''; end if;');
      execute src;
    end if;
  end loop;
end $$;

-- 6. Students ask for a payment receipt or a supporting document from the SAILS Treasurer (records still go to the SAILS Secretary)
alter table public.v2_record_requests add column if not exists to_role text not null default 'secretary';
alter table public.v2_record_requests drop constraint if exists v2_record_requests_to_role_check;
alter table public.v2_record_requests add constraint v2_record_requests_to_role_check check (to_role in ('secretary', 'treasurer'));

drop policy if exists record_requests_read on public.v2_record_requests;
create policy record_requests_read on public.v2_record_requests for select to authenticated using (
  (to_role = 'secretary' and public.v2_has_role('secretary', 'mayor', 'auditor'))
  or (to_role = 'treasurer' and public.v2_role() in ('treasurer', 'mayor', 'auditor')));

drop function if exists public.v2_record_request(text, text, text);
create or replace function public.v2_record_request(p_title text, p_note text default null, p_token text default null, p_to text default 'secretary') returns uuid
language plpgsql security definer set search_path = '' as $$
declare mid uuid := public.v2__req_member(p_token); nm text; rid uuid; dest text := case when p_to = 'treasurer' then 'treasurer' else 'secretary' end;
begin
  if mid is null then raise exception 'Sign in as a student to request a record'; end if;
  if char_length(btrim(coalesce(p_title, ''))) < 3 then raise exception 'Say which record you need'; end if;
  if (select count(*) from public.v2_record_requests where member_id = mid and status = 'open' and to_role = dest) >= 5 then raise exception 'You already have 5 open requests. Wait for the answer first.'; end if;
  select full_name into nm from public.v2_members where id = mid;
  insert into public.v2_record_requests (member_id, requester_name, title, note, to_role) values (mid, coalesce(nm, ''), left(btrim(p_title), 120), nullif(left(btrim(coalesce(p_note, '')), 500), ''), dest) returning public.v2_record_requests.id into rid;
  return rid;
end $$;
grant execute on function public.v2_record_request(text, text, text, text) to anon, authenticated, service_role;

create or replace function public.v2_record_answer(p_id uuid, p_ok boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.v2_record_requests; n text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into r from public.v2_record_requests where id = p_id for update;
  if r.id is null then raise exception 'Request not found'; end if;
  if r.to_role = 'treasurer' then
    if public.v2_role() <> 'treasurer' then raise exception 'Only the SAILS Treasurer answers receipt and supporting document requests'; end if;
  elsif not public.v2_has_role('secretary', 'mayor') then raise exception 'Only the Secretary answers record requests'; end if;
  if r.status <> 'open' then raise exception 'This request was already answered'; end if;
  if not coalesce(p_ok, false) and n is null then raise exception 'Say why the request is declined'; end if;
  update public.v2_record_requests set status = case when coalesce(p_ok, false) then 'granted' else 'declined' end, answer_note = left(n, 500), answered_by_name = public.v2__who(), answered_at = now() where id = p_id;
end $$;
revoke execute on function public.v2_record_answer(uuid, boolean, text) from public, anon;
grant execute on function public.v2_record_answer(uuid, boolean, text) to authenticated, service_role;

-- the student's own list tells which officer the request went to
do $$ declare src text;
begin
  select pg_get_functiondef('public.v2_my_record_requests(text)'::regprocedure) into src;
  if src not like '%to_role%' then
    src := replace(src, '''status'', status,', '''status'', status, ''to'', to_role,');
    if src like '%to_role%' then execute src; end if;
  end if;
end $$;

-- setup page check (v51 to v63)
do $$ declare src text;
begin
  select pg_get_functiondef('public.v2_schema_marks()'::regprocedure) into src;
  if src not like '%''v63''%' then
    src := regexp_replace(src, '(\s*return mk;)', E'\n  mk := mk || jsonb_build_object(''v63'', exists (select 1 from information_schema.columns where table_schema = ''public'' and table_name = ''v2_record_requests'' and column_name = ''to_role''));\\1');
    execute src;
  end if;
end $$;
