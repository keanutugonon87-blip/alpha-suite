-- Alpha ’28 · v26 · Let the Mayor delete a budget request or its liquidation report (for test runs and mistakes).
-- Run v24 and v25 first. Safe to run more than once.
--
--   • The Mayor can delete a budget request in any stage. Its liquidation report goes with it, and the copies in Documents are removed.
--     Expenses that were linked to it stay; they are only unlinked.
--   • The Mayor can delete just a liquidation report, so the Treasurer can prepare it again.
--   • The Treasurer can still delete their own drafts and returned requests. Every deletion is kept in the audit log.

create or replace function public.v2_fbr_delete(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.v2_budget_requests; ldoc uuid;
begin
  if not public.v2_has_role('mayor') then raise exception 'Only the Mayor can delete a filed or approved request'; end if;
  select * into r from public.v2_budget_requests where id = p_id for update;
  if not found then raise exception 'Request not found'; end if;
  select document_id into ldoc from public.v2_liquidations where request_id = p_id;
  delete from public.v2_budget_requests where id = p_id;          -- the liquidation report goes with it (cascade); expenses are unlinked
  delete from public.v2_documents where id in (r.document_id, ldoc);
end $$;

create or replace function public.v2_liq_delete(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.v2_liquidations;
begin
  if not public.v2_has_role('mayor') then raise exception 'Only the Mayor can delete a liquidation report'; end if;
  select * into l from public.v2_liquidations where id = p_id for update;
  if not found then raise exception 'Report not found'; end if;
  delete from public.v2_liquidations where id = p_id;
  delete from public.v2_documents where id = l.document_id;
end $$;

revoke all on function public.v2_fbr_delete(uuid), public.v2_liq_delete(uuid) from public, anon;
grant execute on function public.v2_fbr_delete(uuid), public.v2_liq_delete(uuid) to authenticated;
