-- Officer profiles: leadership credentials, optional birthday, officer-submitted edits reviewed by Mayor/Vice Mayor.
-- Run once in the Supabase SQL editor (project gxwgkbplscsduscoeoph).
alter table public.v2_officers
  add column if not exists user_id uuid references auth.users(id) on delete set null,
  add column if not exists bio text not null default '',
  add column if not exists term text not null default '',
  add column if not exists awards text not null default '',
  add column if not exists birth_month smallint check (birth_month between 1 and 12),
  add column if not exists birth_day smallint check (birth_day between 1 and 31),
  add column if not exists show_birthday boolean not null default false;

create table if not exists public.v2_officer_edits (
  id uuid primary key default gen_random_uuid(),
  officer_id uuid not null references public.v2_officers(id) on delete cascade,
  submitted_by uuid not null default auth.uid(),
  data jsonb not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  note text not null default '',
  created_at timestamptz not null default now(),
  reviewed_by uuid,
  reviewed_at timestamptz
);
alter table public.v2_officer_edits enable row level security;
drop policy if exists officer_edits_read on public.v2_officer_edits;
create policy officer_edits_read on public.v2_officer_edits for select
  using (submitted_by = auth.uid() or public.v2_has_role('mayor','vice_mayor'));

create or replace function public.v2_my_officer() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object(
      'officer', to_jsonb(o) - 'photo',
      'pending', (select to_jsonb(e) from public.v2_officer_edits e where e.officer_id = o.id and e.status = 'pending' order by e.created_at desc limit 1),
      'last_note', (select jsonb_build_object('status', e.status, 'note', e.note) from public.v2_officer_edits e where e.officer_id = o.id and e.status <> 'pending' order by e.reviewed_at desc nulls last limit 1))
    from public.v2_officers o where o.user_id = auth.uid() limit 1), 'null'::jsonb)
$$;

create or replace function public.v2_submit_officer_edit(p_data jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare o public.v2_officers; d jsonb; bm int; bd int; new_id uuid;
begin
  select * into o from public.v2_officers where user_id = auth.uid() limit 1;
  if o.id is null then raise exception 'Your account is not linked to an officer profile. Ask the Mayor to link it.'; end if;
  bm := nullif(p_data->>'birth_month','')::int; bd := nullif(p_data->>'birth_day','')::int;
  if (bm is null) <> (bd is null) then raise exception 'Enter both birthday month and day, or leave both empty.'; end if;
  if bm is not null then
    begin perform make_date(2024, bm, bd); exception when others then raise exception 'That birthday is not a valid date.'; end;
  end if;
  d := jsonb_build_object(
    'credentials', left(coalesce(p_data->>'credentials',''), 1200),
    'bio', left(coalesce(p_data->>'bio',''), 600),
    'term', left(coalesce(p_data->>'term',''), 80),
    'awards', left(coalesce(p_data->>'awards',''), 1200),
    'birth_month', bm, 'birth_day', bd,
    'show_birthday', coalesce((p_data->>'show_birthday')::boolean, false) and bm is not null);
  delete from public.v2_officer_edits where officer_id = o.id and status = 'pending';
  insert into public.v2_officer_edits(officer_id, submitted_by, data) values (o.id, auth.uid(), d) returning id into new_id;
  return new_id;
end $$;

create or replace function public.v2_review_officer_edit(p_id uuid, p_approve boolean, p_note text default '') returns void
language plpgsql security definer set search_path = '' as $$
declare e public.v2_officer_edits;
begin
  if not public.v2_has_role('mayor','vice_mayor') then raise exception 'Only the Mayor or Vice Mayor can review profile changes.'; end if;
  select * into e from public.v2_officer_edits where id = p_id and status = 'pending';
  if e.id is null then raise exception 'That change was already reviewed.'; end if;
  if p_approve then
    update public.v2_officers set
      credentials = e.data->>'credentials', bio = e.data->>'bio', term = e.data->>'term', awards = e.data->>'awards',
      birth_month = nullif(e.data->>'birth_month','')::smallint, birth_day = nullif(e.data->>'birth_day','')::smallint,
      show_birthday = coalesce((e.data->>'show_birthday')::boolean, false), updated_at = now()
    where id = e.officer_id;
  end if;
  update public.v2_officer_edits set status = case when p_approve then 'approved' else 'rejected' end,
    note = coalesce(p_note,''), reviewed_by = auth.uid(), reviewed_at = now() where id = p_id;
end $$;

create or replace function public.v2_public_officers() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('name',full_name,'position',position,'credentials',credentials,
    'photo',photo,'x',photo_pos_x,'y',photo_pos_y,'bio',bio,'term',term,'awards',awards,
    'bday', case when show_birthday and birth_month is not null then jsonb_build_object('m',birth_month,'d',birth_day) end
  ) order by sort_order), '[]'::jsonb) from public.v2_officers
$$;

revoke all on function public.v2_my_officer(), public.v2_submit_officer_edit(jsonb), public.v2_review_officer_edit(uuid,boolean,text) from public, anon;
grant execute on function public.v2_my_officer(), public.v2_submit_officer_edit(jsonb), public.v2_review_officer_edit(uuid,boolean,text) to authenticated;
grant execute on function public.v2_public_officers() to anon, authenticated;

do $$ begin
  alter publication supabase_realtime add table public.v2_officer_edits;
exception when others then null; end $$;
