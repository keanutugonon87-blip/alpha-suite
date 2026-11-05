-- v38 · Collections no longer wait for approval.
-- A collection (money received) counts the moment it is recorded and the receipt is issued.
-- Everything is still logged; the Mayor and Auditor can see and void any entry.
-- EXPENSES keep every approval rule (Mayor approval, second officer for big amounts, approval reference).
-- Safe to run twice.

create or replace function public.v2_entries_before() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r text := public.v2_role(); thr numeric := coalesce(nullif(public.v2__setting('expense_second_approval'), '')::numeric, 500);
        second boolean; mn text; mo text; human boolean := auth.uid() is not null;   -- no signed-in officer = SQL editor / maintenance script: the rules below do not apply
begin
  second := human and new.kind = 'expense' and thr > 0 and new.amount >= thr and coalesce(new.source, 'manual') = 'manual';
  if tg_op = 'INSERT' then
    if new.kind = 'collection' and new.receipt_no is null then
      new.receipt_no := 'AT-' || to_char(now() at time zone 'Asia/Manila', 'YYYY') || '-' || lpad(nextval('public.v2_receipt_seq')::text, 6, '0');
    end if;
    if new.recorded_by is null then new.recorded_by := auth.uid(); end if;
    if new.kind = 'collection' and new.status = 'pending' then new.status := 'approved'; new.approved_by_name := coalesce(new.approved_by_name, 'No approval needed'); end if;   -- collections count at once
    if r = 'treasurer' and new.kind <> 'collection' then new.status := 'pending'; end if;   -- the Treasurer's expenses still wait for the Mayor
    if second and new.status = 'approved' then new.status := 'pending'; new.approved_by_name := null; end if;   -- big expenses always need a second officer
    if new.period_id is not null and not exists (select 1 from public.v2_periods where id = new.period_id and status = 'open') then
      raise exception 'That period is closed';
    end if;
  else
    if human and new.status is distinct from old.status and new.status = 'approved' then
      if coalesce(current_setting('alpha.approving', true), '') = '1' then null;   -- came through v2_approve_entry
      elsif new.kind = 'collection' then null;                                    -- collections need no approval
      elsif r is distinct from 'mayor' then raise exception 'Only the Mayor can approve entries';
      elsif second then raise exception 'This expense needs a second officer to approve it';
      end if;
    end if;
    if old.status = 'voided' then raise exception 'Voided entries cannot be changed'; end if;
    if new.status = 'voided' then new.voided_at := now(); end if;
  end if;
  -- closed-month lock: money fields cannot change (moving a pending entry to the next period is still fine)
  if human and (tg_op = 'INSERT' or (new.amount, new.kind, new.status, new.occurred_at, new.member_id, new.charge_id, new.fund)
                         is distinct from (old.amount, old.kind, old.status, old.occurred_at, old.member_id, old.charge_id, old.fund)) then
    mn := to_char(new.occurred_at at time zone 'Asia/Manila', 'YYYY-MM');
    if exists (select 1 from public.v2_month_close where month = mn and status = 'closed') then raise exception 'The month % is closed. The Mayor can reopen it.', mn; end if;
    if tg_op = 'UPDATE' then
      mo := to_char(old.occurred_at at time zone 'Asia/Manila', 'YYYY-MM');
      if mo <> mn and exists (select 1 from public.v2_month_close where month = mo and status = 'closed') then raise exception 'The month % is closed. The Mayor can reopen it.', mo; end if;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- Collections already waiting for approval now count (SQL editor runs without a signed-in officer, so the closed-month lock does not block this).
update public.v2_entries set status = 'approved', approved_by_name = coalesce(approved_by_name, 'No approval needed')
 where kind = 'collection' and status = 'pending';
