-- v55 · The Class Mayor Desk only receives.
--  * He can read the council meeting agenda and minutes, and mark things received.
--  * He can no longer write minutes, resolutions or letters. Those belong to the SAILS Secretary.
--  * The SAILS Secretary, the VP Internal and the President can see who has received what.
-- Requires v50. Safe to run twice.

-- 1 · the Class Mayor reads council meetings (agenda and minutes)
drop policy if exists v2_council_meetings_mayor_read on public.v2_council_meetings;
create policy v2_council_meetings_mayor_read on public.v2_council_meetings for select to authenticated
  using (public.v2_role() = 'mayor');

-- 2 · received marks
create table if not exists public.v2_desk_receipts (
  user_id uuid not null default auth.uid(),
  src text not null check (src in ('agenda', 'minutes', 'record')),
  src_id uuid not null,
  user_name text,
  seen_at timestamptz not null default now(),
  primary key (user_id, src, src_id)
);
alter table public.v2_desk_receipts enable row level security;
drop policy if exists receipts_read on public.v2_desk_receipts;
create policy receipts_read on public.v2_desk_receipts for select to authenticated
  using (user_id = (select auth.uid()) or public.v2_is_president() or public.v2_role() in ('secretary', 'vp_internal'));
drop policy if exists receipts_add on public.v2_desk_receipts;
create policy receipts_add on public.v2_desk_receipts for insert to authenticated
  with check (user_id = (select auth.uid()) and public.v2_role() = 'mayor');
revoke all on public.v2_desk_receipts from anon;
grant select, insert on public.v2_desk_receipts to authenticated;

create or replace function public.v2__receipt_name() returns trigger
language plpgsql security definer set search_path = '' as $$
begin new.user_name := public.v2__who(); return new; end $$;
drop trigger if exists v2_receipt_name on public.v2_desk_receipts;
create trigger v2_receipt_name before insert on public.v2_desk_receipts for each row execute function public.v2__receipt_name();

-- 3 · minutes, resolutions and letters are written by the SAILS Secretary only
create or replace function public.v2_office_can(p_kind text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(case
    when p_kind in ('minutes', 'resolution', 'letter_in', 'letter_out') then public.v2_role() = 'secretary'
    when p_kind = 'finding' then public.v2_role() = 'auditor'
    when p_kind = 'post' then public.v2_role() in ('mayor', 'pio')
    when p_kind in ('plan', 'incident') then public.v2_role() in ('mayor', 'marshall')
    else false end, false)
$$;
