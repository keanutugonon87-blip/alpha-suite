-- Alpha ’28 · v25 · Liquidation report and audit report for approved fund budget requests (Stage 2 of v24).
-- Run v24 first. Safe to run more than once.
--
--   Treasurer prepares the liquidation (the app lists every expense linked to the request, and the unspent cash to return) and signs
--     -> President (Mayor) approves and signs
--     -> Auditor checks it (receipts, amounts, duplicates, approvals), gives an opinion and signs. "With findings" sends it back to the Treasurer.
--     -> Secretary files it (a copy goes in Documents).
--   Every step goes through the functions below, so no one can skip a stage or edit a report after it is signed. All staff can read.

create table if not exists public.v2_liquidations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.v2_budget_requests(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'returned', 'approved', 'audited', 'filed')),
  lines jsonb not null default '[]'::jsonb,          -- the expenses, frozen when the Treasurer submits
  approved_total numeric not null default 0,
  actual numeric not null default 0,
  cash_returned numeric not null default 0 check (cash_returned >= 0),
  remarks text check (remarks is null or char_length(remarks) <= 1000),
  auto jsonb not null default '{}'::jsonb,           -- checks the database ran itself: missing receipts, possible duplicates, over budget
  prepared_by_name text, prepared_at timestamptz, prepared_sig text check (prepared_sig is null or char_length(prepared_sig) < 80000),
  decided_by_name text, decided_at timestamptz, decision_note text check (decision_note is null or char_length(decision_note) <= 500), approved_sig text check (approved_sig is null or char_length(approved_sig) < 80000),
  audit_checks jsonb, audit_opinion text check (audit_opinion is null or audit_opinion in ('clear', 'findings')), audit_remarks text check (audit_remarks is null or char_length(audit_remarks) <= 1000),
  audited_by_name text, audited_at timestamptz, audit_sig text check (audit_sig is null or char_length(audit_sig) < 80000),
  filed_by_name text, filed_at timestamptz, filed_sig text check (filed_sig is null or char_length(filed_sig) < 80000),
  document_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.v2_liquidations enable row level security;
drop policy if exists liq_read on public.v2_liquidations;
create policy liq_read on public.v2_liquidations for select to authenticated using (public.v2_is_staff());
revoke all on public.v2_liquidations from anon;
revoke insert, update, delete on public.v2_liquidations from authenticated;
drop trigger if exists v2_liq_audit on public.v2_liquidations;
create trigger v2_liq_audit after insert or delete or update on public.v2_liquidations for each row execute function public.v2_audit_trigger();

-- Treasurer: build the report from the linked expenses and send it for approval
create or replace function public.v2_liq_submit(p_request uuid, p_cash_returned numeric, p_remarks text, p_sig text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r public.v2_budget_requests; l public.v2_liquidations; ln jsonb; act numeric; missing int; dups int; pend int; lid uuid;
begin
  if not public.v2_has_role('treasurer') then raise exception 'Only the Treasurer prepares a liquidation report'; end if;
  select * into r from public.v2_budget_requests where id = p_request;
  if not found then raise exception 'Request not found'; end if;
  if r.status not in ('approved', 'filed') then raise exception 'The request must be approved first'; end if;
  select * into l from public.v2_liquidations where request_id = p_request for update;
  if found and l.status not in ('draft', 'returned') then raise exception 'This report was already sent'; end if;
  select count(*) into pend from public.v2_entries e where e.request_id = p_request and e.kind = 'expense' and e.status = 'pending';
  if pend > 0 then raise exception '% linked expense(s) still wait for approval. Get them approved first', pend; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'date', (e.occurred_at at time zone 'Asia/Manila')::date, 'payee', coalesce(e.payer_name, ''), 'category', e.category,
      'purpose', coalesce(e.purpose, ''), 'amount', e.amount, 'receipt', e.receipt_image is not null) order by e.occurred_at), '[]'::jsonb),
    coalesce(sum(e.amount), 0), count(*) filter (where e.receipt_image is null)
    into ln, act, missing from public.v2_entries e where e.request_id = p_request and e.kind = 'expense' and e.status = 'approved';
  select count(*) into dups from (select 1 from public.v2_entries e where e.request_id = p_request and e.kind = 'expense' and e.status = 'approved'
    group by lower(coalesce(e.payer_name, '')), e.amount, (e.occurred_at at time zone 'Asia/Manila')::date having count(*) > 1) d;
  if p_cash_returned < 0 then raise exception 'Cash returned cannot be negative'; end if;
  insert into public.v2_liquidations (request_id, status, lines, approved_total, actual, cash_returned, remarks, auto, prepared_by_name, prepared_at, prepared_sig)
    values (p_request, 'submitted', ln, r.total, act, coalesce(p_cash_returned, 0), nullif(left(btrim(coalesce(p_remarks, '')), 1000), ''),
      jsonb_build_object('missing_receipts', missing, 'possible_duplicates', dups, 'over_budget', act > r.total, 'unspent', r.total - act),
      public.v2__who(), now(), nullif(p_sig, ''))
    on conflict (request_id) do update set status = 'submitted', lines = excluded.lines, approved_total = excluded.approved_total, actual = excluded.actual, cash_returned = excluded.cash_returned,
      remarks = excluded.remarks, auto = excluded.auto, prepared_by_name = excluded.prepared_by_name, prepared_at = excluded.prepared_at, prepared_sig = excluded.prepared_sig,
      decision_note = null, audit_opinion = null, audit_checks = null, audit_remarks = null, updated_at = now()
    returning id into lid;
  return lid;
