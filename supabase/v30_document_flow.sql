-- Alpha ’28 · v30 · Document flow: Secretary reviews → Mayor or VP Internal approves → Auditor classifies → PIO posts → members read.
-- Safe to run more than once. Paste all of it into Supabase > SQL Editor > Run. Run v28 and v29 first.
--
--   Applies to the Secretary's records: minutes, resolutions and letters (kinds minutes, resolution, letter_in, letter_out).
--   1. The Secretary writes the record and sends it for approval (stage: reviewed).
--   2. The Mayor or the VP Internal approves it, or returns it with a note (stage: approved or returned).
--   3. The Auditor classifies it as public (non-confidential) or confidential (stage: classified).
--      A confidential record can only be read by the Mayor, Secretary and Auditor.
--   4. The PIO posts a public record (stage: published). Every signed-in member then reads it on the Documents tab of their own screen.
--      The PIO cannot post a confidential record. The PIO can take a post down again.
--   Once a record has been sent for approval, nobody can edit its text, and only the Mayor can delete it after approval.

alter table public.v2_office_records
  add column if not exists flow text check (flow is null or flow in ('draft', 'reviewed', 'returned', 'approved', 'classified', 'published')),
  add column if not exists flow_note text check (flow_note is null or char_length(flow_note) <= 300),
  add column if not exists classification text check (classification is null or classification in ('public', 'confidential')),
  add column if not exists reviewed_by_name text, add column if not exists reviewed_at timestamptz,
  add column if not exists approved_by_name text, add column if not exists approved_at timestamptz,
  add column if not exists classified_by_name text, add column if not exists classified_at timestamptz,
  add column if not exists published_by_name text, add column if not exists published_at timestamptz;

-- records that existed before this step start at the beginning of the flow
update public.v2_office_records set flow = 'draft' where flow is null and kind in ('minutes', 'resolution', 'letter_in', 'letter_out');

-- the guard: stamps names, hands out reference numbers, and keeps the flow honest
create or replace function public.v2_office_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare pre text; n int; y text := to_char(now() at time zone 'Asia/Manila', 'YYYY'); sec boolean := new.kind in ('minutes', 'resolution', 'letter_in', 'letter_out'); viaRpc boolean := coalesce(current_setting('app.docflow', true), '') = '1';
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid(); new.created_by_name := public.v2__who();
    if sec then
      new.flow := 'draft'; new.classification := null; new.flow_note := null;
      new.reviewed_by_name := null; new.reviewed_at := null; new.approved_by_name := null; new.approved_at := null; new.classified_by_name := null; new.classified_at := null; new.published_by_name := null; new.published_at := null;
    else new.flow := null; end if;
    pre := case new.kind when 'minutes' then 'MIN' when 'resolution' then 'RES' when 'letter_in' then 'IN' when 'letter_out' then 'OUT' when 'finding' then 'AF' else null end;
    if pre is not null and new.ref_no is null then
      perform pg_advisory_xact_lock(hashtext('office_ref_' || new.kind));
      select count(*) + 1 into n from public.v2_office_records where kind = new.kind and ref_no like pre || '-' || y || '-%';
      new.ref_no := pre || '-' || y || '-' || lpad(n::text, 3, '0');
    end if;
  else
    new.kind := old.kind; new.ref_no := old.ref_no; new.created_by := old.created_by; new.created_by_name := old.created_by_name;
    if sec and not viaRpc then
      -- the flow columns only move through the functions below
      new.flow := old.flow; new.flow_note := old.flow_note; new.classification := old.classification;
      new.reviewed_by_name := old.reviewed_by_name; new.reviewed_at := old.reviewed_at; new.approved_by_name := old.approved_by_name; new.approved_at := old.approved_at;
      new.classified_by_name := old.classified_by_name; new.classified_at := old.classified_at; new.published_by_name := old.published_by_name; new.published_at := old.published_at;
      if old.flow not in ('draft', 'returned') and (new.title is distinct from old.title or new.body is distinct from old.body or new.party is distinct from old.party or new.link is distinct from old.link or new.on_date is distinct from old.on_date or new.confidential is distinct from old.confidential) then
        raise exception 'This record was already sent for approval and can no longer be edited';
      end if;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.v2_office_guard() from public, anon;

-- once approved, only the Mayor can delete a record
create or replace function public.v2_office_del_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.flow in ('approved', 'classified', 'published') and public.v2_role() <> 'mayor' then raise exception 'An approved record can only be deleted by the Mayor'; end if;
  return old;
end $$;
revoke all on function public.v2_office_del_guard() from public, anon;
drop trigger if exists v2_office_del_guard on public.v2_office_records;
create trigger v2_office_del_guard before delete on public.v2_office_records for each row execute function public.v2_office_del_guard();

