-- v74: Treasury, step 2. Budget against actual, cash must be deposited before a month closes, financial statements
-- (monthly or yearly, per section and for SAILS) and a yearly statement on each student's card.
-- Needs v73. Run once. Safe to run again.

-- 1. Budget against actual: each approved budget request, what was spent from it, and what is left
create or replace function public.v2_budget_vs_actual() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.v2_is_president() or public.v2_role() in ('vp_internal', 'vp_external', 'treasurer', 'auditor', 'mayor', 'class_treasurer')) then raise exception 'Not allowed'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'req_no', r.req_no, 'title', r.title, 'category', r.category, 'fund', r.fund, 'status', r.status,
      'approved', r.total, 'spent', coalesce(s.spent, 0), 'remaining', r.total - coalesce(s.spent, 0), 'activity_date', r.activity_date) order by r.created_at desc)
    from public.v2_budget_requests r
    left join lateral (select sum(e.amount) spent from public.v2_entries e where e.request_id = r.id and e.kind = 'expense' and e.status = 'approved' and public.v2__unit_ok(e.unit_id)) s on true
    where r.status in ('approved', 'filed')), '[]'::jsonb);
end $$;

-- 2. A month cannot close while cash collected since the batches began is not deposited
create or replace function public.v2_close_month(p_month text, p_unit uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.v2_month_close; nm text; pend int; u uuid; und int;
begin
  if not public.v2_has_role('mayor') then raise exception 'Only the Mayor can close a month'; end if;
  u := public.v2__act_unit(p_unit);
  select * into r from public.v2_month_close where month = p_month and unit_id = u;
  if r.month is null or r.status <> 'checked' then raise exception 'Someone must verify the month first'; end if;
  if r.checked_by = auth.uid() then raise exception 'A different officer (Treasurer, Auditor or Vice Mayor) must verify the count before you close it'; end if;
  select count(*) into pend from public.v2_entries where status = 'pending' and unit_id = u and to_char(occurred_at at time zone 'Asia/Manila', 'YYYY-MM') = p_month;
  if pend > 0 then raise exception '% entr% still waiting for approval in that month', pend, case when pend = 1 then 'y is' else 'ies are' end; end if;
  select count(*) into und from public.v2_entries e
    where e.unit_id = u and e.kind = 'collection' and e.status = 'approved' and e.method = 'cash' and not e.batch_exempt
      and to_char(e.occurred_at at time zone 'Asia/Manila', 'YYYY-MM') <= p_month
      and not exists (select 1 from public.v2_batches b where b.id = e.batch_id and b.status = 'deposited');
  if und > 0 then raise exception '% cash collection% not deposited yet. Each needs a batch verified by the SAILS Treasurer and countersigned by the SAILS VP Internal', und, case when und = 1 then ' is' else 's are' end; end if;
  if public.v2__balance_at(p_month, u) <> r.system_balance then raise exception 'The records changed after the count. Verify the month again'; end if;
  select full_name into nm from public.v2_profiles where user_id = auth.uid();
  update public.v2_month_close set status = 'closed', closed_by = auth.uid(), closed_by_name = nm, closed_at = now() where month = p_month and unit_id = u;
end $$;

do $do$ declare src text;
begin
  select pg_get_functiondef('public.v2_verify_month(text,numeric,text,uuid)'::regprocedure) into src;
  src := replace(src, 'Enter the money counted (cash plus GCash)', 'Enter the cash counted');
  execute src;
end $do$;

-- 3. Financial statement for a section (p_unit) or for all of SAILS (p_unit null), between two dates
create or replace function public.v2_statement(p_unit uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare glob boolean := public.v2_is_president() or public.v2_role() in ('vp_internal', 'vp_external', 'treasurer', 'auditor');
        op numeric; before numeric; nm text; res jsonb;
begin
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Choose the dates'; end if;
  if p_to - p_from > 400 then raise exception 'At most about a year at a time'; end if;
  if p_unit is null then
    if not glob then raise exception 'Only SAILS officers see the SAILS statement'; end if;
    nm := 'All sections (SAILS)';
  else
    if not (glob or (public.v2_role() in ('class_treasurer', 'mayor') and public.v2__unit_ok(p_unit))) then raise exception 'Not allowed'; end if;
    select name into nm from public.v2_units where id = p_unit;
  end if;
  select coalesce(sum(o), 0) into op from (select distinct on (unit_id) opening_balance o from public.v2_periods
      where p_unit is null or unit_id = p_unit order by unit_id, opened_at) q;
  select coalesce(sum(case when kind = 'collection' then amount else -amount end), 0) into before from public.v2_entries
    where status = 'approved' and (p_unit is null or unit_id = p_unit) and (occurred_at at time zone 'Asia/Manila')::date < p_from;
  res := jsonb_build_object('scope', nm, 'from', p_from, 'to', p_to, 'opening', op + before,
    'in', coalesce((select jsonb_agg(jsonb_build_object('category', category, 'amount', a, 'count', c) order by category) from
        (select category, sum(amount) a, count(*) c from public.v2_entries where kind = 'collection' and status = 'approved' and (p_unit is null or unit_id = p_unit)
           and (occurred_at at time zone 'Asia/Manila')::date between p_from and p_to group by category) x), '[]'::jsonb),
    'out', coalesce((select jsonb_agg(jsonb_build_object('category', category, 'amount', a, 'count', c) order by category) from
        (select category, sum(amount) a, count(*) c from public.v2_entries where kind = 'expense' and status = 'approved' and (p_unit is null or unit_id = p_unit)
           and (occurred_at at time zone 'Asia/Manila')::date between p_from and p_to group by category) x), '[]'::jsonb),
    'cash_not_deposited', coalesce((select sum(e.amount) from public.v2_entries e where e.kind = 'collection' and e.status = 'approved' and e.method = 'cash' and not e.batch_exempt
        and (p_unit is null or e.unit_id = p_unit) and (e.occurred_at at time zone 'Asia/Manila')::date <= p_to
        and not exists (select 1 from public.v2_batches b where b.id = e.batch_id and b.status = 'deposited')), 0),
    'batches', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from public.v2_batches
        where (p_unit is null or unit_id = p_unit) and (submitted_at at time zone 'Asia/Manila')::date between p_from and p_to group by status) y), '{}'::jsonb));
  return res;
