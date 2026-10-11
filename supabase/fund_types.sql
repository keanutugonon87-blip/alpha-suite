-- Fund types: Class Initiatives, SAILS Initiatives, Campus Wide Initiatives.
-- Run once in the Supabase SQL editor (project gxwgkbplscsduscoeoph). Existing records stay untagged (Unassigned).
alter table public.v2_charges add column if not exists fund text check (fund in ('class','sails','campus'));
alter table public.v2_entries add column if not exists fund text check (fund in ('class','sails','campus'));

-- a collection takes its fund from its charge unless one is set on the entry itself
create or replace function public.v2_entry_fund() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.charge_id is not null then
    select c.fund into new.fund from public.v2_charges c where c.id = new.charge_id;
  end if;
  return new;
end $$;
drop trigger if exists v2_entry_fund_t on public.v2_entries;
create trigger v2_entry_fund_t before insert or update of charge_id on public.v2_entries
  for each row execute function public.v2_entry_fund();

-- retagging a charge retags all of its collections
create or replace function public.v2_charge_fund_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.fund is distinct from old.fund then
    update public.v2_entries set fund = new.fund where charge_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists v2_charge_fund_sync_t on public.v2_charges;
create trigger v2_charge_fund_sync_t after update of fund on public.v2_charges
  for each row execute function public.v2_charge_fund_sync();

create or replace function public.v2_public_treasury() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'open', (select to_jsonb(p) - 'liquidation_notes' from public.v2_periods p where status='open'),
    'balance', (select p.opening_balance
        + coalesce(sum(e.amount) filter (where e.kind='collection'),0)
        - coalesce(sum(e.amount) filter (where e.kind='expense'),0)
      from public.v2_periods p left join public.v2_entries e on e.period_id=p.id and e.status='approved'
      where p.status='open' group by p.opening_balance),
    'past', (select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'closed_at',closed_at,
        'opening_balance',opening_balance,'collections_total',collections_total,'expenses_total',expenses_total,
        'closing_balance',closing_balance) order by closed_at desc),'[]'::jsonb) from public.v2_periods where status='closed'),
    'funds', (select coalesce(jsonb_agg(jsonb_build_object('fund',f,'collected',c,'spent',s)),'[]'::jsonb) from (
        select coalesce(fund,'none') f,
               coalesce(sum(amount) filter (where kind='collection'),0) c,
               coalesce(sum(amount) filter (where kind='expense'),0) s
        from public.v2_entries where status='approved' group by 1) q),
    'entries', (select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'period_id',e.period_id,'kind',e.kind,'category',e.category,'fund',e.fund,
        'payer',coalesce(m.full_name,e.payer_name),'amount',e.amount,'purpose',e.purpose,'at',e.occurred_at,'has_receipt',e.receipt_image is not null)
        order by e.occurred_at desc),'[]'::jsonb)
      from public.v2_entries e left join public.v2_members m on m.id=e.member_id where e.status='approved')
  )
$$;
grant execute on function public.v2_public_treasury() to anon, authenticated;
