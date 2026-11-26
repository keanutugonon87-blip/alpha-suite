-- v76: only the SAILS President, VP Internal, VP External, Secretary and Treasurer can produce or print student QR cards.
-- v2_member_token is the one place a card code is issued (the other helpers are internal or only return the caller's own code).
-- Uses v2_role() directly, so the Class Mayor and the Class Treasurer (who match 'mayor' / 'treasurer' through aliases) are refused.
do $do$ declare src text;
begin
  select pg_get_functiondef('public.v2_member_token(uuid)'::regprocedure) into src;
  if src not like '%sails_president%' then
    src := replace(src, 'if not public.v2_has_role(''mayor'',''treasurer'',''vice_mayor'',''secretary'') then raise exception ''Not allowed''; end if;',
      'if coalesce(public.v2_role(), '''') not in (''sails_president'',''vp_internal'',''vp_external'',''secretary'',''treasurer'') then raise exception ''Not allowed''; end if;');
    if src not like '%sails_president%' then raise exception 'v76: could not update v2_member_token'; end if;
    execute src;
  end if;
end $do$;

do $do$ declare src text;
begin
  select pg_get_functiondef('public.v2_schema_marks()'::regprocedure) into src;
  if src not like '%''v76''%' then
    src := replace(src, E'  return mk;', E'  mk := mk || jsonb_build_object(''v76'', pg_get_functiondef(''public.v2_member_token(uuid)''::regprocedure) like ''%sails_president%'');\n  return mk;');
    execute src;
  end if;
end $do$;
