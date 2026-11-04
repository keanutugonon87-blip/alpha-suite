-- v37 · Phase 1 of the department blueprint: units (the SAILS council + class sections), seat types and seat holders.
-- ADDITIVE ONLY. Nothing here changes what any officer or student can see or do today.
-- BSMT 1-Alpha becomes the first section; every current student is tagged with it.
-- Safe to run twice.

create table if not exists public.v2_units (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('department','section')),
  name text not null,                                   -- 'SAILS' or '1-Alpha'
  year_level int check (year_level between 1 and 6),
  section_name text,                                    -- Alpha, Bravo, Charlie, Delta
  parent_id uuid references public.v2_units(id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check ((kind = 'department' and year_level is null) or (kind = 'section' and year_level is not null and section_name is not null))
);
create unique index if not exists v2_units_one_department on public.v2_units(kind) where kind = 'department';
create unique index if not exists v2_units_section_uq on public.v2_units(year_level, lower(section_name)) where kind = 'section';

-- What seats each kind of council has, and which app role each seat maps to today.
create table if not exists public.v2_seat_types (
  unit_kind text not null check (unit_kind in ('department','section')),
  seat text not null,
  label text not null,
  seats int not null check (seats > 0),
  app_role text not null,
  sort int not null default 0,
  primary key (unit_kind, seat)
);
insert into public.v2_seat_types(unit_kind, seat, label, seats, app_role, sort) values
  ('department','president','SAILS President',1,'mayor',1),
  ('department','vp_internal','VP Internal',1,'vp_internal',2),
  ('department','vp_external','VP External',1,'vp_external',3),
  ('department','secretary','Secretary',1,'secretary',4),
  ('department','treasurer','Treasurer',1,'treasurer',5),
  ('department','auditor','Auditor',1,'auditor',6),
  ('department','pio','PIO',2,'pio',7),
  ('department','general_marshal','General Marshal',1,'marshall',8),
  ('department','marshal','Marshal',4,'marshall',9),
  ('section','mayor','Mayor (President)',1,'mayor',1),
  ('section','vice_mayor','Vice Mayor',1,'vice_mayor',2),
  ('section','secretary','Secretary',1,'secretary',3),
  ('section','treasurer','Treasurer',1,'treasurer',4),
  ('section','pio','PIO',2,'pio',5),
  ('section','marshal','Marshal',2,'marshall',6)
on conflict (unit_kind, seat) do update set label = excluded.label, seats = excluded.seats, app_role = excluded.app_role, sort = excluded.sort;

-- Who holds which seat, for which term.
create table if not exists public.v2_seat_holders (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.v2_units(id) on delete cascade,
  seat text not null,
  slot int not null default 1 check (slot >= 1),
  user_id uuid,                                         -- the officer's account (v2_profiles.user_id); empty = vacant
  holder_name text,
  status text not null default 'active' check (status in ('active','acting','vacant','ended')),
  term_start date,
  term_end date,
  created_at timestamptz not null default now()
);
create unique index if not exists v2_seat_holders_live on public.v2_seat_holders(unit_id, seat, slot) where status in ('active','acting','vacant');
create index if not exists v2_seat_holders_user on public.v2_seat_holders(user_id) where status in ('active','acting');

-- Every student belongs to a section.
alter table public.v2_members add column if not exists unit_id uuid references public.v2_units(id);
create index if not exists v2_members_unit on public.v2_members(unit_id);

alter table public.v2_units enable row level security;
alter table public.v2_seat_types enable row level security;
alter table public.v2_seat_holders enable row level security;
drop policy if exists units_read on public.v2_units;
create policy units_read on public.v2_units for select to authenticated using (public.v2_is_staff());
drop policy if exists seat_types_read on public.v2_seat_types;
create policy seat_types_read on public.v2_seat_types for select to authenticated using (public.v2_is_staff());
drop policy if exists seat_holders_read on public.v2_seat_holders;
create policy seat_holders_read on public.v2_seat_holders for select to authenticated using (public.v2_is_staff());
revoke all on public.v2_units, public.v2_seat_types, public.v2_seat_holders from anon;
grant select on public.v2_units, public.v2_seat_types, public.v2_seat_holders to authenticated;

