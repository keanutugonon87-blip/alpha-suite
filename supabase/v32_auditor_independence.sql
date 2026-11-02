-- Alpha ’28 · v32 · The Auditor no longer approves spending (CBL Section 6: the Auditor checks the books independently).
-- Safe to run more than once. Paste all of it into Supabase > SQL Editor > Run. Run v5 and v28 first.
-- A large expense (at or above the limit) is approved by an officer who did not record it: Mayor, VP Internal (or Vice Mayor), Secretary or Treasurer.
-- The Auditor still reads every entry, verifies the month and can flag problems.

create or replace function public.v2_approve_entry(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.v2_entries; r text := public.v2_role(); thr numeric := coalesce(nullif(public.v2__setting('expense_second_approval'), '')::numeric, 500); second boolean; nm text;
begin
  if not public.v2_has_role('mayor', 'vice_mayor', 'secretary', 'treasurer') then raise exception 'Not allowed'; end if;
  select * into e from public.v2_entries where id = p_id for update;
  if e.id is null then raise exception 'Unknown entry'; end if;
  if e.status <> 'pending' then raise exception 'This entry is not waiting for approval'; end if;
  second := e.kind = 'expense' and thr > 0 and e.amount >= thr and coalesce(e.source, 'manual') = 'manual';
  if second then
    if e.recorded_by is not distinct from auth.uid() then raise exception 'You recorded this expense, so another officer must approve it'; end if;
    if e.receipt_image is null then raise exception 'This expense has no receipt photo yet. Add one before approving'; end if;
  elsif r <> 'mayor' then raise exception 'Only the Mayor can approve this entry'; end if;
  select full_name into nm from public.v2_profiles where user_id = auth.uid();
  perform set_config('alpha.approving', '1', true);
  update public.v2_entries set status = 'approved', approved_by_name = nm where id = p_id;
  perform set_config('alpha.approving', '', true);
end $$;
revoke all on function public.v2_approve_entry(uuid) from public, anon;
grant execute on function public.v2_approve_entry(uuid) to authenticated;
