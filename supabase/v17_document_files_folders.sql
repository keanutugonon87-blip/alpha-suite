-- v17: Folders and attached files for the document tracker. Run v16 first. Safe to run more than once.
-- * Folders (Letters, Minutes, Requests ... whatever the Secretary names them) group the documents.
-- * Each document can carry attached files (PDF, Word, Excel, PowerPoint, text, photos), up to 10 MB each, in a private bucket.
-- * Only the Mayor, Vice Mayor and Secretary can see or add files. Download links expire after two minutes.

create table if not exists public.v2_doc_folders (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 40),
  sort int not null default 100,
  created_at timestamptz not null default now()
);
create unique index if not exists v2_doc_folders_name_key on public.v2_doc_folders (lower(name));
alter table public.v2_doc_folders enable row level security;
revoke all on public.v2_doc_folders from anon, authenticated;

alter table public.v2_documents add column if not exists folder_id uuid references public.v2_doc_folders(id) on delete set null;
create index if not exists v2_documents_folder_idx on public.v2_documents(folder_id);

create table if not exists public.v2_doc_files (
  id uuid primary key default gen_random_uuid(),
  doc_id uuid not null references public.v2_documents(id) on delete cascade,
  path text not null unique,
  name text not null check (char_length(name) between 1 and 150),
  size bigint not null check (size between 0 and 10485760),
  mime text,
  uploaded_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists v2_doc_files_doc_idx on public.v2_doc_files(doc_id);
alter table public.v2_doc_files enable row level security;
revoke all on public.v2_doc_files from anon, authenticated;

-- Starting folders (only when there are none)
insert into public.v2_doc_folders(name, sort)
select * from (values ('Letters', 10), ('Minutes', 20), ('Requests', 30), ('Forms', 40), ('Reports', 50)) v(name, sort)
where not exists (select 1 from public.v2_doc_folders);

-- Private storage bucket
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('v2-docs', 'v2-docs', false, 10485760,
  array['application/pdf','image/jpeg','image/png','image/webp','text/plain',
        'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists v2_docs_read on storage.objects;
drop policy if exists v2_docs_add on storage.objects;
drop policy if exists v2_docs_remove on storage.objects;
create policy v2_docs_read on storage.objects for select to authenticated
  using (bucket_id = 'v2-docs' and (select public.v2_has_role('mayor', 'vice_mayor', 'secretary')));
create policy v2_docs_add on storage.objects for insert to authenticated
  with check (bucket_id = 'v2-docs' and (select public.v2_has_role('mayor', 'vice_mayor', 'secretary')));
create policy v2_docs_remove on storage.objects for delete to authenticated
  using (bucket_id = 'v2-docs' and (select public.v2_has_role('mayor', 'secretary')));

-- ---------------------------------------------------------------------------
-- Functions (the old 6-argument save and the delete are replaced)
-- ---------------------------------------------------------------------------
drop function if exists public.v2_doc_save(uuid, text, text, text, date, text);
drop function if exists public.v2_doc_delete(uuid);

create or replace function public.v2_docs_list() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.v2_has_role('mayor', 'vice_mayor', 'secretary') then raise exception 'Not allowed'; end if;
  return jsonb_build_object(
    'folders', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name) order by f.sort, lower(f.name)) from public.v2_doc_folders f), '[]'::jsonb),
    'docs', coalesce((select jsonb_agg(to_jsonb(d) order by (d.status = 'submitted'), d.due_on nulls last, d.created_at desc)
      from (select x.id, x.title, x.kind, x.status, x.due_on, x.note, x.folder_id, x.created_at, x.updated_at, x.submitted_at,
              coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'size', f.size, 'mime', f.mime, 'path', f.path) order by f.created_at)
                        from public.v2_doc_files f where f.doc_id = x.id), '[]'::jsonb) as files
            from public.v2_documents x where x.status <> 'submitted' or x.submitted_at > now() - interval '30 days') d), '[]'::jsonb));
end $$;

