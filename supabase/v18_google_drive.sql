-- v18: Google Drive copy of the document folders and files. Run v16 and v17 first. Safe to run more than once.
-- The app copies every folder and attached file into the Mayor's linked Google Drive (one-way: app -> Drive).
-- Drive copies are never deleted by the app, so deleting something here does not remove the Drive copy.
-- The Google sign-in itself is done from the Documents tab (Mayor only). The login token is kept in v2_secrets, which no app user can read.

alter table public.v2_doc_folders add column if not exists drive_folder_id text;
alter table public.v2_doc_folders add column if not exists drive_name text;
alter table public.v2_doc_folders add column if not exists drive_error text;
alter table public.v2_doc_files add column if not exists drive_file_id text;
alter table public.v2_doc_files add column if not exists drive_error text;
create index if not exists v2_doc_files_unsynced_idx on public.v2_doc_files(created_at) where drive_file_id is null;

create or replace function public.v2_drive_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.v2_has_role('mayor', 'vice_mayor', 'secretary') then raise exception 'Not allowed'; end if;
  return jsonb_build_object(
    'linked', exists (select 1 from public.v2_secrets where key = 'drive_refresh'),
    'email', (select convert_from(value, 'UTF8') from public.v2_secrets where key = 'drive_email'),
    'pending_folders', (select count(*) from public.v2_doc_folders where drive_folder_id is null),
    'pending_files', (select count(*) from public.v2_doc_files where drive_file_id is null),
    'failed', (select count(*) from public.v2_doc_folders where drive_error is not null) + (select count(*) from public.v2_doc_files where drive_error is not null),
    'last_sync', public.v2__setting('drive_last_sync'),
    'last_error', public.v2__setting('drive_last_error'));
end $$;
revoke all on function public.v2_drive_status() from public, anon;
grant execute on function public.v2_drive_status() to authenticated;

-- Folder and file lists now also say whether each one is in Drive
create or replace function public.v2_docs_list() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.v2_has_role('mayor', 'vice_mayor', 'secretary') then raise exception 'Not allowed'; end if;
  return jsonb_build_object(
    'folders', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'created_at', f.created_at, 'synced', f.drive_folder_id is not null, 'failed', f.drive_error is not null)
                                          order by f.sort, lower(f.name)) from public.v2_doc_folders f), '[]'::jsonb),
    'docs', coalesce((select jsonb_agg(to_jsonb(d) order by (d.status = 'submitted'), d.due_on nulls last, d.created_at desc)
      from (select x.id, x.title, x.kind, x.status, x.due_on, x.note, x.folder_id, x.created_at, x.updated_at, x.submitted_at,
              coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'size', f.size, 'mime', f.mime, 'path', f.path, 'synced', f.drive_file_id is not null) order by f.created_at)
                        from public.v2_doc_files f where f.doc_id = x.id), '[]'::jsonb) as files
            from public.v2_documents x where x.status <> 'submitted' or x.submitted_at > now() - interval '30 days') d), '[]'::jsonb));
end $$;

-- Nightly catch-up at 2:00 AM Manila: copies anything that did not make it during the day. Does nothing until Drive is linked.
create or replace function public.v2_run_drive_sync() returns void
language plpgsql security definer set search_path = '' as $$
declare s text;
begin
  if not exists (select 1 from public.v2_secrets where key = 'drive_refresh') then return; end if;
  select convert_from(value, 'UTF8') into s from public.v2_secrets where key = 'push_hook';
  if s is null then return; end if;
  perform net.http_post(url := 'https://gxwgkbplscsduscoeoph.supabase.co/functions/v1/drive-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-secret', s), body := '{"action":"sync","limit":40}'::jsonb);
end $$;
revoke all on function public.v2_run_drive_sync() from public, anon, authenticated;
select cron.schedule('alpha28-drive-sync', '0 18 * * *', $$select public.v2_run_drive_sync()$$);   -- 18:00 UTC = 2:00 AM Manila
