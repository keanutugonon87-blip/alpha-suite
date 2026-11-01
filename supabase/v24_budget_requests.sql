-- Alpha ’28 · v24 · Fund Budget Requests (replaces the fixed budget per fund from v23).
-- Run v23 first only if you already did; this file is safe either way and safe to run more than once.
--
--   Treasurer fills in a request (itemized, with the fund balance) and signs  ->  sends it to the President (Mayor)
--   Mayor approves (or returns it with a comment) and signs                   ->  the Secretary files it (a copy goes in Documents)
--   Expenses can then be linked to an approved request, and the app warns when they pass its total.
--   Everyone on staff can read requests. Only the Treasurer writes drafts. Every step goes through the functions below, so no one can skip a stage.
--   Stage 2 (liquidation and audit reports) comes in a later file.

drop table if exists public.v2_budgets;     -- the old fixed amount per fund is gone; budgets now exist only as approved requests

create sequence if not exists public.v2_fbr_seq;
create table if not exists public.v2_budget_requests (
  id uuid primary key default gen_random_uuid(),
  req_no text unique,
  title text not null check (char_length(title) between 3 and 120),
  category text not null default 'Other' check (category in ('Event Expenses', 'Supplies', 'Printing', 'Transportation', 'Snacks / Food', 'Other')),
  fund text not null check (fund in ('class', 'sails', 'campus', 'batch')),
  purpose text check (purpose is null or char_length(purpose) <= 1000),
  activity_date date,
  items jsonb not null default '[]'::jsonb,
  total numeric not null default 0 check (total >= 0),
  fund_balance numeric,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'returned', 'approved', 'filed')),
  prepared_by uuid default auth.uid(),
  prepared_by_name text, prepared_at timestamptz, prepared_sig text check (prepared_sig is null or char_length(prepared_sig) < 80000),
  decided_by_name text, decided_at timestamptz, decision_note text check (decision_note is null or char_length(decision_note) <= 500), approved_sig text check (approved_sig is null or char_length(approved_sig) < 80000),
  filed_by_name text, filed_at timestamptz, filed_sig text check (filed_sig is null or char_length(filed_sig) < 80000),
  document_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists v2_fbr_status_idx on public.v2_budget_requests (status, created_at desc);

alter table public.v2_entries add column if not exists request_id uuid references public.v2_budget_requests(id) on delete set null;
create index if not exists v2_entries_request_idx on public.v2_entries (request_id) where request_id is not null;

alter table public.v2_budget_requests enable row level security;
drop policy if exists fbr_read on public.v2_budget_requests;
create policy fbr_read on public.v2_budget_requests for select to authenticated using (public.v2_is_staff());
drop policy if exists fbr_insert on public.v2_budget_requests;
create policy fbr_insert on public.v2_budget_requests for insert to authenticated with check (public.v2_has_role('treasurer') and status = 'draft');
drop policy if exists fbr_update on public.v2_budget_requests;
create policy fbr_update on public.v2_budget_requests for update to authenticated
  using (public.v2_has_role('treasurer') and status in ('draft', 'returned')) with check (public.v2_has_role('treasurer') and status in ('draft', 'returned'));
drop policy if exists fbr_delete on public.v2_budget_requests;
create policy fbr_delete on public.v2_budget_requests for delete to authenticated using (public.v2_has_role('treasurer', 'mayor') and status in ('draft', 'returned'));
revoke all on public.v2_budget_requests from anon;

-- number, clean the items and work out the total; stages can only change through the functions (they set app.fbr = 1)
create or replace function public.v2_fbr_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare it jsonb; sum_ numeric := 0; clean jsonb := '[]'::jsonb; q numeric; u numeric;
begin
  if tg_op = 'INSERT' then
    new.req_no := 'FBR-' || to_char((now() at time zone 'Asia/Manila'), 'YYYY') || '-' || lpad(nextval('public.v2_fbr_seq')::text, 3, '0');
    new.prepared_by_name := coalesce((select p.full_name from public.v2_profiles p where p.user_id = auth.uid()), new.prepared_by_name);
  else
    new.req_no := old.req_no;
    if current_setting('app.fbr', true) is distinct from '1' and (new.status is distinct from old.status or new.approved_sig is distinct from old.approved_sig or new.filed_sig is distinct from old.filed_sig
        or new.decided_at is distinct from old.decided_at or new.filed_at is distinct from old.filed_at or new.prepared_sig is distinct from old.prepared_sig) then
      raise exception 'Use the Send, Approve or File buttons to move a request along';
    end if;
  end if;
  if jsonb_typeof(new.items) <> 'array' then raise exception 'Items must be a list'; end if;
  for it in select * from jsonb_array_elements(new.items) loop
    q := coalesce((it ->> 'qty')::numeric, 0); u := coalesce((it ->> 'unit')::numeric, 0);
    if q < 0 or u < 0 then raise exception 'Quantity and cost cannot be negative'; end if;
    if btrim(coalesce(it ->> 'item', '')) = '' then continue; end if;
    clean := clean || jsonb_build_array(jsonb_build_object('item', left(btrim(it ->> 'item'), 100), 'qty', q, 'unit', u, 'amount', round(q * u, 2)));
    sum_ := sum_ + round(q * u, 2);
  end loop;
  new.items := clean; new.total := sum_; new.updated_at := now();
  return new;
