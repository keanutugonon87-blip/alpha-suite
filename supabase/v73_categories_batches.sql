-- v73: Treasury, step 1. Fixed collection categories, and cash batches with three people:
--   the Class Treasurer counts and submits the batch, the SAILS Treasurer recounts and verifies it (this also confirms the entries),
--   and the SAILS VP Internal countersigns it. A countersigned batch counts as deposited in the SAILS cash box.
-- Cash only. Run once in the Supabase SQL editor. Safe to run again.

-- 1. Categories: Contribution, Fines, Event or activity fund, Donation
update public.v2_entries set category = 'Contribution' where kind = 'collection' and category not in ('Contribution', 'Fines', 'Event or activity fund', 'Donation');
alter table public.v2_entries drop constraint if exists v2_entries_collection_category;
alter table public.v2_entries add constraint v2_entries_collection_category
  check (kind <> 'collection' or category in ('Contribution', 'Fines', 'Event or activity fund', 'Donation'));

alter table public.v2_charges add column if not exists category text not null default 'Contribution';
alter table public.v2_charges drop constraint if exists v2_charges_category_check;
alter table public.v2_charges add constraint v2_charges_category_check check (category in ('Contribution', 'Fines', 'Event or activity fund', 'Donation'));

create or replace function public.v2__entry_cat() returns trigger language plpgsql security definer set search_path = '' as $$
declare c text;
begin
  if new.kind = 'collection' and new.charge_id is not null then
    select category into c from public.v2_charges where id = new.charge_id;
    if c is not null then new.category := c; end if;
  end if;
  return new;
end $$;
drop trigger if exists v2_entry_cat on public.v2_entries;
create trigger v2_entry_cat before insert on public.v2_entries for each row execute function public.v2__entry_cat();

-- 2. Batches
create table if not exists public.v2_batches (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.v2_units(id),
  batch_no text not null,
  status text not null default 'submitted' check (status in ('submitted', 'verified', 'deposited', 'returned')),
  entries_count int not null check (entries_count > 0),
  entries_total numeric(12, 2) not null check (entries_total > 0),
  submitted_cash numeric(12, 2) not null check (submitted_cash >= 0),
  submitted_by uuid, submitted_by_name text, submitted_at timestamptz not null default now(), submit_note text,
  verified_cash numeric(12, 2) check (verified_cash is null or verified_cash >= 0),
  verified_by uuid, verified_by_name text, verified_at timestamptz, verify_note text,
  signed_by uuid, signed_by_name text, signed_at timestamptz, sign_note text,
  returned_by_name text, returned_at timestamptz, return_reason text,
  created_at timestamptz not null default now(),
  unique (unit_id, batch_no)
);
alter table public.v2_entries add column if not exists batch_id uuid references public.v2_batches(id);
-- collections recorded before this step are not required to go through a batch
-- default true: every entry recorded before this step is exempt without touching it; new entries from the app are set to false by the guard below
alter table public.v2_entries add column if not exists batch_exempt boolean not null default true;
create index if not exists v2_entries_batch_idx on public.v2_entries(batch_id) where batch_id is not null;

alter table public.v2_batches enable row level security;
drop policy if exists batches_read on public.v2_batches;
create policy batches_read on public.v2_batches for select to authenticated
  using (public.v2_is_president() or public.v2_role() in ('vp_internal', 'treasurer', 'auditor')
         or (public.v2_role() in ('class_treasurer', 'mayor') and public.v2__unit_ok(unit_id)));
revoke insert, update, delete, truncate, references, trigger on public.v2_batches from anon, authenticated;
grant select on public.v2_batches to authenticated;

