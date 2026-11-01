-- Alpha ’28 · v29 · Office records for the Secretary, Auditor, PIO and Marshals (one dashboard each).
-- Safe to run more than once. Paste all of it into Supabase > SQL Editor > Run. Run v28 first.
--
--   Secretary (Second Mate): minutes, resolutions, letters received and sent. Each gets a reference number (MIN-2026-001, RES-2026-001, IN-…, OUT-…).
--                            A record can be marked confidential: only the Mayor, Secretary and Auditor can read it.
--   Auditor (Third Mate):    audit findings, with whether each was reported to the Executive Board, the adviser and the General Assembly.
--                            The Auditor can write findings but cannot approve or record any entry. That stays with the Mayor and Treasurer.
--   PIO (OICs):              posts and publications that go through a review (privacy, branding, communication rules) before they are published.
--   Marshals (Bosun):        an activity plan (logistics and safety checklist) for an event, and a safety log. Reports only, no disciplinary action.

create table if not exists public.v2_office_records (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('minutes', 'resolution', 'letter_in', 'letter_out', 'finding', 'post', 'plan', 'incident')),
  title text not null check (char_length(title) between 2 and 120),
  ref_no text check (ref_no is null or char_length(ref_no) <= 40),
  on_date date not null default ((now() at time zone 'Asia/Manila')::date),
  party text check (party is null or char_length(party) <= 100),
  body text check (body is null or char_length(body) <= 3000),
  status text not null check (status in ('draft', 'filed', 'adopted', 'implemented', 'open', 'replied', 'review', 'reported', 'resolved', 'approved', 'published', 'planned', 'done', 'cancelled')),
  level text check (level is null or level in ('low', 'medium', 'high')),
  flags jsonb not null default '{}'::jsonb,
  items jsonb not null default '[]'::jsonb,
  link text check (link is null or char_length(link) <= 300),
  event_id uuid references public.v2_events(id) on delete set null,
  confidential boolean not null default false,
  created_by uuid default auth.uid(), created_by_name text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists v2_office_records_kind_idx on public.v2_office_records (kind, on_date desc);
create unique index if not exists v2_office_records_ref_idx on public.v2_office_records (kind, ref_no) where ref_no is not null;

-- who may write which kind
create or replace function public.v2_office_can(p_kind text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(case
    when p_kind in ('minutes', 'resolution', 'letter_in', 'letter_out') then public.v2_role() in ('mayor', 'secretary')
    when p_kind = 'finding' then public.v2_role() = 'auditor'
    when p_kind = 'post' then public.v2_role() in ('mayor', 'pio')
    when p_kind in ('plan', 'incident') then public.v2_role() in ('mayor', 'marshall')
    else false end, false)
$$;
revoke all on function public.v2_office_can(text) from public, anon;
grant execute on function public.v2_office_can(text) to authenticated;

alter table public.v2_office_records enable row level security;
revoke all on public.v2_office_records from anon;
drop policy if exists office_read on public.v2_office_records;
create policy office_read on public.v2_office_records for select to authenticated
  using (public.v2_is_staff() and (not confidential or public.v2_role() in ('mayor', 'secretary', 'auditor')));
drop policy if exists office_write on public.v2_office_records;
create policy office_write on public.v2_office_records for all to authenticated
  using (public.v2_office_can(kind)) with check (public.v2_office_can(kind));

-- reference numbers, the officer's name, and the dates
create or replace function public.v2_office_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare pre text; n int; y text := to_char(now() at time zone 'Asia/Manila', 'YYYY');
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid(); new.created_by_name := public.v2__who();
    pre := case new.kind when 'minutes' then 'MIN' when 'resolution' then 'RES' when 'letter_in' then 'IN' when 'letter_out' then 'OUT' when 'finding' then 'AF' else null end;
    if pre is not null and new.ref_no is null then
      perform pg_advisory_xact_lock(hashtext('office_ref_' || new.kind));
      select count(*) + 1 into n from public.v2_office_records where kind = new.kind and ref_no like pre || '-' || y || '-%';
      new.ref_no := pre || '-' || y || '-' || lpad(n::text, 3, '0');
    end if;
  else
    new.kind := old.kind; new.ref_no := old.ref_no; new.created_by := old.created_by; new.created_by_name := old.created_by_name;
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.v2_office_guard() from public, anon;
drop trigger if exists v2_office_guard on public.v2_office_records;
create trigger v2_office_guard before insert or update on public.v2_office_records for each row execute function public.v2_office_guard();
drop trigger if exists v2_office_audit on public.v2_office_records;
create trigger v2_office_audit after insert or delete or update on public.v2_office_records for each row execute function public.v2_audit_trigger();

do $$ begin
  begin alter publication supabase_realtime add table public.v2_office_records; exception when others then null; end;
end $$;