end $$;

-- 4. A student's own yearly statement (by the card's token, like the current statement)
create or replace function public.v2_self_year(p_token text, p_year int) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare mid uuid; m public.v2_members;
begin
  mid := public.v2_member_from_token(p_token);
  select * into m from public.v2_members where id = mid;
  if p_year is null or p_year < 2020 or p_year > 2100 then raise exception 'Choose a year'; end if;
  return jsonb_build_object('name', m.full_name, 'student_no', m.student_no, 'year', p_year,
    'payments', (select coalesce(jsonb_agg(jsonb_build_object('at', e.occurred_at, 'for', coalesce(c.title, e.purpose, e.category), 'category', e.category,
          'amount', e.amount, 'receipt_no', case when e.confirmed_at is not null then e.receipt_no end) order by e.occurred_at), '[]'::jsonb)
        from public.v2_entries e left join public.v2_charges c on c.id = e.charge_id
        where e.member_id = mid and e.kind = 'collection' and e.status = 'approved' and extract(year from e.occurred_at at time zone 'Asia/Manila') = p_year),
    'by_category', (select coalesce(jsonb_object_agg(category, a), '{}'::jsonb) from (select e.category, sum(e.amount) a from public.v2_entries e
        where e.member_id = mid and e.kind = 'collection' and e.status = 'approved' and extract(year from e.occurred_at at time zone 'Asia/Manila') = p_year group by e.category) z));
end $$;

revoke execute on function public.v2_budget_vs_actual(), public.v2_statement(uuid, date, date) from public, anon;
grant execute on function public.v2_budget_vs_actual(), public.v2_statement(uuid, date, date) to authenticated, service_role;
revoke execute on function public.v2_self_year(text, int) from public;
grant execute on function public.v2_self_year(text, int) to anon, authenticated, service_role;

do $do$ declare src text;
begin
  select pg_get_functiondef('public.v2_schema_marks()'::regprocedure) into src;
  if src not like '%''v74''%' then
    src := replace(src, E'  return mk;', E'  mk := mk || jsonb_build_object(''v74'', to_regprocedure(''public.v2_statement(uuid,date,date)'') is not null);\n  return mk;');
    execute src;
  end if;
end $do$;
