-- v61: Class Treasurer role, Nameplate / Siglakas progress reports, the Class Mayor supervises money but no longer records it.
-- Run once in the Supabase SQL editor. Safe to run again.

-- 1. A Class Treasurer role (collects the class funds). It works like the treasurer in every rule that checks v2_has_role('treasurer').
alter table public.v2_profiles drop constraint if exists v2_profiles_role_check;
alter table public.v2_profiles add constraint v2_profiles_role_check check (role = any (array[
  'pending','mayor','vp_internal','vp_external','secretary','treasurer','class_treasurer','auditor','marshall','pio','general_marshal','dept_marshal','sails_president']));

create or replace function public.v2_has_role(variadic roles text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.v2_role() = any(roles)
    or (public.v2_role() in ('vp_internal', 'vp_external') and 'vice_mayor' = any(roles))
    or (public.v2_role() = 'class_treasurer' and 'treasurer' = any(roles)), false)
$$;

-- The Class Mayor and the Auditor can see the Class Treasurer in the officer list
alter policy profiles_read on public.v2_profiles using (
  (user_id = (select auth.uid())) or public.v2_is_president()
  or (public.v2_role() = any (array['vp_internal','vp_external','general_marshal']))
  or ((public.v2_role() = any (array['mayor','auditor'])) and (role = any (array['vice_mayor','secretary','treasurer','class_treasurer','auditor','marshall','pio','sails'])))
);

-- 2. The Class Mayor supervises collection: he can still approve and review entries, but only the treasurer records them.
alter policy entries_insert on public.v2_entries with check (public.v2_has_role('treasurer'));
-- ...and only the treasurer sets up and edits the charges (contributions) that are collected
alter policy charges_write_ins on public.v2_charges with check (public.v2_has_role('treasurer'));
alter policy charges_write_upd on public.v2_charges using (public.v2_has_role('treasurer')) with check (public.v2_has_role('treasurer'));

-- 3. Progress reports on the Nameplate and the Siglakas shirts (sent by the Class Mayor to the SAILS VP Internal)
alter table public.v2_class_asks drop constraint if exists v2_class_asks_kind_check;
alter table public.v2_class_asks add constraint v2_class_asks_kind_check check (kind in ('funds', 'activity', 'other', 'nameplate', 'siglakas'));
alter table public.v2_class_asks add column if not exists stage text;
alter table public.v2_class_asks add column if not exists qty_total int;
alter table public.v2_class_asks add column if not exists qty_paid int;
alter table public.v2_class_asks add column if not exists target numeric(12, 2);
alter table public.v2_class_asks add column if not exists eta date;
alter table public.v2_class_asks drop constraint if exists v2_class_asks_progress_check;
alter table public.v2_class_asks add constraint v2_class_asks_progress_check check (
  (stage is null or stage in ('names', 'payments', 'ordered', 'production', 'ready', 'distributed'))
  and (qty_total is null or qty_total >= 0) and (qty_paid is null or (qty_paid >= 0 and qty_paid <= coalesce(qty_total, qty_paid)))
  and (target is null or target >= 0));

create or replace function public.v2_class_progress(p_item text, p_stage text, p_total int, p_paid int, p_collected numeric, p_target numeric, p_eta date, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare rid uuid; v record; lbl text; stg text;
begin
  if public.v2_role() <> 'mayor' then raise exception 'Only the Class Mayor sends a progress report up'; end if;
  if p_item not in ('nameplate', 'siglakas') then raise exception 'Choose the Nameplate or the Siglakas shirt'; end if;
  if p_stage not in ('names', 'payments', 'ordered', 'production', 'ready', 'distributed') then raise exception 'Choose the stage'; end if;
  if coalesce(p_total, 0) < 0 or coalesce(p_paid, 0) < 0 then raise exception 'Counts cannot be negative'; end if;
  if p_total is not null and p_paid is not null and p_paid > p_total then raise exception 'Paid cannot be more than the total'; end if;
  lbl := case p_item when 'nameplate' then 'Nameplate' else 'Siglakas shirt' end;
  stg := case p_stage when 'names' then 'collecting names and sizes' when 'payments' then 'collecting payments' when 'ordered' then 'order placed' when 'production' then 'in production' when 'ready' then 'ready for pickup' else 'distributed' end;
  insert into public.v2_class_asks(from_name, kind, title, details, amount, stage, qty_total, qty_paid, target, eta)
  values (public.v2__who(), p_item, lbl || ' progress: ' || stg, nullif(btrim(coalesce(p_note, '')), ''), p_collected, p_stage, p_total, p_paid, p_target, p_eta) returning id into rid;
  for v in select user_id from public.v2_profiles where role = 'vp_internal' loop
    perform public.v2__directive_push(v.user_id, lbl || ' progress from the Class Mayor', stg);
  end loop;
  return rid;
end $$;
revoke execute on function public.v2_class_progress(text, text, int, int, numeric, numeric, date, text) from public, anon;
grant execute on function public.v2_class_progress(text, text, int, int, numeric, numeric, date, text) to authenticated, service_role;

-- The VP Internal acknowledges a progress report or sends it back (with a reason); other requests are approved or declined as before
create or replace function public.v2_class_ask_decide(p_id uuid, p_approve boolean, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.v2_class_asks; n text := nullif(btrim(coalesce(p_note, '')), ''); prog boolean;
begin
  if public.v2_role() <> 'vp_internal' and not public.v2_is_president() then raise exception 'Only the VP Internal decides on this'; end if;
  select * into a from public.v2_class_asks where id = p_id for update;
  if a.id is null then raise exception 'Request not found'; end if;
  if a.status <> 'open' then raise exception 'Already decided'; end if;
  prog := a.kind in ('nameplate', 'siglakas');
  if not p_approve and n is null then raise exception 'Say why it is %', case when prog then 'sent back' else 'declined' end; end if;
  update public.v2_class_asks set status = case when p_approve then 'approved' else 'declined' end, decided_by_name = public.v2__who(), decision_note = left(n, 500), decided_at = now() where id = p_id;
  perform public.v2__directive_push(a.from_id,
    case when prog then case when p_approve then 'Progress report received' else 'Progress report sent back' end else case when p_approve then 'Request approved' else 'Request declined' end end,
    a.title || coalesce(' · ' || n, ''));
end $$;
revoke execute on function public.v2_class_ask_decide(uuid, boolean, text) from public, anon;
grant execute on function public.v2_class_ask_decide(uuid, boolean, text) to authenticated, service_role;

-- 4. Setup page check
do $$ declare src text;
begin
  select pg_get_functiondef('public.v2_schema_marks()'::regprocedure) into src;
  if src not like '%''v61''%' then
    src := replace(src, '''v60'', not has_function_privilege(''anon'', ''public.v2_inspection_open(text)'', ''execute''));',
      '''v60'', not has_function_privilege(''anon'', ''public.v2_inspection_open(text)'', ''execute''), ''v61'', to_regprocedure(''public.v2_class_progress(text,text,int,int,numeric,numeric,date,text)'') is not null);');
    execute src;
  end if;
end $$;