-- the four steps
create or replace function public.v2__doc(p_id uuid) returns public.v2_office_records
language plpgsql security definer set search_path = '' as $$
declare r public.v2_office_records;
begin
  select * into r from public.v2_office_records where id = p_id;
  if r.id is null or r.kind not in ('minutes', 'resolution', 'letter_in', 'letter_out') then raise exception 'Record not found'; end if;
  return r;
end $$;
revoke all on function public.v2__doc(uuid) from public, anon;

create or replace function public.v2_doc_review(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.v2_office_records := public.v2__doc(p_id);
begin
  if not public.v2_has_role('secretary') then raise exception 'Only the Secretary sends a record for approval'; end if;
  if r.flow not in ('draft', 'returned') then raise exception 'This record is already past review'; end if;
  perform set_config('app.docflow', '1', true);
  update public.v2_office_records set flow = 'reviewed', flow_note = null, reviewed_by_name = public.v2__who(), reviewed_at = now() where id = p_id;
end $$;

create or replace function public.v2_doc_approve(p_id uuid, p_ok boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.v2_office_records := public.v2__doc(p_id); n text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if public.v2_role() not in ('mayor', 'vp_internal', 'vice_mayor') then raise exception 'Only the Mayor or the VP Internal approves records'; end if;
  if r.flow <> 'reviewed' then raise exception 'This record is not waiting for approval'; end if;
  if not coalesce(p_ok, false) and n is null then raise exception 'Say what needs to change'; end if;
  perform set_config('app.docflow', '1', true);
  if coalesce(p_ok, false) then update public.v2_office_records set flow = 'approved', flow_note = n, approved_by_name = public.v2__who(), approved_at = now() where id = p_id;
  else update public.v2_office_records set flow = 'returned', flow_note = n, approved_by_name = null, approved_at = null where id = p_id; end if;
end $$;

create or replace function public.v2_doc_classify(p_id uuid, p_class text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.v2_office_records := public.v2__doc(p_id);
begin
  if not public.v2_has_role('auditor') then raise exception 'Only the Auditor classifies records'; end if;
  if p_class not in ('public', 'confidential') then raise exception 'Choose public or confidential'; end if;
  if r.flow not in ('approved', 'classified', 'published') then raise exception 'The record must be approved first'; end if;
  perform set_config('app.docflow', '1', true);
  update public.v2_office_records set classification = p_class, confidential = (p_class = 'confidential'), flow = case when p_class = 'confidential' then 'classified' when r.flow = 'published' then 'published' else 'classified' end,
    classified_by_name = public.v2__who(), classified_at = now(),
    published_by_name = case when p_class = 'confidential' then null else published_by_name end, published_at = case when p_class = 'confidential' then null else published_at end where id = p_id;
end $$;

create or replace function public.v2_doc_publish(p_id uuid, p_on boolean default true) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.v2_office_records := public.v2__doc(p_id);
begin
  if public.v2_role() not in ('pio', 'mayor') then raise exception 'Only the PIO posts records'; end if;
  perform set_config('app.docflow', '1', true);
  if coalesce(p_on, true) then
    if r.flow <> 'classified' or r.classification <> 'public' then raise exception 'Only a record the Auditor classified as public can be posted'; end if;
    update public.v2_office_records set flow = 'published', published_by_name = public.v2__who(), published_at = now() where id = p_id;
  else
    if r.flow <> 'published' then raise exception 'This record is not posted'; end if;
    update public.v2_office_records set flow = 'classified', published_by_name = null, published_at = null where id = p_id;
  end if;
end $$;
revoke all on function public.v2_doc_review(uuid), public.v2_doc_approve(uuid, boolean, text), public.v2_doc_classify(uuid, text), public.v2_doc_publish(uuid, boolean) from public, anon;
grant execute on function public.v2_doc_review(uuid), public.v2_doc_approve(uuid, boolean, text), public.v2_doc_classify(uuid, text), public.v2_doc_publish(uuid, boolean) to authenticated;

-- the Mayor, VP Internal and PIO need to read the records that concern them; confidential ones stay with the Mayor, Secretary and Auditor
-- (the read policy from v29 already lets every officer read the non-confidential ones)

-- what members read on their own screen: only posted, public records. Signed-in members and officers; not guests.
create or replace function public.v2_public_documents() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v text := public.v2__viewer();
begin
  if v is null then raise exception 'Sign in required' using errcode = '28000'; end if;
  if v = 'guest' then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'ref_no', ref_no, 'title', title, 'on_date', on_date, 'body', body, 'link', link, 'published_at', published_at) order by published_at desc)
    from public.v2_office_records where flow = 'published' and classification = 'public' and not confidential), '[]'::jsonb);
end $$;
revoke all on function public.v2_public_documents() from public;
grant execute on function public.v2_public_documents() to anon, authenticated;
