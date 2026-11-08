-- v58 · The SAILS General Marshal opens and closes inspection.
--  * Only the General Marshal can open or close. Opening needs a short note (what is being inspected).
--  * The SAILS President and the Class Mayor are notified on their phones at every open and every close.
--  * Class Marshals and SAILS Marshals can scan cards and inspect only while an inspection is open.
--  * Every inspection is kept as a record: who opened it, when, who closed it.
-- Requires v57. Safe to run twice.
create table if not exists public.v2_inspections (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'open' check (status in ('open', 'closed')),
  note text not null check (char_length(btrim(note)) between 3 and 200),
  opened_by uuid, opened_by_name text,
  opened_at timestamptz not null default now(),
  closed_by uuid, closed_by_name text, closed_at timestamptz
);
create unique index if not exists v2_inspections_one_open on public.v2_inspections ((true)) where status = 'open';
alter table public.v2_inspections enable row level security;
drop policy if exists insp_read on public.v2_inspections;
create policy insp_read on public.v2_inspections for select to authenticated
  using (coalesce(public.v2_role(), 'pending') <> 'pending' or public.v2_is_president());
revoke all on public.v2_inspections from anon;
grant select on public.v2_inspections to authenticated;

create or replace function public.v2__inspection_notify(p_title text, p_body text) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid;
begin
  for u in select user_id from public.v2_profiles where role in ('sails_president', 'mayor') loop
    perform public.v2__directive_push(u, p_title, p_body);
  end loop;
end $$;
revoke all on function public.v2__inspection_notify(text, text) from public, anon, authenticated;

create or replace function public.v2_inspection_open(p_note text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare rid uuid; me text := public.v2__who();
begin
  if public.v2_role() <> 'general_marshal' then raise exception 'Only the SAILS General Marshal opens inspection'; end if;
  if exists (select 1 from public.v2_inspections where status = 'open') then raise exception 'An inspection is already open'; end if;
  if length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Say what is being inspected'; end if;
  insert into public.v2_inspections(note, opened_by, opened_by_name) values (btrim(p_note), auth.uid(), me) returning id into rid;
  perform public.v2__inspection_notify('Inspection opened', me || ' opened inspection: ' || btrim(p_note));
  return rid;
end $$;
grant execute on function public.v2_inspection_open(text) to authenticated;

create or replace function public.v2_inspection_close() returns void
language plpgsql security definer set search_path = '' as $$
declare me text := public.v2__who(); n text;
begin
  if public.v2_role() <> 'general_marshal' then raise exception 'Only the SAILS General Marshal closes inspection'; end if;
  update public.v2_inspections set status = 'closed', closed_by = auth.uid(), closed_by_name = me, closed_at = now()
    where status = 'open' returning note into n;
  if not found then raise exception 'No inspection is open'; end if;
  perform public.v2__inspection_notify('Inspection closed', me || ' closed inspection: ' || n);
end $$;
grant execute on function public.v2_inspection_close() to authenticated;

-- QR scanning by Class Marshals and SAILS Marshals needs an open inspection
do $$
declare d text;
begin
  select pg_get_functiondef('public.v2_resolve_token(text)'::regprocedure) into d;
  if d not like '%Inspection is closed%' then
    d := replace(d, 'if m.id is null then raise exception ''Unknown student''; end if;',
      'if m.id is null then raise exception ''Unknown student''; end if;' || E'\n  ' ||
      'if public.v2_role() in (''marshall'', ''dept_marshal'') and not exists (select 1 from public.v2_inspections where status = ''open'') then raise exception ''Inspection is closed. The SAILS General Marshal opens it.''; end if;');
    if d not like '%Inspection is closed%' then raise exception 'v2_resolve_token was not in the expected shape'; end if;
    execute d;
  end if;
end $$;
