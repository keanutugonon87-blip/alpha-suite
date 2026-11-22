-- v71: The SAILS VP Internal sends the procurement updates (Siglakas shirt, Nameplate, and any other item
-- bought from a SAILS contribution). Class Mayors, the SAILS President, Treasurer, Secretary and VP External read them.
-- The Class Mayor's own Nameplate / Siglakas progress report is replaced by these updates.
-- Run once in the Supabase SQL editor. Safe to run again.

-- 1. The updates and their photos
create table if not exists public.v2_procurement (
  id uuid primary key default gen_random_uuid(),
  item text not null,
  title text not null,
  stage text not null check (stage in ('names', 'payments', 'ordered', 'production', 'ready', 'distributed')),
  qty_total int check (qty_total is null or qty_total >= 0),
  qty_paid int check (qty_paid is null or qty_paid >= 0),
  collected numeric(12, 2) check (collected is null or collected >= 0),
  target numeric(12, 2) check (target is null or target >= 0),
  eta date,
  note text,
  by_id uuid default auth.uid(),
  by_name text,
  created_at timestamptz not null default now(),
  check (qty_total is null or qty_paid is null or qty_paid <= qty_total)
);
create index if not exists v2_procurement_item_idx on public.v2_procurement(item, created_at desc);

create table if not exists public.v2_procurement_photos (
  id uuid primary key default gen_random_uuid(),
  update_id uuid not null references public.v2_procurement(id) on delete cascade,
  image text not null,
  caption text,
  by_id uuid default auth.uid(),
  by_name text,
  created_at timestamptz not null default now()
);
create index if not exists v2_procurement_photos_idx on public.v2_procurement_photos(update_id);

alter table public.v2_procurement enable row level security;
alter table public.v2_procurement_photos enable row level security;

drop policy if exists proc_read on public.v2_procurement;
create policy proc_read on public.v2_procurement for select to authenticated
  using (public.v2_is_president() or public.v2_role() in ('vp_internal', 'vp_external', 'secretary', 'treasurer', 'mayor'));
drop policy if exists procphotos_read on public.v2_procurement_photos;
create policy procphotos_read on public.v2_procurement_photos for select to authenticated
  using (public.v2_is_president() or public.v2_role() in ('vp_internal', 'vp_external', 'secretary', 'treasurer', 'mayor'));
drop policy if exists procphotos_ins on public.v2_procurement_photos;
create policy procphotos_ins on public.v2_procurement_photos for insert to authenticated
  with check (public.v2_role() = 'vp_internal');
drop policy if exists procphotos_del on public.v2_procurement_photos;
create policy procphotos_del on public.v2_procurement_photos for delete to authenticated
  using (public.v2_role() = 'vp_internal');

-- 2. Posting an update (VP Internal only) and taking one down
create or replace function public.v2_proc_post(p_item text, p_title text, p_stage text, p_total int, p_paid int, p_collected numeric, p_target numeric, p_eta date, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare rid uuid; v record; stg text; lbl text := btrim(coalesce(p_title, ''));
begin
  if public.v2_role() <> 'vp_internal' then raise exception 'Only the SAILS VP Internal sends procurement updates'; end if;
  if btrim(coalesce(p_item, '')) = '' or lbl = '' then raise exception 'Choose the item'; end if;
  if p_stage not in ('names', 'payments', 'ordered', 'production', 'ready', 'distributed') then raise exception 'Choose the stage'; end if;
  if coalesce(p_total, 0) < 0 or coalesce(p_paid, 0) < 0 then raise exception 'Counts cannot be negative'; end if;
  if p_total is not null and p_paid is not null and p_paid > p_total then raise exception 'Paid cannot be more than the total'; end if;
  stg := case p_stage when 'names' then 'collecting names and sizes' when 'payments' then 'collecting payments' when 'ordered' then 'order placed'
         when 'production' then 'in production' when 'ready' then 'ready for pickup' else 'distributed' end;
  insert into public.v2_procurement(item, title, stage, qty_total, qty_paid, collected, target, eta, note, by_name)
  values (btrim(p_item), left(lbl, 120), p_stage, p_total, p_paid, p_collected, p_target, p_eta, nullif(btrim(coalesce(p_note, '')), ''), public.v2__who())
  returning id into rid;
  for v in select user_id from public.v2_profiles where role in ('mayor', 'sails_president', 'treasurer', 'secretary', 'vp_external') loop
    perform public.v2__directive_push(v.user_id, lbl || ': ' || stg, 'Update from the SAILS VP Internal' || coalesce(' · expected ' || to_char(p_eta, 'Mon FMDD'), ''));
  end loop;
  return rid;
end $$;
revoke execute on function public.v2_proc_post(text, text, text, int, int, numeric, numeric, date, text) from public, anon;
grant execute on function public.v2_proc_post(text, text, text, int, int, numeric, numeric, date, text) to authenticated, service_role;

create or replace function public.v2_proc_delete(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.v2_role() <> 'vp_internal' and not public.v2_is_president() then raise exception 'Only the SAILS VP Internal takes an update down'; end if;
  delete from public.v2_procurement where id = p_id;
end $$;
revoke execute on function public.v2_proc_delete(uuid) from public, anon;
grant execute on function public.v2_proc_delete(uuid) to authenticated, service_role;

-- 3. Figures from the collection records of every section (the "Fill in from the records" button)
create or replace function public.v2_proc_figures(p_pattern text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  if not (public.v2_is_president() or public.v2_role() in ('vp_internal', 'vp_external', 'secretary', 'treasurer')) then raise exception 'Not allowed'; end if;
  select jsonb_build_object('found', count(*) > 0, 'charges', count(distinct cid), 'members', count(*), 'paid', count(*) filter (where a >= amt),
           'collected', coalesce(sum(a), 0), 'pending', coalesce(sum(pe), 0), 'target', coalesce(sum(amt), 0))
    into r
  from (
    select c.id cid, c.amount amt,
           coalesce((select sum(e.amount) from public.v2_entries e where e.charge_id = c.id and e.member_id = m.id and e.kind = 'collection' and e.status = 'approved'), 0) a,
           coalesce((select sum(e.amount) from public.v2_entries e where e.charge_id = c.id and e.member_id = m.id and e.kind = 'collection' and e.status = 'pending'), 0) pe
    from public.v2_charges c join public.v2_members m on m.unit_id = c.unit_id and m.status = 'active'
    where c.title ilike p_pattern
  ) q;
  return r;
end $$;
revoke execute on function public.v2_proc_figures(text) from public, anon;
grant execute on function public.v2_proc_figures(text) to authenticated, service_role;

-- 4. The Class Mayor no longer sends a progress report
create or replace function public.v2_class_progress(p_item text, p_stage text, p_total int, p_paid int, p_collected numeric, p_target numeric, p_eta date, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'The SAILS VP Internal now sends the procurement updates. Read them in the SAILS Report tab';
end $$;

-- 5. Live updates and the Setup page check
do $do$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'v2_procurement') then
    alter publication supabase_realtime add table public.v2_procurement;
  end if;
end $do$;

do $do$ declare src text;
begin
  select pg_get_functiondef('public.v2_schema_marks()'::regprocedure) into src;
  if src not like '%''v71''%' then
    src := replace(src, E'  return mk;', E'  mk := mk || jsonb_build_object(''v71'', to_regprocedure(''public.v2_proc_post(text,text,text,int,int,numeric,numeric,date,text)'') is not null);\n  return mk;');
    execute src;
  end if;
end $do$;
