-- v16: Document tracker for the Secretary (letters, minutes, requests, forms).
-- Each document has a status: Drafting -> For signature -> Submitted, an optional due date and a short note.
-- Mayor, Vice Mayor and Secretary can use it. Everything goes through the functions below. Safe to run more than once.

create table if not exists public.v2_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 2 and 100),
  kind text not null default 'other' check (kind in ('letter','minutes','request','form','report','other')),
  status text not null default 'drafting' check (status in ('drafting','for_signature','submitted')),
  due_on date,
  note text check (note is null or char_length(note) <= 200),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz
);
create index if not exists v2_documents_status_idx on public.v2_documents(status, due_on);
alter table public.v2_documents enable row level security;
revoke all on public.v2_documents from anon, authenticated;

create or replace function public.v2_docs_list() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.v2_has_role('mayor', 'vice_mayor', 'secretary') then raise exception 'Not allowed'; end if;
  return coalesce((select jsonb_agg(to_jsonb(d) order by (d.status = 'submitted'), d.due_on nulls last, d.created_at desc)
    from (select id, title, kind, status, due_on, note, created_at, updated_at, submitted_at from public.v2_documents
          where status <> 'submitted' or submitted_at > now() - interval '30 days') d), '[]'::jsonb);
end $$;

create or replace function public.v2_doc_save(p_id uuid, p_title text, p_kind text, p_status text, p_due_on date, p_note text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare rid uuid := p_id; ttl text := btrim(coalesce(p_title, '')); nt text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.v2_has_role('mayor', 'vice_mayor', 'secretary') then raise exception 'Not allowed'; end if;
  if char_length(ttl) < 2 then raise exception 'Give the document a title'; end if;
  if p_kind not in ('letter','minutes','request','form','report','other') then raise exception 'Unknown kind'; end if;
  if p_status not in ('drafting','for_signature','submitted') then raise exception 'Unknown status'; end if;
  if rid is null then
    insert into public.v2_documents(title, kind, status, due_on, note, created_by, submitted_at)
      values (ttl, p_kind, p_status, p_due_on, nt, auth.uid(), case when p_status = 'submitted' then now() end) returning id into rid;
  else
    update public.v2_documents set title = ttl, kind = p_kind, due_on = p_due_on, note = nt, updated_at = now(),
      submitted_at = case when p_status = 'submitted' then coalesce(submitted_at, now()) else null end, status = p_status
      where id = rid;
    if not found then raise exception 'That document no longer exists'; end if;
  end if;
  insert into public.v2_audit(actor, actor_name, action, table_name, row_id, new_row)
    values (auth.uid(), (select full_name from public.v2_profiles where user_id = auth.uid()), 'DOC', 'v2_documents', rid::text, jsonb_build_object('title', ttl, 'status', p_status));
  return rid;
end $$;

create or replace function public.v2_doc_delete(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.v2_has_role('mayor', 'secretary') then raise exception 'Only the Mayor or Secretary can delete a document'; end if;
  delete from public.v2_documents where id = p_id;
  insert into public.v2_audit(actor, actor_name, action, table_name, row_id)
    values (auth.uid(), (select full_name from public.v2_profiles where user_id = auth.uid()), 'DOC_DELETE', 'v2_documents', p_id::text);
end $$;

revoke all on function public.v2_docs_list() from public, anon;
revoke all on function public.v2_doc_save(uuid, text, text, text, date, text) from public, anon;
revoke all on function public.v2_doc_delete(uuid) from public, anon;
grant execute on function public.v2_docs_list() to authenticated;
grant execute on function public.v2_doc_save(uuid, text, text, text, date, text) to authenticated;
grant execute on function public.v2_doc_delete(uuid) to authenticated;
