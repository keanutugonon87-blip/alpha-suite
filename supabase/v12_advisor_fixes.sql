-- Alpha ’28 · v12 · Fixes for the Supabase security and performance advisor
-- 1. CLOSES A REAL HOLE: four old functions (log_collection, save_shared_data, sweep_overdue_instances, generate_recurring_instances)
--    had no sign-in check and could be run by anyone with the public key (add fake payments, overwrite saved data).
-- 2. Closes anonymous write access to the old shared_data table.
-- 3. Staff-only and internal functions can no longer be called by visitors (they already refused, now they are not even reachable).
-- 4. Speed: access rules that overlapped are split, the last "auth.uid() per row" warnings are cleared, missing foreign-key indexes are added.
-- Side effect: old standalone Alpha pages (not this app) that used those old functions or shared_data stop working. This app does not use them.
-- Replaces v7b (do not run v7b: its officer_roles rule would loop). Safe to run more than once.

-- ===========================================================================
-- 1. Old functions: nobody can call them through the public API
-- ===========================================================================
do $$ declare f regprocedure; begin
  for f in select p.oid::regprocedure from pg_proc p where p.pronamespace = 'public'::regnamespace
           and p.proname in ('log_collection', 'save_shared_data', 'sweep_overdue_instances', 'generate_recurring_instances') loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('alter function %s set search_path = public, pg_temp', f);
  end loop;
end $$;

-- ===========================================================================
-- 2. Internal functions (triggers, hooks): not callable through the API at all
-- ===========================================================================
do $$ declare f regprocedure; begin
  for f in select p.oid::regprocedure from pg_proc p where p.pronamespace = 'public'::regnamespace
           and p.proname in ('v2_audit_trigger', 'v2_entries_before', 'v2_entry_fund', 'v2_charge_fund_sync', 'v2_guard_last_mayor',
                             'v2_handle_new_user', 'v2_notify_announcement', 'v2_notify_signup') loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;

-- ===========================================================================
-- 3. Officer-only functions: signed-in only, never visitors
-- ===========================================================================
do $$ declare f regprocedure; begin
  for f in select p.oid::regprocedure from pg_proc p where p.pronamespace = 'public'::regnamespace
           and p.proname in ('v2_backup_now', 'v2_login_stats', 'v2_officer_links', 'v2_guest_list', 'v2_reminder_status', 'v2_reset_member_pin',
                             'v2_security_overview', 'v2_send_reminder', 'v2_signup_status', 'v2_pin_members', 'v2_my_token') loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ===========================================================================
-- 4. Old tables: shared_data closed to visitors, officer_roles readable only for your own row
-- ===========================================================================
drop policy if exists "Anyone can read shared_data" on public.shared_data;
drop policy if exists "Anyone can update shared_data" on public.shared_data;
drop policy if exists "Anyone can upsert shared_data" on public.shared_data;
drop policy if exists shared_data_staff on public.shared_data;
create policy shared_data_staff on public.shared_data for all to authenticated using (public.v2_is_staff()) with check (public.v2_is_staff());

-- (own row only: the helper that checks "is treasurer" reads this table, so this rule must not call it)
drop policy if exists officer_roles_select on public.officer_roles;
create policy officer_roles_select on public.officer_roles for select using (user_id = (select auth.uid()));
drop policy if exists officer_roles_admin_delete on public.officer_roles;
create policy officer_roles_admin_delete on public.officer_roles for delete using (public.is_treasurer_or_admin((select auth.uid())));
drop policy if exists officer_roles_admin_update on public.officer_roles;
create policy officer_roles_admin_update on public.officer_roles for update using (public.is_treasurer_or_admin((select auth.uid()))) with check (public.is_treasurer_or_admin((select auth.uid())));
drop policy if exists officer_roles_self_insert on public.officer_roles;
create policy officer_roles_self_insert on public.officer_roles for insert with check (
  user_id = (select auth.uid()) and (role = 'pending' or (role = 'mayor' and not exists (select 1 from public.officer_roles r))));

-- the three old "any signed-in user" reads become officer-only (students now have accounts too)
drop policy if exists dues_config_read on public.dues_config;
create policy dues_config_read on public.dues_config for select using (public.is_treasurer_or_admin((select auth.uid())));
drop policy if exists one_time_dues_read on public.one_time_dues;
create policy one_time_dues_read on public.one_time_dues for select using (public.is_treasurer_or_admin((select auth.uid())));
drop policy if exists one_time_dues_targets_read on public.one_time_dues_targets;
create policy one_time_dues_targets_read on public.one_time_dues_targets for select using (public.is_treasurer_or_admin((select auth.uid())));