-- 3. Money in a batch cannot be changed from the side, and only cash is accepted
create or replace function public.v2__entry_batch_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare flow boolean := coalesce(current_setting('app.batchflow', true), '') = '1';
begin
  if auth.uid() is null then return case tg_op when 'DELETE' then old else new end; end if;
  if tg_op = 'INSERT' then
    new.batch_id := null; new.batch_exempt := false;
    if new.method <> 'cash' then raise exception 'Only cash is accepted'; end if;
    return new;
  elsif tg_op = 'UPDATE' then
    new.batch_exempt := old.batch_exempt;
    if new.batch_id is distinct from old.batch_id and not flow then raise exception 'Only the batch steps can move money in or out of a batch'; end if;
    if old.batch_id is not null and not flow and (new.amount <> old.amount or new.status <> old.status or new.kind <> old.kind or new.method <> old.method or new.unit_id <> old.unit_id or new.category <> old.category) then
      raise exception 'This money is in a cash batch. The SAILS Treasurer or the VP Internal must return the batch first';
    end if;
    return new;
  else
    if old.batch_id is not null then raise exception 'This money is in a cash batch and cannot be deleted'; end if;
    return old;
  end if;
end $$;
drop trigger if exists v2_entry_batch_guard on public.v2_entries;
create trigger v2_entry_batch_guard before insert or update or delete on public.v2_entries for each row execute function public.v2__entry_batch_guard();

