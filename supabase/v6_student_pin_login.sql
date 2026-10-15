-- Alpha ’28 · v6 · Student sign-in with Student ID + 6-digit PIN (the QR card still works too).
-- Safe to run more than once. Paste all of it into Supabase > SQL Editor > Run.
--
-- How it works
--   • First time: the student proves they hold their QR card (scan it, or paste the code under it) and picks a PIN.
--   • After that: Student ID + PIN gives the same My Status page. It works from any phone.
--   • PINs are stored scrambled (bcrypt) in a table nobody can read from the app. Officers can reset a PIN but never see it.
--   • 5 wrong tries lock that student for 15 minutes; more wrong tries lock for longer (up to 24 hours).

-- ===========================================================================
-- 1. Storage (locked away from the app: no policies, no grants)
-- ===========================================================================
create table if not exists public.v2_member_pins (
  member_id uuid primary key references public.v2_members(id) on delete cascade,
  pin_hash text not null,
  set_at timestamptz not null default now(),
  fails int not null default 0,
  locked_until timestamptz
);
alter table public.v2_member_pins enable row level security;
revoke all on public.v2_member_pins from anon, authenticated;

-- ===========================================================================
-- 2. Helpers (not callable from the app)
-- ===========================================================================
create or replace function public.v2__norm_id(t text) returns text
language sql immutable set search_path = '' as $$ select lower(regexp_replace(coalesce(t, ''), '[^A-Za-z0-9]', '', 'g')) $$;
revoke all on function public.v2__norm_id(text) from public, anon, authenticated;

-- The same signed code that is printed under the QR card.
create or replace function public.v2__token_for(p_member uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare m public.v2_members; k bytea;
begin
  select * into m from public.v2_members where id = p_member;
  select value into k from public.v2_secrets where key = 'qr_hmac';
  return 'A1.' || m.id::text || '.' || m.token_version::text || '.' || left(encode(extensions.hmac((m.id::text || '.' || m.token_version::text)::bytea, k, 'sha256'), 'hex'), 16);
end $$;
revoke all on function public.v2__token_for(uuid) from public, anon, authenticated;

-- ===========================================================================
-- 3. Sign in with Student ID + PIN
--    Returns {ok:true, token} or {ok:false, error, wait_minutes?}. It never says whether the ID exists.
-- ===========================================================================
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
      return jsonb_build_object('ok', false, 'error', 'locked', 'wait_minutes', mins);
    end if;
    update public.v2_member_pins set fails = f where member_id = m.id;
    return bad;
  end if;
  if m.token_revoked then return jsonb_build_object('ok', false, 'error', 'revoked'); end if;
  update public.v2_member_pins set fails = 0, locked_until = null where member_id = m.id;
  return jsonb_build_object('ok', true, 'token', public.v2__token_for(m.id));
end $$;
grant execute on function public.v2_pin_login(text, text) to anon, authenticated;

-- ===========================================================================
-- 4. Set or change a PIN. Needs the student's QR code, so only the card holder can do it.
-- ===========================================================================
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
  return jsonb_build_object('ok', true, 'token', public.v2__token_for(mid));
end $$;
grant execute on function public.v2_pin_setup(text, text, text) to anon, authenticated;

-- ===========================================================================
-- 5. For officers: who has a PIN, and reset one (also unlocks it)
-- ===========================================================================
create or replace function public.v2_pin_members() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.v2_has_role('mayor', 'vice_mayor', 'treasurer', 'secretary', 'auditor') then raise exception 'Not allowed'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('member_id', member_id, 'locked', coalesce(locked_until > now(), false), 'set_at', set_at)), '[]'::jsonb) from public.v2_member_pins);
end $$;
grant execute on function public.v2_pin_members() to authenticated;

create or replace function public.v2_reset_member_pin(p_member uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare nm text;
begin
  if not public.v2_has_role('mayor', 'treasurer') then raise exception 'Only the Mayor or Treasurer can reset a PIN'; end if;
  delete from public.v2_member_pins where member_id = p_member;
  select full_name into nm from public.v2_profiles where user_id = auth.uid();
  insert into public.v2_audit(actor, actor_name, action, table_name, row_id) values (auth.uid(), nm, 'PIN_RESET', 'v2_member_pins', p_member::text);
end $$;
grant execute on function public.v2_reset_member_pin(uuid) to authenticated;
