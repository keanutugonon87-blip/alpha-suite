-- Alpha ’28 · v7b · OPTIONAL: close the old open tables
-- Run this only AFTER v7 works and you have turned "Require sign-in" on and tested it.
-- Why: a few tables from the earliest versions (before Alpha ’28) can be read by anyone who is merely signed in,
-- or by anyone at all. Once students have accounts, "signed in" no longer means "officer", so these are closed.
-- Side effect: the old standalone Alpha pages (the ones that are not this app) stop working for anonymous visitors.
-- This app does not use these tables. Safe to run more than once.

drop policy if exists dues_config_read on public.dues_config;
create policy dues_config_read on public.dues_config for select using (public.is_treasurer_or_admin(auth.uid()));

drop policy if exists one_time_dues_read on public.one_time_dues;
create policy one_time_dues_read on public.one_time_dues for select using (public.is_treasurer_or_admin(auth.uid()));

drop policy if exists one_time_dues_targets_read on public.one_time_dues_targets;
create policy one_time_dues_targets_read on public.one_time_dues_targets for select using (public.is_treasurer_or_admin(auth.uid()));

drop policy if exists officer_roles_select on public.officer_roles;
create policy officer_roles_select on public.officer_roles for select using (user_id = auth.uid() or public.is_treasurer_or_admin(auth.uid()));

drop policy if exists "Anyone can read shared_data" on public.shared_data;
drop policy if exists "Anyone can update shared_data" on public.shared_data;
drop policy if exists "Anyone can upsert shared_data" on public.shared_data;
create policy shared_data_staff on public.shared_data for all to authenticated using (public.v2_is_staff()) with check (public.v2_is_staff());
