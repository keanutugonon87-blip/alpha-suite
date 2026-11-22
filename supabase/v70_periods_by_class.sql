-- v70: SAILS Line of Authority, step 3b. Every class has its own open period and its own month close,
-- and the student page shows a student's own class only.
-- Run once in the Supabase SQL editor (after v69). Safe to run again.

-- 0. FIX for v69: the class tag auto-fill failed on records without a student or charge field (new charges, events, members, periods)
create or replace function public.v2__fill_unit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare u uuid := new.unit_id; mine uuid := public.v2__my_unit(); j jsonb := to_jsonb(new); mid uuid := nullif(j->>'member_id', '')::uuid; cid uuid := nullif(j->>'charge_id', '')::uuid;
begin
  if u is null and mid is not null then
    select m.unit_id into u from public.v2_members m where m.id = mid;
  end if;
  if u is null and cid is not null then
    select c.unit_id into u from public.v2_charges c where c.id = cid;
  end if;
  new.unit_id := coalesce(u, mine, public.v2__alpha_unit());
  return new;
end $$;


-- 1. One open period per class, one close record per class and month
drop index if exists public.v2_one_open_period;
create unique index if not exists v2_one_open_period_per_class on public.v2_periods(unit_id) where status = 'open';

do $do$
begin
  if not exists (select 1 from pg_index i where i.indrelid = 'public.v2_month_close'::regclass and i.indisprimary
                 and (select count(*) from unnest(i.indkey)) = 2) then
    alter table public.v2_month_close drop constraint v2_month_close_pkey;
    alter table public.v2_month_close add constraint v2_month_close_pkey primary key (unit_id, month);
  end if;
end $do$;

-- every section starts with an open period of its own (the 1-Alpha one already exists)
insert into public.v2_periods(name, opening_balance, unit_id)
select 'First period', 0, u.id from public.v2_units u
where u.kind = 'section' and not exists (select 1 from public.v2_periods p where p.unit_id = u.id);