-- ===========================================================================
-- 5. Speed: a rule that covers "all actions" overlaps the read rule. Split it into insert / update / delete.
--    Who may do what is unchanged.
-- ===========================================================================
do $$
declare s record; roles_sql text;
begin
  for s in select * from (values
    ('dues_config',           'dues_config_write',           null,            'public.is_treasurer_or_admin((select auth.uid()))'),
    ('dues_instances',        'dues_instances_admin_write',  null,            'public.is_treasurer_or_admin((select auth.uid()))'),
    ('dues_overrides',        'dues_overrides_write',        null,            'public.is_treasurer_or_admin((select auth.uid()))'),
    ('one_time_dues',         'one_time_dues_write',         null,            'public.is_treasurer_or_admin((select auth.uid()))'),
    ('one_time_dues_targets', 'one_time_dues_targets_write', null,            'public.is_treasurer_or_admin((select auth.uid()))'),
    ('v2_announcements',      'ann_write',                   null,            'public.v2_has_role(''mayor'', ''vice_mayor'', ''secretary'', ''pio'')'),
    ('v2_charges',            'charges_write',               'authenticated', 'public.v2_has_role(''mayor'', ''treasurer'')'),
    ('v2_members',            'members_write',               'authenticated', 'public.v2_has_role(''mayor'', ''vice_mayor'', ''secretary'')'),
    ('v2_officers',           'officers_write',              'authenticated', 'public.v2_has_role(''mayor'', ''vice_mayor'', ''secretary'', ''pio'')'),
    ('v2_settings',           'set_write',                   null,            'public.v2_has_role(''mayor'')'),
    ('v2_standards',          'standards_write',             'authenticated', 'public.v2_has_role(''mayor'', ''vice_mayor'')'),
    ('v2_violations',         'violations_write',            'authenticated', 'public.v2_has_role(''mayor'', ''vice_mayor'', ''secretary'', ''marshall'', ''sails'')')
  ) as t(tbl, pol, rl, expr) loop
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = s.tbl and policyname = s.pol and cmd = 'ALL') then
      roles_sql := case when s.rl is null then '' else ' to ' || s.rl end;
      execute format('drop policy %I on public.%I', s.pol, s.tbl);
      execute format('drop policy if exists %I on public.%I', s.pol || '_ins', s.tbl);
      execute format('drop policy if exists %I on public.%I', s.pol || '_upd', s.tbl);
      execute format('drop policy if exists %I on public.%I', s.pol || '_del', s.tbl);
      execute format('create policy %I on public.%I for insert%s with check (%s)', s.pol || '_ins', s.tbl, roles_sql, s.expr);
      execute format('create policy %I on public.%I for update%s using (%s) with check (%s)', s.pol || '_upd', s.tbl, roles_sql, s.expr, s.expr);
      execute format('create policy %I on public.%I for delete%s using (%s)', s.pol || '_del', s.tbl, roles_sql, s.expr);
    end if;
  end loop;
end $$;

-- profiles: one read rule instead of two; the other rules check the user once per query
drop policy if exists profiles_read_own on public.v2_profiles;
drop policy if exists profiles_read_staff on public.v2_profiles;
drop policy if exists profiles_read on public.v2_profiles;
create policy profiles_read on public.v2_profiles for select to authenticated using (user_id = (select auth.uid()) or public.v2_is_staff());
drop policy if exists profiles_mayor_del on public.v2_profiles;
create policy profiles_mayor_del on public.v2_profiles for delete to authenticated using (public.v2_has_role('mayor') and user_id <> (select auth.uid()));
drop policy if exists officer_edits_read on public.v2_officer_edits;
create policy officer_edits_read on public.v2_officer_edits for select using (submitted_by = (select auth.uid()) or public.v2_has_role('mayor', 'vice_mayor'));

-- ===========================================================================
-- 6. Speed: an index for every foreign key that has none
-- ===========================================================================
do $$ declare r record; begin
  for r in
    select c.conrelid::regclass as tbl, c.conname,
           (select string_agg(quote_ident(a.attname), ', ' order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as cols
    from pg_constraint c
    where c.contype = 'f' and c.connamespace = 'public'::regnamespace
      and not exists (select 1 from pg_index i where i.indrelid = c.conrelid
                      and (string_to_array(i.indkey::text, ' ')::int[])[1:cardinality(c.conkey)] = c.conkey::int[])
  loop
    execute format('create index if not exists %I on %s (%s)', left('idx_fk_' || r.conname, 63), r.tbl, r.cols);
  end loop;
end $$;