end $$;
drop trigger if exists v2_fbr_guard on public.v2_budget_requests;
create trigger v2_fbr_guard before insert or update on public.v2_budget_requests for each row execute function public.v2_fbr_guard();
drop trigger if exists v2_fbr_audit on public.v2_budget_requests;
create trigger v2_fbr_audit after insert or delete or update on public.v2_budget_requests for each row execute function public.v2_audit_trigger();

create or replace function public.v2__who() returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select p.full_name from public.v2_profiles p where p.user_id = auth.uid()), '') $$;
revoke all on function public.v2__who() from public, anon;
grant execute on function public.v2__who() to authenticated;

-- Treasurer: send for approval (signs)
create or replace function public.v2_fbr_submit(p_id uuid, p_sig text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.v2_budget_requests;
begin
  if not public.v2_has_role('treasurer') then raise exception 'Only the Treasurer sends a budget request'; end if;
  select * into r from public.v2_budget_requests where id = p_id for update;
  if not found then raise exception 'Request not found'; end if;
  if r.status not in ('draft', 'returned') then raise exception 'This request was already sent'; end if;
  if r.total <= 0 then raise exception 'Add at least one item with a cost'; end if;
  perform set_config('app.fbr', '1', true);
  update public.v2_budget_requests set status = 'submitted', prepared_at = now(), prepared_by_name = public.v2__who(), prepared_sig = nullif(p_sig, ''), decision_note = null where id = p_id;
end $$;

-- Mayor (President): approve or return with a comment (signs when approving)
create or replace function public.v2_fbr_decide(p_id uuid, p_approve boolean, p_note text, p_sig text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.v2_budget_requests;
begin
  if not public.v2_has_role('mayor') then raise exception 'Only the President (Mayor) approves a budget request'; end if;
  select * into r from public.v2_budget_requests where id = p_id for update;
  if not found then raise exception 'Request not found'; end if;
  if r.status <> 'submitted' then raise exception 'This request is not waiting for approval'; end if;
  if not p_approve and btrim(coalesce(p_note, '')) = '' then raise exception 'Say what needs to change'; end if;
  perform set_config('app.fbr', '1', true);
  update public.v2_budget_requests set status = case when p_approve then 'approved' else 'returned' end, decided_at = now(), decided_by_name = public.v2__who(),
    decision_note = nullif(left(btrim(coalesce(p_note, '')), 500), ''), approved_sig = case when p_approve then nullif(p_sig, '') else null end where id = p_id;
end $$;

-- Secretary: file an approved request (signs) and keep a copy in Documents
create or replace function public.v2_fbr_file(p_id uuid, p_sig text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.v2_budget_requests; did uuid;
begin
  if not public.v2_has_role('secretary', 'mayor') then raise exception 'Only the Secretary files a budget request'; end if;
  select * into r from public.v2_budget_requests where id = p_id for update;
  if not found then raise exception 'Request not found'; end if;
  if r.status <> 'approved' then raise exception 'Only an approved request can be filed'; end if;
  insert into public.v2_documents (title, kind, status, note, created_by, submitted_at)
    values (left(r.req_no || ' · ' || r.title, 100), 'form', 'submitted', left('Fund budget request, approved ' || to_char(r.decided_at at time zone 'Asia/Manila', 'Mon DD, YYYY'), 200), auth.uid(), now()) returning id into did;
  perform set_config('app.fbr', '1', true);
  update public.v2_budget_requests set status = 'filed', filed_at = now(), filed_by_name = public.v2__who(), filed_sig = nullif(p_sig, ''), document_id = did where id = p_id;
end $$;
revoke all on function public.v2_fbr_submit(uuid, text), public.v2_fbr_decide(uuid, boolean, text, text), public.v2_fbr_file(uuid, text) from public, anon;
grant execute on function public.v2_fbr_submit(uuid, text), public.v2_fbr_decide(uuid, boolean, text, text), public.v2_fbr_file(uuid, text) to authenticated;

do $$ begin
  begin alter publication supabase_realtime add table public.v2_budget_requests; exception when others then null; end;
end $$;
