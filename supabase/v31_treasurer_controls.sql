-- Alpha ’28 · v31 · Treasurer controls (Section 5 of the CBL): no disbursement without approval, and acknowledgments for funds received.
-- Safe to run more than once. Paste all of it into Supabase > SQL Editor > Run. Run v24 first.
--
--   • An expense at or above the approval limit (the same limit that already asks for a second officer and a receipt photo, ₱500 unless you
--     changed it in Settings) must name its approval: either an approved budget request, or an approval reference such as an adviser memo or
--     a PIT approval number. Smaller expenses (petty) can be recorded without one. The Mayor still approves every entry.
--   • An expense that names a budget request is only accepted when that request is approved or filed.
--   • The Treasurer (or Mayor) records that an acknowledgment (official receipt) was issued for a collection, so the Treasurer’s desk can show
--     which funds received have no acknowledgment yet.

alter table public.v2_entries
  add column if not exists approval_ref text check (approval_ref is null or char_length(approval_ref) <= 120),
  add column if not exists ack_at timestamptz,
  add column if not exists ack_by_name text;

create or replace function public.v2_disbursement_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare thr numeric := coalesce(nullif(public.v2__setting('expense_second_approval'), '')::numeric, 500); st text;
begin
  if auth.uid() is null or new.kind <> 'expense' or coalesce(new.source, 'manual') <> 'manual' then return new; end if;   -- SQL editor, imports and collections are not checked here
  if new.request_id is not null then
    select status into st from public.v2_budget_requests where id = new.request_id;
    if st is null or st not in ('approved', 'filed') then raise exception 'That budget request is not approved yet'; end if;
    return new;
  end if;
  if thr > 0 and new.amount >= thr and nullif(btrim(coalesce(new.approval_ref, '')), '') is null then
    raise exception 'No disbursement without approval. Pick the approved budget request, or give the approval reference (adviser memo or PIT approval).';
  end if;
  return new;
end $$;
revoke all on function public.v2_disbursement_guard() from public, anon;
drop trigger if exists v2_entries_disbursement on public.v2_entries;
create trigger v2_entries_disbursement before insert on public.v2_entries for each row execute function public.v2_disbursement_guard();

-- the Treasurer marks acknowledgments as issued (one or many at once)
create or replace function public.v2_entry_ack(p_ids uuid[]) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not public.v2_has_role('treasurer', 'mayor') then raise exception 'Only the Treasurer issues acknowledgments'; end if;
  update public.v2_entries set ack_at = now(), ack_by_name = public.v2__who()
   where id = any(p_ids) and kind = 'collection' and status = 'approved' and ack_at is null;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.v2_entry_ack(uuid[]) from public, anon;
grant execute on function public.v2_entry_ack(uuid[]) to authenticated;
