-- Alpha ’28 · v11 · Close the two old public views and speed up the old tables' access rules.
-- Why: public.fund_totals and public.qr_collections_public (from the earliest Alpha Treasury) ran with their owner's full access,
-- so ANYONE with the public app key could read the 20 old transactions with student names, Student IDs, receipt numbers and amounts.
-- After this, those views obey the table rules: officers (treasurer/admin) see everything, a student sees only their own rows, visitors see nothing.
-- This app (Alpha ’28) does not use either view. Old standalone Alpha pages that read them without signing in will stop showing data.
-- Also clears the "Auth RLS Initialization Plan" speed warnings. Behaviour of those rules is unchanged. Safe to run more than once.

-- 1. The two views: use the caller's rights, and no public access
alter view public.fund_totals set (security_invoker = true);
alter view public.qr_collections_public set (security_invoker = true);
revoke all on public.fund_totals from anon, authenticated;
revoke all on public.qr_collections_public from anon, authenticated;
grant select on public.fund_totals to authenticated;
grant select on public.qr_collections_public to authenticated;

-- 2. Same rules, written so Postgres checks the user once per query instead of once per row
drop policy if exists audit_log_read on public.audit_log;
create policy audit_log_read on public.audit_log for select using (public.is_treasurer_or_admin((select auth.uid())));
drop policy if exists audit_log_write on public.audit_log;
create policy audit_log_write on public.audit_log for insert with check (public.is_treasurer_or_admin((select auth.uid())));

drop policy if exists dues_config_read on public.dues_config;
create policy dues_config_read on public.dues_config for select using ((select auth.role()) = 'authenticated');
drop policy if exists dues_config_write on public.dues_config;
create policy dues_config_write on public.dues_config for all using (public.is_treasurer_or_admin((select auth.uid()))) with check (public.is_treasurer_or_admin((select auth.uid())));

drop policy if exists dues_instances_admin_write on public.dues_instances;
create policy dues_instances_admin_write on public.dues_instances for all using (public.is_treasurer_or_admin((select auth.uid()))) with check (public.is_treasurer_or_admin((select auth.uid())));
drop policy if exists dues_instances_self_select on public.dues_instances;
create policy dues_instances_self_select on public.dues_instances for select using (
  exists (select 1 from public.students s where s.id = dues_instances.student_id and s.auth_user_id = (select auth.uid()))
  or public.is_treasurer_or_admin((select auth.uid())));

drop policy if exists dues_overrides_read on public.dues_overrides;
create policy dues_overrides_read on public.dues_overrides for select using (public.is_treasurer_or_admin((select auth.uid())));
drop policy if exists dues_overrides_write on public.dues_overrides;
create policy dues_overrides_write on public.dues_overrides for all using (public.is_treasurer_or_admin((select auth.uid()))) with check (public.is_treasurer_or_admin((select auth.uid())));

drop policy if exists one_time_dues_read on public.one_time_dues;
create policy one_time_dues_read on public.one_time_dues for select using ((select auth.role()) = 'authenticated');
drop policy if exists one_time_dues_write on public.one_time_dues;
create policy one_time_dues_write on public.one_time_dues for all using (public.is_treasurer_or_admin((select auth.uid()))) with check (public.is_treasurer_or_admin((select auth.uid())));

drop policy if exists one_time_dues_targets_read on public.one_time_dues_targets;
create policy one_time_dues_targets_read on public.one_time_dues_targets for select using ((select auth.role()) = 'authenticated');
drop policy if exists one_time_dues_targets_write on public.one_time_dues_targets;
create policy one_time_dues_targets_write on public.one_time_dues_targets for all using (public.is_treasurer_or_admin((select auth.uid()))) with check (public.is_treasurer_or_admin((select auth.uid())));

drop policy if exists students_admin_update on public.students;
create policy students_admin_update on public.students for update using (public.is_treasurer_or_admin((select auth.uid())));
drop policy if exists students_admin_write on public.students;
create policy students_admin_write on public.students for insert with check (public.is_treasurer_or_admin((select auth.uid())));
drop policy if exists students_self_select on public.students;
create policy students_self_select on public.students for select using (auth_user_id = (select auth.uid()) or public.is_treasurer_or_admin((select auth.uid())));

drop policy if exists transactions_self_select on public.transactions;
create policy transactions_self_select on public.transactions for select using (
  exists (select 1 from public.students s where s.id = transactions.student_id and s.auth_user_id = (select auth.uid()))
  or public.is_treasurer_or_admin((select auth.uid())));
drop policy if exists transactions_treasurer_delete on public.transactions;
create policy transactions_treasurer_delete on public.transactions for delete using (public.is_treasurer_or_admin((select auth.uid())));
drop policy if exists transactions_treasurer_write on public.transactions;
create policy transactions_treasurer_write on public.transactions for insert with check (public.is_treasurer_or_admin((select auth.uid())));