-- 4. Step 1: the Class Treasurer counts the cash and submits a batch
create or replace function public.v2_batch_create(p_ids uuid[], p_cash numeric, p_note text, p_unit uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare u uuid; n int; want int; tot numeric; nm text; bid uuid; no text;
begin
  if public.v2_role() is distinct from 'class_treasurer' then raise exception 'Only the Class Treasurer submits a cash batch'; end if;
  u := public.v2__act_unit(p_unit);
  select count(distinct x) into want from unnest(coalesce(p_ids, '{}'::uuid[])) x;
  if want = 0 then raise exception 'Choose the collections to put in the batch'; end if;
  if want > 300 then raise exception 'At most 300 collections in one batch'; end if;
  select count(*), coalesce(sum(amount), 0) into n, tot from public.v2_entries
    where id = any (p_ids) and unit_id = u and kind = 'collection' and status = 'approved' and method = 'cash' and batch_id is null;
  if n <> want then raise exception 'Some of those collections are not cash collections of your section that are free to batch'; end if;
  if p_cash is null or p_cash < 0 then raise exception 'Enter the cash you counted'; end if;
  if round(p_cash - tot, 2) <> 0 and btrim(coalesce(p_note, '')) = '' then raise exception 'The cash counted is different from the records by ₱%. Add a note that explains it', round(p_cash - tot, 2); end if;
  select full_name into nm from public.v2_profiles where user_id = auth.uid();
  no := 'B-' || lpad(((select count(*) from public.v2_batches where unit_id = u) + 1)::text, 3, '0');
  insert into public.v2_batches(unit_id, batch_no, entries_count, entries_total, submitted_cash, submitted_by, submitted_by_name, submit_note)
    values (u, no, n, tot, p_cash, auth.uid(), nm, nullif(btrim(coalesce(p_note, '')), '')) returning id into bid;
  perform set_config('app.batchflow', '1', true);
  update public.v2_entries set batch_id = bid where id = any (p_ids);
  perform set_config('app.batchflow', '', true);
  return bid;
end $$;

-- 5. Step 2: the SAILS Treasurer recounts. A verified batch also confirms its collections.
create or replace function public.v2_batch_verify(p_id uuid, p_cash numeric, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.v2_batches; nm text;
begin
  if public.v2_role() is distinct from 'treasurer' then raise exception 'Only the SAILS Treasurer verifies a batch'; end if;
  select * into b from public.v2_batches where id = p_id for update;
  if b.id is null then raise exception 'Batch not found'; end if;
  if b.status <> 'submitted' then raise exception 'This batch is not waiting for verification'; end if;
  if b.submitted_by = auth.uid() then raise exception 'You cannot verify a batch you submitted'; end if;
  if exists (select 1 from public.v2_entries where batch_id = b.id and recorded_by = auth.uid()) then raise exception 'You cannot verify cash you recorded yourself'; end if;
  if p_cash is null or p_cash < 0 then raise exception 'Enter the cash you counted'; end if;
  if round(p_cash - b.entries_total, 2) <> 0 and btrim(coalesce(p_note, '')) = '' then raise exception 'Your count is different from the records by ₱%. Add a note that explains it', round(p_cash - b.entries_total, 2); end if;
  select full_name into nm from public.v2_profiles where user_id = auth.uid();
  update public.v2_batches set status = 'verified', verified_cash = p_cash, verified_by = auth.uid(), verified_by_name = nm, verified_at = now(),
    verify_note = nullif(btrim(coalesce(p_note, '')), '') where id = b.id;
  update public.v2_entries set confirmed_at = coalesce(confirmed_at, now()), confirmed_by_name = coalesce(confirmed_by_name, nm) where batch_id = b.id;
end $$;

-- 6. Step 3: the SAILS VP Internal countersigns. The cash is then counted as deposited in the SAILS cash box.
create or replace function public.v2_batch_sign(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.v2_batches; nm text;
begin
  if public.v2_role() is distinct from 'vp_internal' then raise exception 'Only the SAILS VP Internal countersigns a batch'; end if;
  select * into b from public.v2_batches where id = p_id for update;
  if b.id is null then raise exception 'Batch not found'; end if;
  if b.status <> 'verified' then raise exception 'The SAILS Treasurer must verify this batch first'; end if;
  if round(coalesce(b.verified_cash, 0) - b.entries_total, 2) <> 0 and btrim(coalesce(p_note, '')) = '' then
    raise exception 'The verified count is different from the records. Add a note to countersign it anyway'; end if;
  select full_name into nm from public.v2_profiles where user_id = auth.uid();
  update public.v2_batches set status = 'deposited', signed_by = auth.uid(), signed_by_name = nm, signed_at = now(), sign_note = nullif(btrim(coalesce(p_note, '')), '') where id = b.id;
end $$;

-- 7. Send a batch back (the money returns to the Class Treasurer to batch again). Not possible after it is deposited.
create or replace function public.v2_batch_return(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.v2_batches; nm text;
begin
  if public.v2_role() not in ('treasurer', 'vp_internal') then raise exception 'Only the SAILS Treasurer or the SAILS VP Internal sends a batch back'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Say why the batch is sent back'; end if;
  select * into b from public.v2_batches where id = p_id for update;
  if b.id is null then raise exception 'Batch not found'; end if;
  if b.status not in ('submitted', 'verified') then raise exception 'A deposited batch cannot be sent back'; end if;
  select full_name into nm from public.v2_profiles where user_id = auth.uid();
  perform set_config('app.batchflow', '1', true);
  update public.v2_entries set batch_id = null where batch_id = b.id;
  perform set_config('app.batchflow', '', true);
  update public.v2_batches set status = 'returned', returned_by_name = nm, returned_at = now(), return_reason = left(btrim(p_reason), 300) where id = b.id;
end $$;

-- 8. Who may call
revoke execute on function public.v2_batch_create(uuid[], numeric, text, uuid), public.v2_batch_verify(uuid, numeric, text), public.v2_batch_sign(uuid, text), public.v2_batch_return(uuid, text) from public, anon;
grant execute on function public.v2_batch_create(uuid[], numeric, text, uuid), public.v2_batch_verify(uuid, numeric, text), public.v2_batch_sign(uuid, text), public.v2_batch_return(uuid, text) to authenticated, service_role;

do $do$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'v2_batches') then
    alter publication supabase_realtime add table public.v2_batches;
  end if;
end $do$;

do $do$ declare src text;
begin
  select pg_get_functiondef('public.v2_schema_marks()'::regprocedure) into src;
  if src not like '%''v73''%' then
    src := replace(src, E'  return mk;', E'  mk := mk || jsonb_build_object(''v73'', to_regclass(''public.v2_batches'') is not null);\n  return mk;');
    execute src;
  end if;
end $do$;
