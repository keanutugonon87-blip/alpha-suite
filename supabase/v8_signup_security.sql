-- Alpha ’28 · v8 · Sign-up tools and security view
-- Run AFTER v6 and v7. Safe to run more than once. Paste all of it into Supabase > SQL Editor > Run.
--   • Sign-up progress: who has a PIN, who does not, who signed in lately (Mayor, Vice Mayor, Secretary, Treasurer).
--   • A sign-in log (kept 90 days) so the Mayor and Vice Mayor can see failed tries, lockouts and PIN resets.

create table if not exists public.v2_login_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  member_id uuid references public.v2_members(id) on delete cascade,
  event text not null check (event in ('login', 'setup', 'fail', 'locked', 'reset'))
);
create index if not exists v2_login_log_at on public.v2_login_log(at desc);
alter table public.v2_login_log enable row level security;
revoke all on public.v2_login_log from anon, authenticated;

create or replace function public.v2__log_login(p_member uuid, p_event text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.v2_login_log(member_id, event) values (p_member, p_event);
  if random() < 0.05 then delete from public.v2_login_log where at < now() - interval '90 days'; end if;
end $$;
revoke all on function public.v2__log_login(uuid, text) from public, anon, authenticated;

-- The PIN functions, now writing to the log (same behaviour as before otherwise)
create or replace function public.v2_pin_login(p_student_no text, p_pin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n text := public.v2__norm_id(p_student_no); m public.v2_members; p public.v2_member_pins; cnt int; f int; mins int;
        bad jsonb := jsonb_build_object('ok', false, 'error', 'bad');
begin
  if n = '' or p_pin is null or p_pin !~ '^\d{6}$' then return bad; end if;
  select count(*) into cnt from public.v2_members where public.v2__norm_id(student_no) = n and student_no !~* '^pending' and status = 'active';
  if cnt <> 1 then return bad; end if;
  select * into m from public.v2_members where public.v2__norm_id(student_no) = n and student_no !~* '^pending' and status = 'active';
  select * into p from public.v2_member_pins where member_id = m.id for update;
  if p.member_id is null then return bad; end if;
  if p.locked_until is not null and p.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'locked', 'wait_minutes', greatest(ceil(extract(epoch from (p.locked_until - now())) / 60), 1)::int);
  end if;
  if extensions.crypt(p_pin, p.pin_hash) <> p.pin_hash then
    f := p.fails + 1;
    if f % 5 = 0 then
      mins := least((15 * power(2, greatest(f / 5 - 1, 0)))::int, 1440);
      update public.v2_member_pins set fails = f, locked_until = now() + make_interval(mins => mins) where member_id = m.id;
      perform public.v2__log_login(m.id, 'locked');
      return jsonb_build_object('ok', false, 'error', 'locked', 'wait_minutes', mins);
    end if;
    update public.v2_member_pins set fails = f where member_id = m.id;
    perform public.v2__log_login(m.id, 'fail');
    return bad;
  end if;
  if m.token_revoked then return jsonb_build_object('ok', false, 'error', 'revoked'); end if;
  update public.v2_member_pins set fails = 0, locked_until = null where member_id = m.id;
  perform public.v2__log_login(m.id, 'login');
  return jsonb_build_object('ok', true, 'token', public.v2__token_for(m.id));
end $$;
grant execute on function public.v2_pin_login(text, text) to service_role;
revoke execute on function public.v2_pin_login(text, text) from public, anon, authenticated;

create or replace function public.v2_pin_setup(p_student_no text, p_token text, p_pin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare mid uuid; m public.v2_members;
begin
  mid := public.v2_member_from_token(p_token);   -- raises when the QR code is wrong or replaced
  select * into m from public.v2_members where id = mid;
  if public.v2__norm_id(m.student_no) = '' or m.student_no ~* '^pending' or public.v2__norm_id(m.student_no) <> public.v2__norm_id(p_student_no) then
    return jsonb_build_object('ok', false, 'error', 'mismatch');
  end if;
  if p_pin is null or p_pin !~ '^\d{6}$' then return jsonb_build_object('ok', false, 'error', 'format'); end if;
  if p_pin ~ '^(\d)\1{5}$' or strpos('01234567890123456789', p_pin) > 0 or strpos('98765432109876543210', p_pin) > 0 then
    return jsonb_build_object('ok', false, 'error', 'weak');
  end if;
  insert into public.v2_member_pins(member_id, pin_hash) values (mid, extensions.crypt(p_pin, extensions.gen_salt('bf', 8)))
    on conflict (member_id) do update set pin_hash = excluded.pin_hash, set_at = now(), fails = 0, locked_until = null;
  perform public.v2__log_login(mid, 'setup');
  return jsonb_build_object('ok', true, 'token', public.v2__token_for(mid));
end $$;
grant execute on function public.v2_pin_setup(text, text, text) to service_role;
revoke execute on function public.v2_pin_setup(text, text, text) from public, anon, authenticated;

create or replace function public.v2_reset_member_pin(p_member uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare nm text;
begin
  if not public.v2_has_role('mayor', 'treasurer') then raise exception 'Only the Mayor or Treasurer can reset a PIN'; end if;
  delete from public.v2_member_pins where member_id = p_member;
  perform public.v2__log_login(p_member, 'reset');
  select full_name into nm from public.v2_profiles where user_id = auth.uid();
  insert into public.v2_audit(actor, actor_name, action, table_name, row_id) values (auth.uid(), nm, 'PIN_RESET', 'v2_member_pins', p_member::text);
end $$;
grant execute on function public.v2_reset_member_pin(uuid) to authenticated;

-- Sign-up progress for the officers who help students get set up
create or replace function public.v2_signup_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.v2_has_role('mayor', 'vice_mayor', 'secretary', 'treasurer') then raise exception 'Not allowed'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('member_id', m.id, 'name', m.full_name, 'student_no', m.student_no,
      'has_pin', p.member_id is not null, 'set_at', p.set_at, 'locked', coalesce(p.locked_until > now(), false),
      'last_login_at', a.last_login_at) order by m.full_name), '[]'::jsonb)
    from public.v2_members m
    left join public.v2_member_pins p on p.member_id = m.id
    left join public.v2_member_accounts a on a.member_id = m.id
    where m.status = 'active');
end $$;
grant execute on function public.v2_signup_status() to authenticated;

-- Security view for the Mayor and Vice Mayor
create or replace function public.v2_security_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.v2_has_role('mayor', 'vice_mayor') then raise exception 'Not allowed'; end if;
  return jsonb_build_object(
    'locked_now', (select coalesce(jsonb_agg(jsonb_build_object('name', m.full_name, 'until', p.locked_until, 'fails', p.fails) order by p.locked_until desc), '[]'::jsonb)
        from public.v2_member_pins p join public.v2_members m on m.id = p.member_id where p.locked_until > now()),
    'fails_24h', (select count(*) from public.v2_login_log where event in ('fail', 'locked') and at > now() - interval '24 hours'),
    'resets_7d', (select count(*) from public.v2_login_log where event = 'reset' and at > now() - interval '7 days'),
    'recent', (select coalesce(jsonb_agg(jsonb_build_object('at', l.at, 'event', l.event, 'name', coalesce(m.full_name, '?')) order by l.at desc), '[]'::jsonb)
        from (select * from public.v2_login_log order by at desc limit 40) l left join public.v2_members m on m.id = l.member_id));
end $$;
grant execute on function public.v2_security_overview() to authenticated;
