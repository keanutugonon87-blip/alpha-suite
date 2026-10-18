-- Alpha ’28 · v13 · OPTIONAL · Move the pg_net extension out of the public schema (clears the last fixable security warning)
-- pg_net is what lets the database send phone alerts. It cannot be moved in place, so it is removed and added back inside the "extensions" schema.
-- Your alert functions call it as net.http_post(...), a name that does not change, so nothing else needs editing.
-- Safe by design: everything below runs as one transaction. If the check at the end fails, the whole thing is undone and pg_net stays as it was.
-- Do it at a quiet moment (any alert queued in the next second is lost, there is nothing queued normally). Safe to run more than once.

do $$
begin
  if exists (select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_net' and n.nspname = 'public') then
    drop extension pg_net;
    create extension pg_net with schema extensions;
  end if;
  -- the check: the function our alerts use must exist and be callable, and the extension must now live in "extensions"
  if not exists (select 1 from pg_proc p where p.pronamespace = 'net'::regnamespace and p.proname = 'http_post') then
    raise exception 'pg_net did not come back correctly. Nothing was changed.';
  end if;
  if not exists (select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_net' and n.nspname = 'extensions') then
    raise exception 'pg_net is not in the extensions schema. Nothing was changed.';
  end if;
  if not has_function_privilege('postgres', 'net.http_post(text, jsonb, jsonb, jsonb, integer)', 'execute')
     and not exists (select 1 from pg_proc p where p.pronamespace = 'net'::regnamespace and p.proname = 'http_post' and has_function_privilege('postgres', p.oid, 'execute')) then
    raise exception 'The database can no longer call net.http_post. Nothing was changed.';
  end if;
end $$;
