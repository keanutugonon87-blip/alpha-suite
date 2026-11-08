-- v54 · A Class Mayor no longer issues directives. He receives them from the VP Internal / VP External and reports up.
-- The class officers have no access to the system, so there is nobody for him to send to.
-- Safe to run twice.
create or replace function public.v2__directive_may(p_issuer text, p_assignee text) returns boolean
language sql immutable set search_path = '' as $$
  select case p_issuer
    when 'president' then p_assignee in ('vp_internal', 'vp_external', 'general_marshal')
    when 'vp_internal' then p_assignee in ('mayor')
    when 'vp_external' then p_assignee in ('mayor')
    when 'general_marshal' then p_assignee in ('dept_marshal')
    else false end
$$;
