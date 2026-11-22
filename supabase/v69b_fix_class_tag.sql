-- v69b: fix for v69. The class tag auto-fill failed on records that have no student or charge field
-- (new charges, events, members, periods). Run once in the Supabase SQL editor. Safe to run again.

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