create or replace function public.v2_doc_save(p_id uuid, p_title text, p_kind text, p_status text, p_due_on date, p_note text, p_folder uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare rid uuid := p_id; ttl text := btrim(coalesce(p_title, '')); nt text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.v2_has_role('mayor', 'vice_mayor', 'secretary') then raise exception 'Not allowed'; end if;
  if char_length(ttl) < 2 then raise exception 'Give the document a title'; end if;
  if p_kind not in ('letter','minutes','request','form','report','other') then raise exception 'Unknown kind'; end if;
  if p_status not in ('drafting','for_signature','submitted') then raise exception 'Unknown status'; end if;
  if p_folder is not null and not exists (select 1 from public.v2_doc_folders where id = p_folder) then raise exception 'That folder no longer exists'; end if;
  if rid is null then
    insert into public.v2_documents(title, kind, status, due_on, note, folder_id, created_by, submitted_at)
      values (ttl, p_kind, p_status, p_due_on, nt, p_folder, auth.uid(), case when p_status = 'submitted' then now() end) returning id into rid;
  else
    update public.v2_documents set title = ttl, kind = p_kind, due_on = p_due_on, note = nt, folder_id = p_folder, updated_at = now(),
      submitted_at = case when p_status = 'submitted' then coalesce(submitted_at, now()) else null end, status = p_status
      where id = rid;
    if not found then raise exception 'That document no longer exists'; end if;
  end if;
  insert into public.v2_audit(actor, actor_name, action, table_name, row_id, new_row)
    values (auth.uid(), (select full_name from public.v2_profiles where user_id = auth.uid()), 'DOC', 'v2_documents', rid::text, jsonb_build_object('title', ttl, 'status', p_status));
  return rid;
end $$;

-- Returns the stored file paths so the app can remove them from storage too
create or replace function public.v2_doc_delete(p_id uuid) returns text[]
language plpgsql security definer set search_path = '' as $$
declare paths text[];
begin
  if not public.v2_has_role('mayor', 'secretary') then raise exception 'Only the Mayor or Secretary can delete a document'; end if;
  select coalesce(array_agg(path), '{}') into paths from public.v2_doc_files where doc_id = p_id;
  delete from public.v2_documents where id = p_id;
  insert into public.v2_audit(actor, actor_name, action, table_name, row_id)
    values (auth.uid(), (select full_name from public.v2_profiles where user_id = auth.uid()), 'DOC_DELETE', 'v2_documents', p_id::text);
  return paths;
end $$;

create or replace function public.v2_doc_file_add(p_doc uuid, p_path text, p_name text, p_size bigint, p_mime text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare rid uuid;
begin
  if not public.v2_has_role('mayor', 'vice_mayor', 'secretary') then raise exception 'Not allowed'; end if;
  if not exists (select 1 from public.v2_documents where id = p_doc) then raise exception 'That document no longer exists'; end if;
  if p_path is null or p_path not like (p_doc::text || '/%') then raise exception 'Bad file path'; end if;
  if (select count(*) from public.v2_doc_files where doc_id = p_doc) >= 10 then raise exception 'A document can hold up to 10 files'; end if;
  insert into public.v2_doc_files(doc_id, path, name, size, mime, uploaded_by) values (p_doc, p_path, left(btrim(p_name), 150), p_size, p_mime, auth.uid()) returning id into rid;
  update public.v2_documents set updated_at = now() where id = p_doc;
  insert into public.v2_audit(actor, actor_name, action, table_name, row_id, new_row)
    values (auth.uid(), (select full_name from public.v2_profiles where user_id = auth.uid()), 'DOC_FILE', 'v2_doc_files', rid::text, jsonb_build_object('doc', p_doc, 'name', left(btrim(p_name), 150)));
  return rid;
end $$;

-- Returns the stored path so the app can remove the file from storage
create or replace function public.v2_doc_file_remove(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare pth text;
begin
  if not public.v2_has_role('mayor', 'secretary') then raise exception 'Only the Mayor or Secretary can remove a file'; end if;
  delete from public.v2_doc_files where id = p_id returning path into pth;
  insert into public.v2_audit(actor, actor_name, action, table_name, row_id)
    values (auth.uid(), (select full_name from public.v2_profiles where user_id = auth.uid()), 'DOC_FILE_REMOVE', 'v2_doc_files', p_id::text);
  return pth;
end $$;

create or replace function public.v2_folder_save(p_id uuid, p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare rid uuid := p_id; nm text := btrim(coalesce(p_name, ''));
begin
  if not public.v2_has_role('mayor', 'secretary') then raise exception 'Only the Mayor or Secretary can manage folders'; end if;
  if char_length(nm) < 2 then raise exception 'Give the folder a name'; end if;
  if exists (select 1 from public.v2_doc_folders where lower(name) = lower(nm) and id is distinct from rid) then raise exception 'A folder with that name already exists'; end if;
  if rid is null then insert into public.v2_doc_folders(name, sort) values (nm, 100) returning id into rid;
  else update public.v2_doc_folders set name = nm where id = rid; if not found then raise exception 'That folder no longer exists'; end if; end if;
  return rid;
end $$;

-- Deleting a folder keeps its documents (they move to "No folder")
create or replace function public.v2_folder_delete(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.v2_has_role('mayor', 'secretary') then raise exception 'Only the Mayor or Secretary can manage folders'; end if;
  delete from public.v2_doc_folders where id = p_id;
end $$;

do $$ declare f text; begin
  foreach f in array array['v2_docs_list()', 'v2_doc_save(uuid, text, text, text, date, text, uuid)', 'v2_doc_delete(uuid)', 'v2_doc_file_add(uuid, text, text, bigint, text)',
                           'v2_doc_file_remove(uuid)', 'v2_folder_save(uuid, text)', 'v2_folder_delete(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
