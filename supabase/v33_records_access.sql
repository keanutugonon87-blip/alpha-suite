-- Alpha ’28 · v33 · Records access (CBL Article XVI, Section 2): members ask the Secretary for non-confidential records, and get an answer.
-- Safe to run more than once. Paste all of it into Supabase > SQL Editor > Run. Run v28 first.
--
--   • A student sends a request from the Archive tab of their own screen: signed in, or recognised by the QR-card token saved on their phone (the same one My Status uses).
--   • The Secretary (or Mayor) answers it: granted, with a note on where to get the record, or declined with the reason.
--   • A request still open after 7 days is flagged on the Secretary Desk, because requests shall be answered within a reasonable period.
--   • A student sees only their own requests. Nobody can edit a request directly; everything goes through the functions below.

create table if not exists public.v2_record_requests (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.v2_members(id) on delete cascade,
  requester_name text not null,
  title text not null check (char_length(title) between 3 and 120),
  note text check (note is null or char_length(note) <= 500),
  status text not null default 'open' check (status in ('open', 'granted', 'declined')),
  answer_note text check (answer_note is null or char_length(answer_note) <= 500),
  answered_by_name text, answered_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists v2_record_requests_member_idx on public.v2_record_requests (member_id, created_at desc);
alter table public.v2_record_requests enable row level security;
drop policy if exists record_requests_read on public.v2_record_requests;
create policy record_requests_read on public.v2_record_requests for select to authenticated using (public.v2_has_role('secretary', 'mayor', 'auditor'));

-- who is asking: the signed-in student, or the student whose QR-card token is saved on this phone (the same token My Status uses)
create or replace function public.v2__req_member(p_token text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare mid uuid := public.v2__my_member();
begin
  if mid is null and nullif(p_token, '') is not null then mid := public.v2_member_from_token(p_token); end if;
  return mid;
end $$;
revoke all on function public.v2__req_member(text) from public, anon, authenticated;

drop function if exists public.v2_record_request(text, text);
drop function if exists public.v2_my_record_requests();

create or replace function public.v2_record_request(p_title text, p_note text default null, p_token text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare mid uuid := public.v2__req_member(p_token); nm text; rid uuid;
begin
  if mid is null then raise exception 'Sign in as a student to request a record'; end if;
  if char_length(btrim(coalesce(p_title, ''))) < 3 then raise exception 'Say which record you need'; end if;
  if (select count(*) from public.v2_record_requests where member_id = mid and status = 'open') >= 5 then raise exception 'You already have 5 open requests. Wait for the Secretary to answer them first.'; end if;
  select full_name into nm from public.v2_members where id = mid;
  insert into public.v2_record_requests (member_id, requester_name, title, note) values (mid, coalesce(nm, ''), left(btrim(p_title), 120), nullif(left(btrim(coalesce(p_note, '')), 500), '')) returning public.v2_record_requests.id into rid;
  return rid;
end $$;

create or replace function public.v2_my_record_requests(p_token text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare mid uuid;
begin
  begin mid := public.v2__req_member(p_token); exception when others then return '[]'::jsonb; end;
  if mid is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'note', note, 'status', status, 'answer_note', answer_note, 'answered_by_name', answered_by_name, 'answered_at', answered_at, 'created_at', created_at) order by created_at desc)
    from public.v2_record_requests where member_id = mid), '[]'::jsonb);
end $$;

create or replace function public.v2_record_answer(p_id uuid, p_ok boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.v2_record_requests; n text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.v2_has_role('secretary', 'mayor') then raise exception 'Only the Secretary answers record requests'; end if;
  select * into r from public.v2_record_requests where id = p_id for update;
  if r.id is null then raise exception 'Request not found'; end if;
  if r.status <> 'open' then raise exception 'This request was already answered'; end if;
  if not coalesce(p_ok, false) and n is null then raise exception 'Say why the request is declined'; end if;
  update public.v2_record_requests set status = case when coalesce(p_ok, false) then 'granted' else 'declined' end, answer_note = left(n, 500), answered_by_name = public.v2__who(), answered_at = now() where id = p_id;
end $$;

revoke all on function public.v2_record_request(text, text, text), public.v2_my_record_requests(text), public.v2_record_answer(uuid, boolean, text) from public, anon;
grant execute on function public.v2_record_request(text, text, text), public.v2_my_record_requests(text) to anon, authenticated;
grant execute on function public.v2_record_answer(uuid, boolean, text) to authenticated;
