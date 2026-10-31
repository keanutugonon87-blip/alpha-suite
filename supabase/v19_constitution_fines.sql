-- Alpha ’28 · v19 · Fines from the SAILS Constitution, excuse letters, tardy tracking and a Batch Project fund.
-- Safe to run more than once. Paste all of it into Supabase > SQL Editor > Run.
--
-- What this adds
--   • A fine (in pesos) on each standard. Where a standard has a fine, that fine applies every time, as the Constitution says.
--     A standard with no fine keeps the old rule: 1st offense a warning, then the usual fine.
--   • Standards from the Constitution that were missing: Flag Ceremony, Inspection, Event Log In / Log Out, Earrings / Inappropriate Clothes.
--   • Two attendance standards, Tardy and Absent. They carry no fine. Every 3 tardies count as 1 absence (PIT Handbook).
--   • Fines can be collected from the Watch screen: the payment is linked to the violation so it shows as paid.
--   • Excuse letters: an officer records the student's letter and proof on the violation, the Mayor or Vice Mayor accepts or rejects it.
--   • A fourth fund, Batch Project (3rd year batch project money).
-- Nothing here changes existing violations, payments or standards you wrote yourself, except that fines of ₱20 are set on Nails,
-- Haircut, Facial Hair and Hair Grooming (Girls) when they have no fine yet. Clear a fine in the Standards list to go back to the old rule.

-- 1. Standards: fine and attendance kind ------------------------------------------------------------
alter table public.v2_standards add column if not exists fine numeric check (fine is null or fine > 0);
alter table public.v2_standards add column if not exists kind text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'v2_standards_kind_check') then
    alter table public.v2_standards add constraint v2_standards_kind_check check (kind is null or kind in ('tardy', 'absent'));
  end if;
end $$;

update public.v2_standards set fine = 20 where fine is null and kind is null and title in ('Nails', 'Haircut', 'Facial Hair', 'Hair Grooming (Girls)');

insert into public.v2_standards (title, local_name, rule, sort_order, active, legacy_id, fine, kind)
select v.title, v.title, v.rule, v.so, true, v.lid, v.fine, v.kind
from (values
  ('Flag Ceremony', 'Attend the Monday flag ceremony required by the COMEd Dean and the organization. Fine ₱50 if absent.', 100, 'const_flag', 50::numeric, null::text),
  ('Inspection', 'Attend the inspection. Fine ₱50 if absent.', 101, 'const_inspection', 50, null),
  ('Event Log In / Log Out', 'Log in and log out for the whole event. Fine ₱50.', 102, 'const_logs', 50, null),
  ('Earrings / Inappropriate Clothes', 'No earrings for men and no inappropriate clothes. Special violation, fine ₱50.', 103, 'const_special', 50, null),
  ('Tardy', 'Late for class by more than 15 minutes (or 30, if the class says so). Every 3 tardies count as 1 absence.', 110, 'const_tardy', null, 'tardy'),
  ('Absent', 'Absent from a class meeting without an accepted excuse. Over 20% absences, a student is dropped from the subject.', 111, 'const_absent', null, 'absent')
) as v(title, rule, so, lid, fine, kind)
where not exists (select 1 from public.v2_standards s where lower(s.title) = lower(v.title));

-- 2. Fine payments link to the violation they settle -----------------------------------------------------------------
alter table public.v2_entries add column if not exists violation_id uuid references public.v2_violations(id) on delete set null;
create index if not exists v2_entries_violation_idx on public.v2_entries(violation_id) where violation_id is not null;

-- 3. Excuse letters on a violation --------------------------------------------------------------------------------------
alter table public.v2_violations add column if not exists excuse_note text check (excuse_note is null or char_length(excuse_note) <= 500);
alter table public.v2_violations add column if not exists excuse_image text;
alter table public.v2_violations add column if not exists excuse_status text;
alter table public.v2_violations add column if not exists excuse_by text;
alter table public.v2_violations add column if not exists excuse_decided_by text;
alter table public.v2_violations add column if not exists excuse_decided_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'v2_violations_excuse_status_check') then
    alter table public.v2_violations add constraint v2_violations_excuse_status_check check (excuse_status is null or excuse_status in ('pending', 'accepted', 'rejected'));
  end if;
end $$;

