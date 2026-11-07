-- v47 · The President acts on incident reports the General Marshal referred to him: acknowledge, send back with an instruction, or close.
-- Requires v45 and v46. Safe to run twice.
alter table public.v2_marshal_incidents add column if not exists president_note text check (president_note is null or char_length(president_note) <= 500);
alter table public.v2_marshal_incidents add column if not exists president_action text check (president_action is null or president_action in ('acknowledged', 'sent_back', 'closed'));
alter table public.v2_marshal_incidents add column if not exists president_at timestamptz;

create or replace function public.v2_incident_president(p_id uuid, p_action text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare i public.v2_marshal_incidents; n text := nullif(btrim(coalesce(p_note, '')), ''); g record;
begin
  if not public.v2_is_president() then raise exception 'Only the President acts on a referral'; end if;
  select * into i from public.v2_marshal_incidents where id = p_id for update;
  if i.id is null then raise exception 'Report not found'; end if;
  if i.status <> 'referred' or i.referred_to is distinct from 'president' then raise exception 'This report was not referred to the President'; end if;
  if p_action = 'acknowledge' then
    update public.v2_marshal_incidents set president_action = 'acknowledged', president_note = coalesce(left(n, 500), president_note), president_at = now(), updated_at = now() where id = p_id;
  elsif p_action = 'send_back' then
    if n is null then raise exception 'Write the instruction for the General Marshal'; end if;
    update public.v2_marshal_incidents set status = 'reviewed', referred_to = null, president_action = 'sent_back', president_note = left(n, 500), president_at = now(), updated_at = now() where id = p_id;
    for g in select user_id from public.v2_profiles where role = 'general_marshal' loop
      perform public.v2__directive_push(g.user_id, 'The President sent a report back', coalesce(i.event, 'Incident report') || ' · ' || left(n, 120));
    end loop;
  elsif p_action = 'close' then
    if n is null then raise exception 'Write the decision'; end if;
    update public.v2_marshal_incidents set status = 'closed', president_action = 'closed', president_note = left(n, 500), president_at = now(), updated_at = now() where id = p_id;
    for g in select user_id from public.v2_profiles where role = 'general_marshal' loop
      perform public.v2__directive_push(g.user_id, 'The President closed a report', coalesce(i.event, 'Incident report') || ' · ' || left(n, 120));
    end loop;
    perform public.v2__directive_push(i.reporter_id, 'Your incident report was closed', coalesce(i.event, 'Incident report'));
  else raise exception 'Unknown action'; end if;
end $$;
grant execute on function public.v2_incident_president(uuid, text, text) to authenticated;

-- the President keeps seeing a report he acted on (acknowledged, sent back or closed by him)
drop policy if exists inc_read on public.v2_marshal_incidents;
create policy inc_read on public.v2_marshal_incidents for select to authenticated
  using (reporter_id = auth.uid() or public.v2_role() = 'general_marshal'
         or (public.v2_is_president() and (president_action is not null or (status = 'referred' and referred_to = 'president'))));
