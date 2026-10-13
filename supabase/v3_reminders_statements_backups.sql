-- Alpha ’28 — payment reminders, student statements, weekly backups.
-- Run once in the Supabase SQL editor (project gxwgkbplscsduscoeoph). Safe to run again.
-- After this, deploy the two edge functions in supabase/functions/ (see the notes at the bottom).

-- ===========================================================================
-- 0. Helper: turn a student's QR code into a member id (same checks as v2_self_check).
--    Not callable from the app; only the functions below use it.
-- ===========================================================================
create or replace function public.v2_member_from_token(p_token text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare parts text[]; m public.v2_members; k bytea; good text;
begin
  parts := string_to_array(p_token, '.');
  if array_length(parts, 1) <> 4 or parts[1] <> 'A1' then raise exception 'That is not an Alpha QR code'; end if;
  begin select * into m from public.v2_members where id = parts[2]::uuid;
  exception when others then raise exception 'That is not an Alpha QR code'; end;
  if m.id is null then raise exception 'Unknown student'; end if;
  select value into k from public.v2_secrets where key = 'qr_hmac';
  good := left(encode(extensions.hmac((m.id::text || '.' || parts[3])::bytea, k, 'sha256'), 'hex'), 16);
  if good <> parts[4] then raise exception 'QR code could not be verified'; end if;
  if m.token_revoked or m.token_version::text <> parts[3] then raise exception 'This QR code was replaced. Ask the Treasurer for your new card'; end if;
  return m.id;
end $$;
revoke all on function public.v2_member_from_token(text) from public, anon, authenticated;

-- ===========================================================================
-- 1. Payment reminders
-- ===========================================================================
-- A phone is linked to a student only when that student turns reminders on after opening My Status.
alter table public.v2_push_subs add column if not exists member_id uuid references public.v2_members(id) on delete cascade;
create index if not exists v2_push_subs_member_idx on public.v2_push_subs(member_id);

create or replace function public.v2_push_subscribe_member(p_endpoint text, p_p256dh text, p_auth text, p_token text) returns void
language plpgsql security definer set search_path = '' as $$
declare mid uuid;
begin
  mid := public.v2_member_from_token(p_token);
  insert into public.v2_push_subs(endpoint, p256dh, auth, member_id) values (p_endpoint, p_p256dh, p_auth, mid)
  on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, member_id = mid;
end $$;
grant execute on function public.v2_push_subscribe_member(text, text, text, text) to anon, authenticated;

-- A record of every reminder that was sent (who, which charge, how many).
create table if not exists public.v2_reminders (
  id uuid primary key default gen_random_uuid(),
  charge_id uuid references public.v2_charges(id) on delete cascade,
  sent_by uuid, sent_by_name text,
  owing int not null default 0, reached int not null default 0,
  created_at timestamptz not null default now());
alter table public.v2_reminders enable row level security;
drop policy if exists v2_reminders_read on public.v2_reminders;
create policy v2_reminders_read on public.v2_reminders for select to authenticated
  using (public.v2_has_role('mayor', 'vice_mayor', 'treasurer', 'auditor'));

-- How many still owe a charge, how many of them have a linked phone, and when the last reminder went out.
create or replace function public.v2_reminder_status(p_charge uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.v2_has_role('mayor', 'vice_mayor', 'treasurer', 'auditor') then raise exception 'Not allowed'; end if;
  return (
    with ow as (
      select m.id from public.v2_members m
      join public.v2_charges c on c.id = p_charge
      left join (select member_id, sum(amount) paid from public.v2_entries
                 where kind = 'collection' and status in ('approved', 'pending') and charge_id = p_charge group by 1) p on p.member_id = m.id
      where m.status = 'active' and c.amount - coalesce(p.paid, 0) > 0)
    select jsonb_build_object(
      'owing', (select count(*) from ow),
      'reachable', (select count(distinct s.member_id) from public.v2_push_subs s where s.member_id in (select id from ow)),
      'last', (select max(created_at) from public.v2_reminders where charge_id = p_charge)));
end $$;
grant execute on function public.v2_reminder_status(uuid) to authenticated;

-- Send the reminder. Each student gets their own amount. At most one reminder per charge every 6 hours.
create or replace function public.v2_send_reminder(p_charge uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.v2_charges; s text; items jsonb; n int; reach int; last_at timestamptz; who text;
begin
  if not public.v2_has_role('mayor', 'vice_mayor', 'treasurer', 'auditor') then raise exception 'Not allowed'; end if;
  select * into c from public.v2_charges where id = p_charge;
  if c.id is null then raise exception 'Unknown charge'; end if;
  if c.closed then raise exception 'This charge is closed'; end if;
  select max(created_at) into last_at from public.v2_reminders where charge_id = p_charge;
  if last_at is not null and last_at > now() - interval '6 hours' then
    raise exception 'A reminder for this charge already went out less than 6 hours ago';
  end if;
  select convert_from(value, 'UTF8') into s from public.v2_secrets where key = 'push_hook';
  if s is null then raise exception 'Alerts are not set up yet'; end if;

  with ow as (
    select m.id, greatest(c.amount - coalesce(p.paid, 0), 0) owed from public.v2_members m
    left join (select member_id, sum(amount) paid from public.v2_entries
               where kind = 'collection' and status in ('approved', 'pending') and charge_id = p_charge group by 1) p on p.member_id = m.id
    where m.status = 'active' and c.amount - coalesce(p.paid, 0) > 0)
  select coalesce(jsonb_agg(jsonb_build_object('member_id', ow.id, 'title', 'Payment reminder · Alpha ’28',
      'body', c.title || ': you still owe ₱' || case when ow.owed = trunc(ow.owed) then trunc(ow.owed)::text else to_char(ow.owed, 'FM999990.00') end
              || case when c.due_on is not null then ' (due ' || to_char(c.due_on, 'Mon FMDD') || ')' else '' end
              || '. Please settle with the Treasurer. Salamat!')), '[]'::jsonb),
         count(*),
         count(*) filter (where exists (select 1 from public.v2_push_subs x where x.member_id = ow.id))
    into items, n, reach from ow;

  perform net.http_post(url := 'https://gxwgkbplscsduscoeoph.supabase.co/functions/v1/notify-announcement',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-secret', s),
    body := jsonb_build_object('kind', 'reminder', 'items', items));

  select full_name into who from public.v2_profiles where user_id = auth.uid();
  insert into public.v2_reminders(charge_id, sent_by, sent_by_name, owing, reached) values (p_charge, auth.uid(), who, n, reach);
  return jsonb_build_object('owing', n, 'reached', reach);
end $$;
grant execute on function public.v2_send_reminder(uuid) to authenticated;

-- ===========================================================================
-- 2. Student statement (what I paid, what I still owe) — only for the holder of the QR code
-- ===========================================================================
create or replace function public.v2_self_statement(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare mid uuid; m public.v2_members;
begin
  mid := public.v2_member_from_token(p_token);
  select * into m from public.v2_members where id = mid;
  return jsonb_build_object(
    'name', m.full_name, 'student_no', m.student_no, 'at', now(),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object('at', e.occurred_at, 'receipt_no', e.receipt_no, 'code', e.verify_code,
          'for', coalesce(c.title, e.purpose, e.category), 'amount', e.amount, 'method', e.method, 'fund', coalesce(e.fund, c.fund), 'status', e.status)
          order by e.occurred_at desc), '[]'::jsonb)
        from public.v2_entries e left join public.v2_charges c on c.id = e.charge_id
        where e.member_id = mid and e.kind = 'collection' and e.status in ('approved', 'pending')),
    'balances', (select coalesce(jsonb_agg(jsonb_build_object('charge', c.title, 'due', c.amount, 'paid', coalesce(p.paid, 0),
          'owed', greatest(c.amount - coalesce(p.paid, 0), 0), 'closed', c.closed) order by c.created_at), '[]'::jsonb)
        from public.v2_charges c left join (select charge_id, sum(amount) paid from public.v2_entries
          where member_id = mid and kind = 'collection' and status in ('approved', 'pending') and charge_id is not null group by 1) p on p.charge_id = c.id));
end $$;
grant execute on function public.v2_self_statement(text) to anon, authenticated;

-- ===========================================================================
-- 3. Weekly backups (private storage bucket + a Monday 3 AM Manila job)
-- ===========================================================================
insert into storage.buckets (id, name, public) values ('v2-backups', 'v2-backups', false) on conflict (id) do nothing;
drop policy if exists v2_backups_read on storage.objects;
create policy v2_backups_read on storage.objects for select to authenticated
  using (bucket_id = 'v2-backups' and public.v2_has_role('mayor', 'vice_mayor'));

create or replace function public.v2_run_backup() returns void
language plpgsql security definer set search_path = '' as $$
declare s text;
begin
  select convert_from(value, 'UTF8') into s from public.v2_secrets where key = 'push_hook';
  if s is null then raise exception 'Backups are not set up yet'; end if;
  perform net.http_post(url := 'https://gxwgkbplscsduscoeoph.supabase.co/functions/v1/weekly-backup',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-secret', s), body := '{}'::jsonb);
end $$;
revoke all on function public.v2_run_backup() from public, anon, authenticated;

create or replace function public.v2_backup_now() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.v2_has_role('mayor', 'vice_mayor') then raise exception 'Only the Mayor or Vice Mayor can start a backup'; end if;
  perform public.v2_run_backup();
end $$;
grant execute on function public.v2_backup_now() to authenticated;

create extension if not exists pg_cron;
select cron.schedule('alpha28-weekly-backup', '0 19 * * 0', $$select public.v2_run_backup()$$);   -- 19:00 UTC Sunday = 3:00 Monday in Manila

-- ===========================================================================
-- Then, in Supabase → Edge Functions:
--   1. Open "notify-announcement" → paste supabase/functions/notify-announcement/index.ts → Deploy.
--   2. New function "weekly-backup" → paste supabase/functions/weekly-backup/index.ts → Deploy.
--      Turn OFF "Verify JWT" for both (they check the shared secret themselves, like the existing one).
-- ===========================================================================