-- 2. Which class an officer is acting for
create or replace function public.v2__act_unit(p_unit uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare u uuid := coalesce(p_unit, public.v2__my_unit());
begin
  if u is null then raise exception 'Choose a class first'; end if;
  if not public.v2__unit_ok(u) then raise exception 'Not allowed'; end if;
  return u;
end $$;

drop function if exists public.v2__balance_at(text);
create or replace function public.v2__balance_at(p_month text, p_unit uuid default null) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce((select opening_balance from public.v2_periods where unit_id = coalesce(p_unit, public.v2__my_unit()) order by opened_at limit 1), 0)
       + coalesce((select sum(case when kind = 'collection' then amount else -amount end) from public.v2_entries
                   where unit_id = coalesce(p_unit, public.v2__my_unit()) and status = 'approved'
                     and to_char(occurred_at at time zone 'Asia/Manila', 'YYYY-MM') <= p_month), 0)
$$;

-- 3. Closing a period, and the month count / close / reopen, for one class
drop function if exists public.v2_close_period(text);
create or replace function public.v2_close_period(p_next_name text, p_unit uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare cur public.v2_periods; coll numeric; exp numeric; closing numeric; nid uuid; who text; u uuid;
begin
  if not public.v2_has_role('mayor') then raise exception 'Only the Mayor can close a period'; end if;
  u := public.v2__act_unit(p_unit);
  select * into cur from public.v2_periods where status = 'open' and unit_id = u for update;
  if cur.id is null then raise exception 'No open period'; end if;
  select coalesce(sum(amount) filter (where kind = 'collection'), 0), coalesce(sum(amount) filter (where kind = 'expense'), 0)
    into coll, exp from public.v2_entries where period_id = cur.id and status = 'approved';
  closing := cur.opening_balance + coll - exp;
  select full_name into who from public.v2_profiles where user_id = auth.uid();
  update public.v2_periods set status = 'closed', closed_at = now(), closed_by_name = who,
    collections_total = coll, expenses_total = exp, closing_balance = closing where id = cur.id;
  insert into public.v2_periods(name, opening_balance, unit_id) values (p_next_name, closing, u) returning id into nid;
  update public.v2_entries set period_id = nid where period_id = cur.id and status = 'pending';   -- pending carries forward
  return nid;
end $$;

drop function if exists public.v2_verify_month(text, numeric, text);
create or replace function public.v2_verify_month(p_month text, p_cash numeric, p_note text, p_unit uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare sys numeric; d numeric; nm text; u uuid; cur text := to_char(now() at time zone 'Asia/Manila', 'YYYY-MM');
begin
  if not public.v2_has_role('auditor', 'vice_mayor', 'treasurer', 'mayor') then raise exception 'Only the Auditor, Vice Mayor, Treasurer or Mayor can verify a month'; end if;
  u := public.v2__act_unit(p_unit);
  if p_month !~ '^\d{4}-\d{2}$' or p_month > cur then raise exception 'Pick a month that has started'; end if;
  if p_cash is null or p_cash < 0 then raise exception 'Enter the money counted (cash plus GCash)'; end if;
  if exists (select 1 from public.v2_month_close where month = p_month and unit_id = u and status = 'closed') then raise exception 'That month is already closed'; end if;
  sys := public.v2__balance_at(p_month, u);
  d := round(p_cash - sys, 2);
  if d <> 0 and btrim(coalesce(p_note, '')) = '' then raise exception 'The count is off by ₱% compared with the records. Add a note that explains the difference', d; end if;
  select full_name into nm from public.v2_profiles where user_id = auth.uid();
  insert into public.v2_month_close(unit_id, month, status, system_balance, cash_counted, diff, note, checked_by, checked_by_name, checked_at)
  values (u, p_month, 'checked', sys, p_cash, d, nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), nm, now())
  on conflict (unit_id, month) do update set status = 'checked', system_balance = excluded.system_balance, cash_counted = excluded.cash_counted,
    diff = excluded.diff, note = excluded.note, checked_by = excluded.checked_by, checked_by_name = excluded.checked_by_name,
    checked_at = now(), closed_by = null, closed_by_name = null, closed_at = null;
  return jsonb_build_object('system_balance', sys, 'diff', d);
end $$;

drop function if exists public.v2_close_month(text);
create or replace function public.v2_close_month(p_month text, p_unit uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.v2_month_close; nm text; pend int; u uuid;
begin
  if not public.v2_has_role('mayor') then raise exception 'Only the Mayor can close a month'; end if;
  u := public.v2__act_unit(p_unit);
  select * into r from public.v2_month_close where month = p_month and unit_id = u;
  if r.month is null or r.status <> 'checked' then raise exception 'Someone must verify the month first'; end if;
  if r.checked_by = auth.uid() then raise exception 'A different officer (Treasurer, Auditor or Vice Mayor) must verify the count before you close it'; end if;
  select count(*) into pend from public.v2_entries where status = 'pending' and unit_id = u and to_char(occurred_at at time zone 'Asia/Manila', 'YYYY-MM') = p_month;
  if pend > 0 then raise exception '% entr% still waiting for approval in that month', pend, case when pend = 1 then 'y is' else 'ies are' end; end if;
  if public.v2__balance_at(p_month, u) <> r.system_balance then raise exception 'The records changed after the count. Verify the month again'; end if;
  select full_name into nm from public.v2_profiles where user_id = auth.uid();
  update public.v2_month_close set status = 'closed', closed_by = auth.uid(), closed_by_name = nm, closed_at = now() where month = p_month and unit_id = u;
end $$;

drop function if exists public.v2_reopen_month(text, text);
create or replace function public.v2_reopen_month(p_month text, p_reason text, p_unit uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid;
begin
  if not public.v2_has_role('mayor') then raise exception 'Only the Mayor can reopen a month'; end if;
  u := public.v2__act_unit(p_unit);
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Give a reason for reopening'; end if;
  update public.v2_month_close set status = 'reopened', reopen_reason = btrim(p_reason) where month = p_month and unit_id = u and status = 'closed';
  if not found then raise exception 'That month is not closed'; end if;
end $$;

-- 4. An entry can only join its own class's period, and only its own class's closed months lock it
do $do$
declare src text; old text;
begin
  src := pg_get_functiondef('public.v2_entries_before()'::regprocedure); old := src;
  src := replace(src, 'where id = new.period_id and status = ''open''', 'where id = new.period_id and status = ''open'' and unit_id = new.unit_id');
  src := replace(src, 'where month = mn and status = ''closed''', 'where month = mn and status = ''closed'' and unit_id = new.unit_id');
  src := replace(src, 'where month = mo and status = ''closed''', 'where month = mo and status = ''closed'' and unit_id = new.unit_id');
  if src <> old then execute src; end if;
end $do$;

-- 5. SAILS-level funds overview: all open periods together
create or replace function public.v2_funds_overview() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare ids uuid[]; op numeric;
begin
  if not (public.v2_is_president() or public.v2_role() in ('vp_internal', 'vp_external')) then raise exception 'Not allowed'; end if;
  select coalesce(array_agg(id), '{}'), coalesce(sum(opening_balance), 0) into ids, op from public.v2_periods where status = 'open';
  return jsonb_build_object(
    'opening', op,
    'collected', coalesce((select sum(amount) from public.v2_entries where period_id = any(ids) and kind = 'collection' and status = 'approved'), 0),
    'spent', coalesce((select sum(amount) from public.v2_entries where period_id = any(ids) and kind = 'expense' and status = 'approved'), 0),
    'pending', (select count(*) from public.v2_entries where period_id = any(ids) and status = 'pending'),
    'voided_30d', (select count(*) from public.v2_entries where status = 'voided' and occurred_at > now() - interval '30 days'),
    'largest', (select jsonb_build_object('amount', e.amount, 'purpose', e.purpose) from public.v2_entries e where e.period_id = any(ids) and e.kind = 'expense' and e.status = 'approved' order by e.amount desc limit 1),
    'budget_waiting', (select count(*) from public.v2_budget_requests where status = 'submitted'),
    'liquidation_waiting', (select count(*) from public.v2_liquidations where status = 'submitted'));
end $$;

-- 6. The student page: a student sees his own class only (guests and staff without a class see 1-Alpha)
create or replace function public.v2__viewer_unit() returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce((select m.unit_id from public.v2_members m where m.id = public.v2__my_member()), public.v2__my_unit(), public.v2__alpha_unit())
$$;

create or replace function public.v2__orig_public_progress() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('charge', c.title, 'amount', c.amount, 'due_on', c.due_on,
    'total', (select count(*) from public.v2_members where status = 'active' and unit_id = public.v2__viewer_unit()),
    'paid', (select count(*) from public.v2_members m where m.status = 'active' and m.unit_id = public.v2__viewer_unit() and (
      exists (select 1 from public.v2_waivers w where w.charge_id = c.id and w.member_id = m.id)
      or coalesce((select sum(e.amount) from public.v2_entries e where e.member_id = m.id and e.charge_id = c.id and e.kind = 'collection' and e.status in ('approved', 'pending')), 0) >= c.amount)))
    order by c.created_at), '[]'::jsonb)
  from public.v2_charges c where not c.closed and c.unit_id = public.v2__viewer_unit()
$$;

create or replace function public.v2__orig_public_treasury() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'open', (select to_jsonb(p) - 'liquidation_notes' from public.v2_periods p where status = 'open' and unit_id = public.v2__viewer_unit()),
    'balance', (select p.opening_balance + coalesce(sum(e.amount) filter (where e.kind = 'collection'), 0) - coalesce(sum(e.amount) filter (where e.kind = 'expense'), 0)
                from public.v2_periods p left join public.v2_entries e on e.period_id = p.id and e.status = 'approved'
                where p.status = 'open' and p.unit_id = public.v2__viewer_unit() group by p.opening_balance),
    'past', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'closed_at', closed_at, 'opening_balance', opening_balance,
              'collections_total', collections_total, 'expenses_total', expenses_total, 'closing_balance', closing_balance) order by closed_at desc), '[]'::jsonb)
             from public.v2_periods where status = 'closed' and unit_id = public.v2__viewer_unit()),
    'funds', (select coalesce(jsonb_agg(jsonb_build_object('fund', f, 'collected', c, 'spent', s)), '[]'::jsonb)
              from (select coalesce(fund, 'none') f, coalesce(sum(amount) filter (where kind = 'collection'), 0) c, coalesce(sum(amount) filter (where kind = 'expense'), 0) s
                    from public.v2_entries where status = 'approved' and unit_id = public.v2__viewer_unit() group by 1) q),
    'entries', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'period_id', e.period_id, 'kind', e.kind, 'category', e.category, 'fund', e.fund,
                'payer', coalesce(m.full_name, e.payer_name), 'amount', e.amount, 'purpose', e.purpose, 'at', e.occurred_at, 'has_receipt', e.receipt_image is not null)
                order by e.occurred_at desc), '[]'::jsonb)
                from public.v2_entries e left join public.v2_members m on m.id = e.member_id where e.status = 'approved' and e.unit_id = public.v2__viewer_unit()))
$$;

-- the student's own statement already follows his own records; keep it to his own class's open charges
do $do$
declare src text; old text; f text;
begin
  for f in select unnest(array['public.v2_self_check(text)', 'public.v2_self_statement(text)']) loop
    src := pg_get_functiondef(f::regprocedure); old := src;
    src := replace(src, 'from public.v2_charges c left join public.v2_waivers w on w.charge_id = c.id and w.member_id = m.id', 'from public.v2_charges c left join public.v2_waivers w on w.charge_id = c.id and w.member_id = m.id');
    src := replace(src, 'where not c.closed)', 'where not c.closed and c.unit_id = m.unit_id)');
    if src <> old then execute src; end if;
  end loop;
end $do$;

-- 7. Setup page check
do $do$ declare src text;
begin
  select pg_get_functiondef('public.v2_schema_marks()'::regprocedure) into src;
  if src not like '%''v70''%' then
    src := replace(src, E'  return mk;', E'  mk := mk || jsonb_build_object(''v70'', exists (select 1 from pg_indexes where indexname = ''v2_one_open_period_per_class''));\n  return mk;');
    execute src;
  end if;
end $do$;
