-- Alpha ’28 · v34 · PIO checks (CBL Section 7 and Article XVI, Sections 4 and 5).
-- Safe to run more than once. Paste all of it into Supabase > SQL Editor > Run. Run v29 first.
--
-- A post, publication, announcement or photo/media record cannot be approved or published until the PIO has ticked
-- the privacy, branding and communication checks (and, for photos and media, that everyone shown agreed).
-- A post that is already approved or published cannot lose one of those ticks.

create or replace function public.v2_post_checks() returns trigger
language plpgsql security definer set search_path = '' as $$
declare f jsonb := coalesce(new.flags, '{}'::jsonb); o jsonb := case when tg_op = 'UPDATE' then coalesce(old.flags, '{}'::jsonb) else '{}'::jsonb end;
        t text := coalesce(f ->> 'type', 'publication'); need text[] := array['privacy', 'branding', 'comms']; c text; miss text[] := '{}';
begin
  if new.kind <> 'post' or new.status not in ('approved', 'published') then return new; end if;
  if t in ('documentation', 'media') then need := array_append(need, 'consent'); end if;
  if tg_op = 'UPDATE' and old.status = new.status then
    foreach c in array need loop if coalesce(o ->> c, '') = 'true' and coalesce(f ->> c, '') <> 'true' then miss := array_append(miss, c); end if; end loop;   -- an approved post keeps its ticks
  else
    foreach c in array need loop if coalesce(f ->> c, '') <> 'true' then miss := array_append(miss, c); end if; end loop;
  end if;
  if array_length(miss, 1) > 0 then raise exception 'Tick these checks first: %', array_to_string(miss, ', '); end if;
  return new;
end $$;
revoke all on function public.v2_post_checks() from public, anon;
drop trigger if exists v2_post_checks on public.v2_office_records;
create trigger v2_post_checks before insert or update on public.v2_office_records for each row execute function public.v2_post_checks();