-- Only the Mayor or Vice Mayor may accept or reject an excuse
create or replace function public.v2_excuse_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.excuse_status is distinct from old.excuse_status and new.excuse_status in ('accepted', 'rejected')
     and not public.v2_has_role('mayor', 'vice_mayor') then
    raise exception 'Only the Mayor or Vice Mayor can accept or reject an excuse';
  end if;
  if new.excuse_status = 'accepted' and old.excuse_status is distinct from 'accepted' then new.excuse_decided_at := now(); end if;
  return new;
end $$;
drop trigger if exists v2_excuse_guard on public.v2_violations;
create trigger v2_excuse_guard before update on public.v2_violations for each row execute function public.v2_excuse_guard();

-- 4. Batch Project fund -------------------------------------------------------------------------------------------------
alter table public.v2_charges drop constraint if exists v2_charges_fund_check;
alter table public.v2_charges add constraint v2_charges_fund_check check (fund is null or fund in ('class', 'sails', 'campus', 'batch'));
alter table public.v2_entries drop constraint if exists v2_entries_fund_check;
alter table public.v2_entries add constraint v2_entries_fund_check check (fund is null or fund in ('class', 'sails', 'campus', 'batch'));

-- 5. What students and visitors see: the fine and the right offense number ---------------------------------------------
-- Offenses are numbered only across standards without a fine of their own, and attendance records are not offenses.
create or replace function public.v2__orig_public_violations() returns jsonb
language sql stable security definer set search_path = '' as $$
  with cfg as (select coalesce((select value from public.v2_settings where key = 'public_names'), 'full') mode)
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id,
      'name', case when (select mode from cfg) = 'initials' then (select string_agg(left(w, 1) || '.', ' ') from unnest(string_to_array(regexp_replace(x.full_name, '[,.]', ' ', 'g'), ' ')) w where w <> '') else x.full_name end,
      'standard', x.title, 'date', x.occurred_on, 'status', x.status, 'offense', x.num, 'fine', x.fine, 'kind', x.kind, 'excused', x.excused)
      order by x.occurred_on desc, x.created_at desc), '[]'::jsonb)
  from (select v.id, m.full_name, coalesce(s.title, 'Violation') title, v.occurred_on, v.status, v.created_at, s.fine, s.kind, (v.excuse_status = 'accepted') excused,
           count(*) filter (where s.fine is null and s.kind is null) over (partition by v.member_id order by v.occurred_on, v.created_at) num
        from public.v2_violations v join public.v2_members m on m.id = v.member_id
        left join public.v2_standards s on s.id = v.standard_id
        where v.status not in ('awaiting_approval', 'rejected')) x $$;

create or replace function public.v2_self_check(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare mid uuid; m public.v2_members;
begin
  mid := public.v2_member_from_token(p_token);
  select * into m from public.v2_members where id = mid;
  return jsonb_build_object('name', m.full_name,
    'balances', (select coalesce(jsonb_agg(jsonb_build_object('charge', c.title,
          'due', case when w.id is null then c.amount else 0 end, 'paid', coalesce(p.paid, 0),
          'owed', case when w.id is null then greatest(c.amount - coalesce(p.paid, 0), 0) else 0 end,
          'waived', w.id is not null) order by c.created_at), '[]'::jsonb)
       from public.v2_charges c
       left join public.v2_waivers w on w.charge_id = c.id and w.member_id = m.id
       left join (select charge_id, sum(amount) paid from public.v2_entries where member_id = m.id and kind = 'collection'
                  and status in ('approved', 'pending') and charge_id is not null group by 1) p on p.charge_id = c.id
       where not c.closed),
    'violations', (select coalesce(jsonb_agg(jsonb_build_object('standard', q.title, 'date', q.occurred_on, 'status', q.status, 'offense', q.num, 'fine', q.fine, 'kind', q.kind, 'excused', q.excused) order by q.occurred_on desc), '[]'::jsonb)
       from (select coalesce(s.title, 'Violation') title, v.occurred_on, v.status, v.created_at, s.fine, s.kind, (v.excuse_status = 'accepted') excused,
               count(*) filter (where s.fine is null and s.kind is null) over (order by v.occurred_on, v.created_at) num
             from public.v2_violations v left join public.v2_standards s on s.id = v.standard_id
             where v.member_id = m.id and v.status not in ('awaiting_approval', 'rejected')) q));
end $$;
grant execute on function public.v2_self_check(text) to anon, authenticated;