-- First units: the SAILS council and BSMT 1-Alpha.
insert into public.v2_units(kind, name)
select 'department', 'SAILS' where not exists (select 1 from public.v2_units where kind = 'department');
insert into public.v2_units(kind, name, year_level, section_name, parent_id)
select 'section', '1-Alpha', 1, 'Alpha', (select id from public.v2_units where kind = 'department')
where not exists (select 1 from public.v2_units where kind = 'section' and year_level = 1 and lower(section_name) = 'alpha');

-- Tag every current student with 1-Alpha.
update public.v2_members set unit_id = (select id from public.v2_units where kind = 'section' and year_level = 1 and lower(section_name) = 'alpha') where unit_id is null;

-- Seat today's officers. VP accounts go to the SAILS council; the Auditor belongs to SAILS (classes have none);
-- other roles stay with 1-Alpha. Roles with no seat (for example the old 'sails' role) are left out and listed by the function below.
insert into public.v2_seat_holders(unit_id, seat, slot, user_id, holder_name, status, term_start)
select u.id, m.seat, 1, p.user_id, p.full_name, 'active', current_date
from public.v2_profiles p
join (values ('vp_internal','department','vp_internal'), ('vp_external','department','vp_external'), ('auditor','department','auditor'),
             ('mayor','section','mayor'), ('vice_mayor','section','vice_mayor'), ('secretary','section','secretary'), ('treasurer','section','treasurer')) as m(role, kind, seat) on m.role = p.role
join public.v2_units u on (m.kind = 'department' and u.kind = 'department') or (m.kind = 'section' and u.kind = 'section' and u.year_level = 1 and lower(u.section_name) = 'alpha')
where not exists (select 1 from public.v2_seat_holders h where h.user_id = p.user_id and h.unit_id = u.id and h.seat = m.seat and h.status in ('active','acting'))
on conflict do nothing;
-- PIOs and Marshals: first free slot
insert into public.v2_seat_holders(unit_id, seat, slot, user_id, holder_name, status, term_start)
select u.id, case p.role when 'pio' then 'pio' else 'marshal' end,
       row_number() over (partition by p.role order by p.full_name), p.user_id, p.full_name, 'active', current_date
from public.v2_profiles p
join public.v2_units u on u.kind = 'section' and u.year_level = 1 and lower(u.section_name) = 'alpha'
where p.role in ('pio','marshall')
  and not exists (select 1 from public.v2_seat_holders h where h.user_id = p.user_id and h.unit_id = u.id and h.status in ('active','acting'))
on conflict do nothing;

-- Mayor adds a section (for example year 1, 'Bravo').
create or replace function public.v2_unit_add_section(p_year int, p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare rid uuid; nm text := initcap(btrim(coalesce(p_name, '')));
begin
  if not public.v2_has_role('mayor') then raise exception 'Only the Mayor can add a section'; end if;
  if nm = '' or p_year is null or p_year < 1 or p_year > 6 then raise exception 'Give a year level (1 to 6) and a section name'; end if;
  if exists (select 1 from public.v2_units where kind = 'section' and year_level = p_year and lower(section_name) = lower(nm)) then raise exception 'That section already exists'; end if;
  insert into public.v2_units(kind, name, year_level, section_name, parent_id)
  values ('section', p_year || '-' || nm, p_year, nm, (select id from public.v2_units where kind = 'department')) returning id into rid;
  return rid;
end $$;
grant execute on function public.v2_unit_add_section(int, text) to authenticated;

-- Overview: every unit with seats filled and student count (for the Structure screen later).
create or replace function public.v2_org_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.v2_is_staff() then raise exception 'Not allowed'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', u.id, 'kind', u.kind, 'name', u.name, 'year_level', u.year_level,
      'seats_total', (select coalesce(sum(t.seats), 0) from public.v2_seat_types t where t.unit_kind = u.kind),
      'seats_filled', (select count(*) from public.v2_seat_holders h where h.unit_id = u.id and h.status in ('active','acting') and h.user_id is not null),
      'students', (select count(*) from public.v2_members m where m.unit_id = u.id and m.status = 'active'))
    order by u.kind, u.year_level nulls first, u.section_name) from public.v2_units u where u.active), '[]'::jsonb);
end $$;
grant execute on function public.v2_org_overview() to authenticated;
