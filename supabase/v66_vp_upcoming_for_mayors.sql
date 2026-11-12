-- v66: approved SAILS VP meetings and programs show on every Class Mayor's Today screen (read only).
-- Cancelled, proposed and returned ones never show; held ones drop off after the day. Run once in the Supabase SQL editor. Safe to run again.

create or replace function public.v2_vp_upcoming()
returns table (id uuid, kind text, title text, held_on date, held_at text, venue text, agenda text, assigned text)
language sql stable security definer set search_path = '' as $$
  select m.id, m.kind, m.title, m.held_on, m.held_at, m.venue, m.agenda, m.assigned
  from public.v2_vp_meetings m
  where public.v2_is_staff() and m.status = 'approved'
    and m.held_on >= (now() at time zone 'Asia/Manila')::date
  order by m.held_on, m.held_at nulls last, m.title
  limit 12
$$;
revoke execute on function public.v2_vp_upcoming() from public, anon;
grant execute on function public.v2_vp_upcoming() to authenticated, service_role;