end $$;

-- Mayor: approve (signs) or return with a comment
create or replace function public.v2_liq_decide(p_id uuid, p_approve boolean, p_note text, p_sig text) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.v2_liquidations;
begin
  if not public.v2_has_role('mayor') then raise exception 'Only the President (Mayor) approves a liquidation report'; end if;
  select * into l from public.v2_liquidations where id = p_id for update;
  if not found then raise exception 'Report not found'; end if;
  if l.status <> 'submitted' then raise exception 'This report is not waiting for approval'; end if;
  if not p_approve and btrim(coalesce(p_note, '')) = '' then raise exception 'Say what needs to change'; end if;
  update public.v2_liquidations set status = case when p_approve then 'approved' else 'returned' end, decided_at = now(), decided_by_name = public.v2__who(),
    decision_note = nullif(left(btrim(coalesce(p_note, '')), 500), ''), approved_sig = case when p_approve then nullif(p_sig, '') else null end, updated_at = now() where id = p_id;
end $$;

-- Auditor: checklist, opinion, remarks, signature. "findings" sends it back to the Treasurer.
create or replace function public.v2_liq_audit(p_id uuid, p_checks jsonb, p_opinion text, p_remarks text, p_sig text) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.v2_liquidations;
begin
  if not public.v2_has_role('auditor') then raise exception 'Only the Auditor signs the audit report'; end if;
  select * into l from public.v2_liquidations where id = p_id for update;
  if not found then raise exception 'Report not found'; end if;
  if l.status <> 'approved' then raise exception 'The President must approve the report before it is audited'; end if;
  if p_opinion not in ('clear', 'findings') then raise exception 'Choose clear or with findings'; end if;
  if p_opinion = 'findings' and btrim(coalesce(p_remarks, '')) = '' then raise exception 'Write what the findings are'; end if;
  update public.v2_liquidations set status = case when p_opinion = 'clear' then 'audited' else 'returned' end, audit_checks = coalesce(p_checks, '{}'::jsonb), audit_opinion = p_opinion,
    audit_remarks = nullif(left(btrim(coalesce(p_remarks, '')), 1000), ''), audited_by_name = public.v2__who(), audited_at = now(), audit_sig = nullif(p_sig, ''),
    decision_note = case when p_opinion = 'findings' then 'Audit findings: ' || left(btrim(p_remarks), 450) else decision_note end, updated_at = now() where id = p_id;
end $$;

-- Secretary: file the audited report and keep a copy in Documents
create or replace function public.v2_liq_file(p_id uuid, p_sig text) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.v2_liquidations; r public.v2_budget_requests; did uuid;
begin
  if not public.v2_has_role('secretary', 'mayor') then raise exception 'Only the Secretary files a liquidation report'; end if;
  select * into l from public.v2_liquidations where id = p_id for update;
  if not found then raise exception 'Report not found'; end if;
  if l.status <> 'audited' then raise exception 'Only an audited report can be filed'; end if;
  select * into r from public.v2_budget_requests where id = l.request_id;
  insert into public.v2_documents (title, kind, status, note, created_by, submitted_at)
    values (left('Liquidation · ' || r.req_no || ' · ' || r.title, 100), 'report', 'submitted', left('Audited ' || to_char(l.audited_at at time zone 'Asia/Manila', 'Mon DD, YYYY') || ', opinion: clear', 200), auth.uid(), now()) returning id into did;
  update public.v2_liquidations set status = 'filed', filed_at = now(), filed_by_name = public.v2__who(), filed_sig = nullif(p_sig, ''), document_id = did, updated_at = now() where id = p_id;
end $$;

revoke all on function public.v2_liq_submit(uuid, numeric, text, text), public.v2_liq_decide(uuid, boolean, text, text), public.v2_liq_audit(uuid, jsonb, text, text, text), public.v2_liq_file(uuid, text) from public, anon;
grant execute on function public.v2_liq_submit(uuid, numeric, text, text), public.v2_liq_decide(uuid, boolean, text, text), public.v2_liq_audit(uuid, jsonb, text, text, text), public.v2_liq_file(uuid, text) to authenticated;

do $$ begin
  begin alter publication supabase_realtime add table public.v2_liquidations; exception when others then null; end;
end $$;
