-- v78: line of authority. Powers meant for the SAILS officers were open to every Class Mayor (role 'mayor').
-- After this: the SAILS President (or a deputy for approvals) decides budgets and liquidations, the SAILS Treasurer prepares them,
-- the SAILS Secretary files them; school-wide settings, guest codes and the alert key are the President's; the public lists
-- (officers, FAQ, standards, notices) belong to the SAILS officers; a Class Mayor links only their own class officers to students of their own class.
-- Also repairs v2_set_setting, which had lost the require_login, duty and public_names settings.

-- 1. Budget requests and liquidation reports
create or replace function public.v2_fbr_decide(p_id uuid, p_approve boolean, p_note text, p_sig text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.v2_budget_requests;
begin
  if not public.v2_is_president() then raise exception 'Only the SAILS President approves a budget request'; end if;
  select * into r from public.v2_budget_requests where id = p_id for update;
  if not found then raise exception 'Request not found'; end if;
  if r.prepared_by = auth.uid() then raise exception 'You prepared this request. Someone else must decide it.'; end if;
  if r.status <> 'submitted' then raise exception 'This request is not waiting for approval'; end if;
  if not p_approve and btrim(coalesce(p_note, '')) = '' then raise exception 'Say what needs to change'; end if;
  perform set_config('app.fbr', '1', true);
  update public.v2_budget_requests set status = case when p_approve then 'approved' else 'returned' end, decided_at = now(), decided_by_name = public.v2__who(), decision_note = nullif(left(btrim(coalesce(p_note, '')), 500), ''), approved_sig = case when p_approve then nullif(p_sig, '') else null end where id = p_id;
end $$;

create or replace function public.v2_liq_decide(p_id uuid, p_approve boolean, p_note text, p_sig text) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.v2_liquidations;
begin
  if not public.v2_is_president() then raise exception 'Only the SAILS President approves a liquidation report'; end if;
  select * into l from public.v2_liquidations where id = p_id for update;
  if not found then raise exception 'Report not found'; end if;
  if l.prepared_by_name is not distinct from public.v2__who() then raise exception 'You prepared this report. Someone else must decide it.'; end if;
  if l.status <> 'submitted' then raise exception 'This report is not waiting for approval'; end if;
  if not p_approve and btrim(coalesce(p_note, '')) = '' then raise exception 'Say what needs to change'; end if;
  update public.v2_liquidations set status = case when p_approve then 'approved' else 'returned' end, decided_at = now(), decided_by_name = public.v2__who(), decision_note = nullif(left(btrim(coalesce(p_note, '')), 500), ''), approved_sig = case when p_approve then nullif(p_sig, '') else null end, updated_at = now() where id = p_id;
end $$;

create or replace function public.v2_fbr_submit(p_id uuid, p_sig text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.v2_budget_requests;
begin
  if public.v2_role() is distinct from 'treasurer' then raise exception 'Only the SAILS Treasurer sends a budget request'; end if;
  select * into r from public.v2_budget_requests where id = p_id for update;
  if not found then raise exception 'Request not found'; end if;
  if r.status not in ('draft', 'returned') then raise exception 'This request was already sent'; end if;
  if r.total <= 0 then raise exception 'Add at least one item with a cost'; end if;
  perform set_config('app.fbr', '1', true);
  update public.v2_budget_requests set status = 'submitted', prepared_at = now(), prepared_by_name = public.v2__who(), prepared_sig = nullif(p_sig, ''), decision_note = null where id = p_id;
end $$;

create or replace function public.v2_fbr_file(p_id uuid, p_sig text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.v2_budget_requests; did uuid;
begin
  if public.v2_role() is distinct from 'secretary' then raise exception 'Only the SAILS Secretary files a budget request'; end if;
  select * into r from public.v2_budget_requests where id = p_id for update;
  if not found then raise exception 'Request not found'; end if;
  if r.status <> 'approved' then raise exception 'Only an approved request can be filed'; end if;
  insert into public.v2_documents (title, kind, status, note, created_by, submitted_at) values (left(r.req_no || ' · ' || r.title, 100), 'form', 'submitted', left('Fund budget request, approved ' || to_char(r.decided_at at time zone 'Asia/Manila', 'Mon DD, YYYY'), 200), auth.uid(), now()) returning id into did;
  perform set_config('app.fbr', '1', true);
  update public.v2_budget_requests set status = 'filed', filed_at = now(), filed_by_name = public.v2__who(), filed_sig = nullif(p_sig, ''), document_id = did where id = p_id;
end $$;

create or replace function public.v2_fbr_delete(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.v2_budget_requests; ldoc uuid;
begin
  if not public.v2_is_real_president() then raise exception 'Only the SAILS President can delete a filed or approved request'; end if;
  select * into r from public.v2_budget_requests where id = p_id for update;
  if not found then raise exception 'Request not found'; end if;
  select document_id into ldoc from public.v2_liquidations where request_id = p_id;
  delete from public.v2_budget_requests where id = p_id;
  delete from public.v2_documents where id in (r.document_id, ldoc);
end $$;

create or replace function public.v2_liq_file(p_id uuid, p_sig text) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.v2_liquidations; r public.v2_budget_requests; did uuid;
begin
  if public.v2_role() is distinct from 'secretary' then raise exception 'Only the SAILS Secretary files a liquidation report'; end if;
  select * into l from public.v2_liquidations where id = p_id for update;
  if not found then raise exception 'Report not found'; end if;
  if l.status <> 'audited' then raise exception 'Only an audited report can be filed'; end if;
  select * into r from public.v2_budget_requests where id = l.request_id;
  insert into public.v2_documents (title, kind, status, note, created_by, submitted_at) values (left('Liquidation · ' || r.req_no || ' · ' || r.title, 100), 'report', 'submitted', left('Audited ' || to_char(l.audited_at at time zone 'Asia/Manila', 'Mon DD, YYYY') || ', opinion: clear', 200), auth.uid(), now()) returning id into did;
  update public.v2_liquidations set status = 'filed', filed_at = now(), filed_by_name = public.v2__who(), filed_sig = nullif(p_sig, ''), document_id = did, updated_at = now() where id = p_id;
end $$;

create or replace function public.v2_liq_delete(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.v2_liquidations;
begin
  if not public.v2_is_real_president() then raise exception 'Only the SAILS President can delete a liquidation report'; end if;
  select * into l from public.v2_liquidations where id = p_id for update;
  if not found then raise exception 'Report not found'; end if;
  delete from public.v2_liquidations where id = p_id;
  delete from public.v2_documents where id = l.document_id;
end $$;

-- v2_liq_submit: only the SAILS Treasurer prepares the report (the rest of the function is unchanged)
do $do$ declare src text; n text;
begin
  select pg_get_functiondef('public.v2_liq_submit(uuid,numeric,text,text)'::regprocedure) into src;
  n := regexp_replace(src, 'if not public\.v2_has_role\(''treasurer'', ''mayor''\) then raise exception ''Only the Treasurer prepares a liquidation report'';', 'if public.v2_role() is distinct from ''treasurer'' then raise exception ''Only the SAILS Treasurer prepares a liquidation report'';');
  if n = src then raise exception 'patch missed: v2_liq_submit'; end if;
  execute n;
end $do$;

-- budget tables: SAILS Treasurer (exact role, not the Class Treasurer) and the President
alter policy fbr_insert on public.v2_budget_requests with check (public.v2_role() = 'treasurer' and status = 'draft');
alter policy fbr_update on public.v2_budget_requests using (public.v2_role() = 'treasurer' and status in ('draft', 'returned')) with check (public.v2_role() = 'treasurer' and status in ('draft', 'returned'));
alter policy fbr_delete on public.v2_budget_requests using (public.v2_role() = 'treasurer' and status in ('draft', 'returned'));
alter policy budgets_all on public.v2_budgets using (public.v2_role() = 'treasurer' or public.v2_is_real_president()) with check (public.v2_role() = 'treasurer' or public.v2_is_real_president());

-- 2. School-wide settings (one function; direct writes to the table are the President's only)
create or replace function public.v2_set_setting(p_key text, p_value text) returns void
language plpgsql security definer set search_path = '' as $$
declare v text := btrim(coalesce(p_value, ''));
begin
  if p_key = 'pay_note' then
    if not (public.v2_role() = 'treasurer' or public.v2_is_real_president()) then raise exception 'Only the SAILS Treasurer or the President can change this'; end if;
    if length(v) > 300 then raise exception 'Keep the payment note under 300 characters'; end if;
  elsif p_key = 'expense_second_approval' then
    if not (public.v2_role() = 'treasurer' or public.v2_is_real_president()) then raise exception 'Only the SAILS Treasurer or the President can change this'; end if;
    if v !~ '^\d{1,7}(\.\d{1,2})?$' then raise exception 'Enter an amount in pesos (0 turns the rule off)'; end if;
  elsif p_key = 'auto_nudge' then
    if not (public.v2_role() = 'treasurer' or public.v2_is_real_president()) then raise exception 'Only the SAILS Treasurer or the President can change this'; end if;
    if v not in ('on', 'off') then raise exception 'Use on or off'; end if;
  elsif p_key = 'require_login' then
    if not public.v2_is_real_president() then raise exception 'Only the SAILS President can change this'; end if;
    if v not in ('on', 'off') then raise exception 'Use on or off'; end if;
  elsif p_key = 'duty_alerts' then
    if not (public.v2_has_role('vice_mayor') or public.v2_is_real_president()) then raise exception 'Only a SAILS VP or the President can change this'; end if;
    if v not in ('on', 'off') then raise exception 'Use on or off'; end if;
  elsif p_key in ('duty_morning', 'duty_followup') then
    if not (public.v2_has_role('vice_mayor') or public.v2_is_real_president()) then raise exception 'Only a SAILS VP or the President can change this'; end if;
    if v !~ '^([01]\d|2[0-3]):[0-5]\d$' then raise exception 'Use a time like 06:30 or 16:00'; end if;
  elsif p_key = 'public_names' then
    if not (public.v2_role() in ('secretary', 'pio') or public.v2_is_real_president()) then raise exception 'Only the SAILS Secretary, PIO or the President can change this'; end if;
    if v not in ('full', 'initials') then raise exception 'Use full or initials'; end if;
  else raise exception 'Unknown setting'; end if;
  insert into public.v2_settings(key, value) values (p_key, v) on conflict (key) do update set value = excluded.value;
  if p_key = 'require_login' then
    insert into public.v2_audit(actor, actor_name, action, table_name, row_id, new_row)
      values (auth.uid(), (select full_name from public.v2_profiles where user_id = auth.uid()), 'SETTING', 'v2_settings', p_key, jsonb_build_object('value', v));
  end if;
end $$;
revoke all on function public.v2_set_setting(text, text) from public, anon;
grant execute on function public.v2_set_setting(text, text) to authenticated;
alter policy set_write_ins on public.v2_settings with check (public.v2_is_real_president());
alter policy set_write_upd on public.v2_settings using (public.v2_is_real_president()) with check (public.v2_is_real_president());
alter policy set_write_del on public.v2_settings using (public.v2_is_real_president());

-- 3. Guest codes and the alert key: the President
do $do$ declare f text; src text; n text;
begin
  foreach f in array array['public.v2_guest_create(text,integer)', 'public.v2_guest_revoke(uuid)', 'public.v2_rotate_hook_secret()'] loop
    select pg_get_functiondef(f::regprocedure) into src;
    n := replace(src, 'public.v2_has_role(''mayor'')', 'public.v2_is_real_president()');
    n := replace(n, 'Only the Mayor can', 'Only the SAILS President can');
    if n = src then raise exception 'patch missed: %', f; end if;
    execute n;
  end loop;
  select pg_get_functiondef('public.v2_announce_post(uuid)'::regprocedure) into src;
  n := replace(src, 'public.v2_has_role(''pio'', ''mayor'')', '(public.v2_role() = ''pio'' or public.v2_is_real_president())');
  if n = src then raise exception 'patch missed: v2_announce_post'; end if;
  execute n;
end $do$;

-- 4. Linking an officer account to a student
create or replace function public.v2_link_officer(p_user uuid, p_member uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare nm text; tr text; mu uuid; me text := public.v2_role();
begin
  select role into tr from public.v2_profiles where user_id = p_user;
  if tr is null then raise exception 'Unknown officer account'; end if;
  select unit_id into mu from public.v2_members where id = p_member and status = 'active';
  if not found then raise exception 'Pick an active student'; end if;
  if not (public.v2_is_real_president() or me = 'vp_internal'
          or (me = 'mayor' and public.v2__unit_ok(mu) and (tr in ('class_treasurer', 'class_secretary', 'marshall') or p_user = auth.uid()))) then
    raise exception 'You can link only your own class officers to students of your own class';
  end if;
  delete from auth.users where id in (select user_id from public.v2_member_accounts where member_id = p_member and user_id <> p_user and kind = 'student');
  if exists (select 1 from public.v2_member_accounts where member_id = p_member and user_id <> p_user) then raise exception 'That student is already linked to another officer'; end if;
  delete from public.v2_member_accounts where user_id = p_user and member_id <> p_member;
  insert into public.v2_member_accounts(member_id, user_id, kind, last_login_at) values (p_member, p_user, 'officer', now()) on conflict (member_id) do update set kind = 'officer';
  select full_name into nm from public.v2_profiles where user_id = auth.uid();
  insert into public.v2_audit(actor, actor_name, action, table_name, row_id) values (auth.uid(), nm, 'LINK', 'v2_member_accounts', p_user::text);
end $$;

create or replace function public.v2_unlink_officer(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me text := public.v2_role();
begin
  if not (public.v2_is_real_president() or me = 'vp_internal'
          or (me = 'mayor' and exists (select 1 from public.v2_member_accounts a join public.v2_members m on m.id = a.member_id join public.v2_profiles p on p.user_id = a.user_id
                where a.user_id = p_user and a.kind = 'officer' and public.v2__unit_ok(m.unit_id) and (p.role in ('class_treasurer', 'class_secretary', 'marshall') or p_user = auth.uid())))) then
    raise exception 'You can unlink only your own class officers';
  end if;
  delete from public.v2_member_accounts where user_id = p_user and kind = 'officer';
end $$;

revoke all on function public.v2_fbr_decide(uuid, boolean, text, text), public.v2_liq_decide(uuid, boolean, text, text), public.v2_fbr_submit(uuid, text), public.v2_fbr_file(uuid, text), public.v2_fbr_delete(uuid), public.v2_liq_file(uuid, text), public.v2_liq_delete(uuid), public.v2_link_officer(uuid, uuid), public.v2_unlink_officer(uuid) from public, anon;
grant execute on function public.v2_fbr_decide(uuid, boolean, text, text), public.v2_liq_decide(uuid, boolean, text, text), public.v2_fbr_submit(uuid, text), public.v2_fbr_file(uuid, text), public.v2_fbr_delete(uuid), public.v2_liq_file(uuid, text), public.v2_liq_delete(uuid), public.v2_link_officer(uuid, uuid), public.v2_unlink_officer(uuid) to authenticated;

-- 5. Public lists and notices belong to the SAILS officers, not to every Class Mayor
alter policy ann_write_ins on public.v2_announcements with check (public.v2_has_role('pio', 'secretary', 'vice_mayor') or public.v2_is_president());
alter policy ann_write_upd on public.v2_announcements using (public.v2_has_role('pio', 'secretary', 'vice_mayor') or public.v2_is_president()) with check (public.v2_has_role('pio', 'secretary', 'vice_mayor') or public.v2_is_president());
alter policy ann_write_del on public.v2_announcements using (public.v2_has_role('pio', 'secretary', 'vice_mayor') or public.v2_is_president());
alter policy officers_write_ins on public.v2_officers with check (public.v2_has_role('pio', 'secretary', 'vice_mayor') or public.v2_is_president());
alter policy officers_write_upd on public.v2_officers using (public.v2_has_role('pio', 'secretary', 'vice_mayor') or public.v2_is_president()) with check (public.v2_has_role('pio', 'secretary', 'vice_mayor') or public.v2_is_president());
alter policy officers_write_del on public.v2_officers using (public.v2_has_role('pio', 'secretary', 'vice_mayor') or public.v2_is_president());
alter policy faq_write on public.v2_faq using (public.v2_has_role('secretary', 'vice_mayor') or public.v2_is_president()) with check (public.v2_has_role('secretary', 'vice_mayor') or public.v2_is_president());
alter policy standards_write_ins on public.v2_standards with check (public.v2_has_role('vice_mayor') or public.v2_is_president());
alter policy standards_write_upd on public.v2_standards using (public.v2_has_role('vice_mayor') or public.v2_is_president()) with check (public.v2_has_role('vice_mayor') or public.v2_is_president());
alter policy standards_write_del on public.v2_standards using (public.v2_has_role('vice_mayor') or public.v2_is_president());

do $do$ declare src text;
begin
  select pg_get_functiondef('public.v2_schema_marks()'::regprocedure) into src;
  if src not like '%''v78''%' then
    src := replace(src, E'  return mk;', E'  mk := mk || jsonb_build_object(''v78'', exists (select 1 from pg_policies where policyname = ''set_write_upd'' and qual like ''%v2_is_real_president%''));\n  return mk;');
    execute src;
  end if;
end $do$;
