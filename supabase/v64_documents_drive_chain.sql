-- v64: Documents and the Google Drive copy follow the SAILS chain of command. Run once. Safe to run again.
-- The SAILS President sees the documents and the Drive status (and links Drive in the app). The SAILS Secretary manages the documents.
-- The Class Mayor has no part in documents or Drive.
do $$ declare fn text; src text; n int := 0;
begin
  -- who can look at the list and the Drive status: the SAILS President and the SAILS Secretary
  foreach fn in array array['public.v2_docs_list()', 'public.v2_drive_status()'] loop
    select pg_get_functiondef(fn::regprocedure) into src;
    if src like '%v2_has_role(''mayor'', ''vice_mayor'', ''secretary'')%' then
      src := replace(src, 'public.v2_has_role(''mayor'', ''vice_mayor'', ''secretary'')', '(public.v2_is_real_president() or public.v2_role() = ''secretary'')');
      execute src; n := n + 1;
    end if;
  end loop;
  -- who can save a document or add a file: the SAILS Secretary (and the VPs, as before)
  foreach fn in array array['public.v2_doc_save(uuid,text,text,text,date,text,uuid)', 'public.v2_doc_file_add(uuid,text,text,bigint,text)'] loop
    select pg_get_functiondef(fn::regprocedure) into src;
    if src like '%v2_has_role(''mayor'', ''vice_mayor'', ''secretary'')%' then
      src := replace(src, 'public.v2_has_role(''mayor'', ''vice_mayor'', ''secretary'')', 'public.v2_has_role(''vice_mayor'', ''secretary'')');
      execute src; n := n + 1;
    end if;
  end loop;
  -- delete, remove a file, review: the SAILS Secretary only
  foreach fn in array array['public.v2_doc_delete(uuid)', 'public.v2_doc_file_remove(uuid)', 'public.v2_doc_review(uuid)'] loop
    select pg_get_functiondef(fn::regprocedure) into src;
    if src like '%v2_has_role(''mayor'', ''secretary'')%' or src like '%v2_has_role(''secretary'', ''mayor'')%' then
      src := replace(replace(src, 'public.v2_has_role(''mayor'', ''secretary'')', 'public.v2_has_role(''secretary'')'), 'public.v2_has_role(''secretary'', ''mayor'')', 'public.v2_has_role(''secretary'')');
      execute src; n := n + 1;
    end if;
  end loop;
  raise notice 'document functions updated: %', n;
end $$;
