-- Alpha ’28 · v7 · Sign-in required: every student has an account tied to their Student ID, plus guest codes.
-- Safe to run more than once. Run AFTER v6 (Student ID + PIN). Paste all of it into Supabase > SQL Editor > Run.
--
-- What this adds
--   • An account for each student (made by the student-auth function when they create their PIN). Students never get an officer profile.
--   • Officers keep their existing accounts. The Mayor links each officer to their student record, and from then on they sign in with Student ID + PIN too.
--   • A "Require sign-in" switch (System tab, Mayor only). While it is OFF nothing changes for anyone. When it is ON, the open pages need a sign-in.
--   • Guest codes (Mayor): temporary read-only access for parents or visitors. Guests see fund totals, officers and announcements only.
--   • A sign-in lasts 30 days. After that the student or officer types their PIN again. Inactive students are blocked at once.

-- ===========================================================================
-- 1. Students and guests do not get an officer profile
-- ===========================================================================
create or replace function public.v2_handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(new.raw_user_meta_data->>'alpha_kind', '') in ('student', 'guest') then return new; end if;
  insert into public.v2_profiles(user_id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)))
  on conflict (user_id) do nothing;
  return new;
end $$;

-- ===========================================================================
-- 2. Tables (no policies and no grants: only the functions below touch them)
-- ===========================================================================
create table if not exists public.v2_member_accounts (
  member_id uuid primary key references public.v2_members(id) on delete cascade,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  kind text not null default 'student' check (kind in ('student', 'officer')),
  last_login_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.v2_member_accounts enable row level security;
revoke all on public.v2_member_accounts from anon, authenticated;

create table if not exists public.v2_guest_codes (
  id uuid primary key default gen_random_uuid(),
  label text not null check (length(btrim(label)) >= 2),
  code_hash text not null unique,
  user_id uuid unique references auth.users(id) on delete set null,
  expires_at timestamptz not null,
  revoked boolean not null default false,
  created_by uuid, created_by_name text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
alter table public.v2_guest_codes enable row level security;
revoke all on public.v2_guest_codes from anon, authenticated;

-- ===========================================================================
-- 3. Who is signed in? A linked account only counts for 30 days after its last PIN sign-in, and only while the student is active.
-- ===========================================================================
create or replace function public.v2_role() returns text
language sql stable security definer set search_path = '' as $$
  select p.role from public.v2_profiles p
  where p.user_id = auth.uid()
    and (not exists (select 1 from public.v2_member_accounts a where a.user_id = p.user_id)
         or exists (select 1 from public.v2_member_accounts a join public.v2_members m on m.id = a.member_id
                    where a.user_id = p.user_id and m.status = 'active' and a.last_login_at > now() - interval '30 days'))
$$;

create or replace function public.v2__require_login() returns boolean
language sql stable security definer set search_path = '' as $$ select coalesce(public.v2__setting('require_login'), 'off') = 'on' $$;
revoke all on function public.v2__require_login() from public, anon, authenticated;

create or replace function public.v2__my_member() returns uuid
language sql stable security definer set search_path = '' as $$
  select a.member_id from public.v2_member_accounts a join public.v2_members m on m.id = a.member_id
  where a.user_id = auth.uid() and m.status = 'active' and a.last_login_at > now() - interval '30 days'
$$;
revoke all on function public.v2__my_member() from public, anon, authenticated;

-- 'open' (switch is off), 'staff', 'member', 'guest', or null (not allowed in)
create or replace function public.v2__viewer() returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.v2__require_login() then return 'open'; end if;
  if auth.uid() is null then return null; end if;
  if public.v2_is_staff() then return 'staff'; end if;
  if public.v2__my_member() is not null then return 'member'; end if;
  if exists (select 1 from public.v2_guest_codes g where g.user_id = auth.uid() and not g.revoked and g.expires_at > now()) then return 'guest'; end if;
  return null;
end $$;
revoke all on function public.v2__viewer() from public, anon, authenticated;

-- The app asks this first: is sign-in required, and is this visitor allowed in?
create or replace function public.v2_gate() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('require', public.v2__require_login(), 'viewer', public.v2__viewer())
$$;
grant execute on function public.v2_gate() to anon, authenticated;

create or replace function public.v2_whoami() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u uuid := auth.uid(); p public.v2_profiles; mid uuid; g public.v2_guest_codes; m public.v2_members;
begin
  if u is null then return jsonb_build_object('kind', 'none'); end if;
  select * into p from public.v2_profiles where user_id = u;
  if p.user_id is not null then
    if p.role = 'pending' then return jsonb_build_object('kind', 'pending', 'name', p.full_name); end if;
    if public.v2_role() is not null then
      select m2.* into m from public.v2_member_accounts a join public.v2_members m2 on m2.id = a.member_id where a.user_id = u;
      return jsonb_build_object('kind', 'officer', 'name', p.full_name, 'role', p.role, 'member_id', m.id, 'linked', m.id is not null);
    end if;
    return jsonb_build_object('kind', 'none', 'reason', 'expired');   -- linked officer who has not typed their PIN for 30 days
  end if;
  mid := public.v2__my_member();
  if mid is not null then select * into m from public.v2_members where id = mid; return jsonb_build_object('kind', 'student', 'name', m.full_name, 'member_id', mid); end if;
  select * into g from public.v2_guest_codes where user_id = u and not revoked and expires_at > now();
  if g.id is not null then return jsonb_build_object('kind', 'guest', 'name', g.label, 'expires_at', g.expires_at); end if;
  return jsonb_build_object('kind', 'none', 'reason', 'expired');
end $$;
grant execute on function public.v2_whoami() to authenticated;

-- A signed-in student's own QR code, so My Status works on any phone without scanning
create or replace function public.v2_my_token() returns text
language plpgsql stable security definer set search_path = '' as $$
declare mid uuid := public.v2__my_member(); m public.v2_members;
begin
  if mid is null then raise exception 'Sign in first'; end if;
  select * into m from public.v2_members where id = mid;
  if m.token_revoked then raise exception 'Your QR card was replaced. Ask the Treasurer for your new card'; end if;
  return public.v2__token_for(mid);
end $$;
grant execute on function public.v2_my_token() to authenticated;

-- ===========================================================================
-- 4. The open pages now check the visitor. Each existing function is kept (renamed v2__orig_*) and wrapped.
--    While the switch is OFF the wrapper returns exactly what the old function returned. Safe to re-run.
-- ===========================================================================
do $do$
declare f text; rt text; empty text;
begin
  for f, rt, empty in values
    ('v2_public_treasury','jsonb',null), ('v2_public_standing','jsonb',$$'[]'::jsonb$$), ('v2_public_violations','jsonb',$$'[]'::jsonb$$),
    ('v2_public_announcements','jsonb',null), ('v2_public_officers','jsonb',null), ('v2_public_progress','jsonb',null),
    ('v2_public_pay_note','text',$$''::text$$), ('v2_leaderboard','jsonb',$$'[]'::jsonb$$)
  loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='v2__orig_'||substr(f,4)) then
      execute format('alter function public.%I() rename to %I', f, 'v2__orig_'||substr(f,4));
    end if;
    execute format('revoke all on function public.%I() from public, anon, authenticated', 'v2__orig_'||substr(f,4));
    execute format($fn$create or replace function public.%1$I() returns %2$s language plpgsql stable security definer set search_path = '' as $b$
      declare v text := public.v2__viewer();
      begin
        if v is null then raise exception 'Sign in required' using errcode = '28000'; end if;
        %3$s
        return public.%4$I();
      end $b$$fn$, f, rt,
      case when empty is not null then format('if v = ''guest'' then return %s; end if;', empty) else '' end,
      'v2__orig_'||substr(f,4));
    execute format('grant execute on function public.%I() to anon, authenticated', f);
  end loop;
end $do$;

-- Guests see fund totals but not the line-by-line list of who paid
create or replace function public.v2_public_treasury() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v text := public.v2__viewer(); r jsonb;
begin
  if v is null then raise exception 'Sign in required' using errcode = '28000'; end if;
  r := public.v2__orig_public_treasury();
  if v = 'guest' then r := r - 'entries'; end if;
  return r;
end $$;
grant execute on function public.v2_public_treasury() to anon, authenticated;

do $do$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='v2__orig_submit_score') then
    alter function public.v2_submit_score(text, integer) rename to v2__orig_submit_score;
  end if;
end $do$;
revoke all on function public.v2__orig_submit_score(text, integer) from public, anon, authenticated;
create or replace function public.v2_submit_score(p_nick text, p_points integer) returns void
language plpgsql security definer set search_path = '' as $$
declare v text := public.v2__viewer();
begin
  if v is null or v = 'guest' then raise exception 'Sign in required' using errcode = '28000'; end if;
  perform public.v2__orig_submit_score(p_nick, p_points);
end $$;
grant execute on function public.v2_submit_score(text, integer) to anon, authenticated;

-- ===========================================================================
-- 5. The switch (Mayor only)
-- ===========================================================================
create or replace function public.v2_set_setting(p_key text, p_value text) returns void
language plpgsql security definer set search_path = '' as $$
declare v text := btrim(coalesce(p_value, ''));
begin
  if p_key = 'pay_note' then
    if not public.v2_has_role('mayor', 'treasurer') then raise exception 'Only the Mayor or Treasurer can change this'; end if;
    if length(v) > 300 then raise exception 'Keep the payment note under 300 characters'; end if;
  elsif p_key = 'expense_second_approval' then
    if not public.v2_has_role('mayor') then raise exception 'Only the Mayor can change this'; end if;
    if v !~ '^\d{1,7}(\.\d{1,2})?$' then raise exception 'Enter an amount in pesos (0 turns the rule off)'; end if;
  elsif p_key in ('auto_nudge', 'require_login') then
    if not public.v2_has_role('mayor') then raise exception 'Only the Mayor can change this'; end if;
    if v not in ('on', 'off') then raise exception 'Use on or off'; end if;
  else raise exception 'Unknown setting'; end if;
  insert into public.v2_settings(key, value) values (p_key, v) on conflict (key) do update set value = excluded.value;
  if p_key = 'require_login' then
    insert into public.v2_audit(actor, actor_name, action, table_name, row_id, new_row)
      values (auth.uid(), (select full_name from public.v2_profiles where user_id = auth.uid()), 'SETTING', 'v2_settings', p_key, jsonb_build_object('value', v));
  end if;
end $$;
revoke all on function public.v2_set_setting(text, text) from public, anon;
grant execute on function public.v2_set_setting(text, text) to authenticated;

-- How ready is the class? (Mayor and Vice Mayor)
create or replace function public.v2_login_stats() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.v2_has_role('mayor', 'vice_mayor') then raise exception 'Not allowed'; end if;
  return jsonb_build_object('active', (select count(*) from public.v2_members where status = 'active'),
    'with_pin', (select count(*) from public.v2_member_pins p join public.v2_members m on m.id = p.member_id where m.status = 'active'),
    'signed_in_30d', (select count(*) from public.v2_member_accounts a join public.v2_members m on m.id = a.member_id where m.status = 'active' and a.last_login_at > now() - interval '30 days'),
    'no_id', (select count(*) from public.v2_members where status = 'active' and (student_no is null or student_no ~* '^pending')),
    'require', public.v2__require_login());
end $$;
grant execute on function public.v2_login_stats() to authenticated;

-- ===========================================================================
-- 6. Officers: the Mayor links an existing officer account to a student record
-- ===========================================================================
create or replace function public.v2_link_officer(p_user uuid, p_member uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare nm text;
begin
  if not public.v2_has_role('mayor') then raise exception 'Only the Mayor can link an officer to a student'; end if;
  if not exists (select 1 from public.v2_profiles where user_id = p_user) then raise exception 'Unknown officer account'; end if;
  if not exists (select 1 from public.v2_members where id = p_member and status = 'active') then raise exception 'Pick an active student'; end if;
  if exists (select 1 from public.v2_member_accounts where member_id = p_member and user_id <> p_user) then raise exception 'That student already has another account linked'; end if;
  delete from public.v2_member_accounts where user_id = p_user and member_id <> p_member;
  -- 30 days of grace: the officer keeps working with their current sign-in while they set up their PIN
  insert into public.v2_member_accounts(member_id, user_id, kind, last_login_at) values (p_member, p_user, 'officer', now())
    on conflict (member_id) do update set kind = 'officer';
  select full_name into nm from public.v2_profiles where user_id = auth.uid();
  insert into public.v2_audit(actor, actor_name, action, table_name, row_id) values (auth.uid(), nm, 'LINK', 'v2_member_accounts', p_user::text);
end $$;
revoke all on function public.v2_link_officer(uuid, uuid) from public, anon;
grant execute on function public.v2_link_officer(uuid, uuid) to authenticated;

create or replace function public.v2_unlink_officer(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.v2_has_role('mayor') then raise exception 'Only the Mayor can unlink an officer'; end if;
  delete from public.v2_member_accounts where user_id = p_user and kind = 'officer';
end $$;
revoke all on function public.v2_unlink_officer(uuid) from public, anon;
grant execute on function public.v2_unlink_officer(uuid) to authenticated;

create or replace function public.v2_officer_links() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.v2_has_role('mayor', 'vice_mayor') then raise exception 'Not allowed'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('user_id', a.user_id, 'member_id', a.member_id, 'member_name', m.full_name, 'last_login_at', a.last_login_at,
      'has_pin', exists (select 1 from public.v2_member_pins p where p.member_id = a.member_id))), '[]'::jsonb)
    from public.v2_member_accounts a join public.v2_members m on m.id = a.member_id where a.kind = 'officer');
end $$;
grant execute on function public.v2_officer_links() to authenticated;

-- ===========================================================================
-- 7. Guest codes (Mayor)
-- ===========================================================================
create or replace function public.v2_guest_create(p_label text, p_days int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; raw bytea := extensions.gen_random_bytes(10); code text := ''; i int; nm text; exp timestamptz;
begin
  if not public.v2_has_role('mayor') then raise exception 'Only the Mayor can make guest codes'; end if;
  if length(btrim(coalesce(p_label, ''))) < 2 then raise exception 'Say who the code is for'; end if;
  if p_days is null or p_days < 1 or p_days > 30 then raise exception 'Choose 1 to 30 days'; end if;
  for i in 0..9 loop code := code || substr(alphabet, (get_byte(raw, i) % 32) + 1, 1); end loop;
  exp := now() + make_interval(days => p_days);
  select full_name into nm from public.v2_profiles where user_id = auth.uid();
  insert into public.v2_guest_codes(label, code_hash, expires_at, created_by, created_by_name)
    values (btrim(p_label), encode(extensions.digest(code, 'sha256'), 'hex'), exp, auth.uid(), nm);
  insert into public.v2_audit(actor, actor_name, action, table_name, row_id) values (auth.uid(), nm, 'GUEST_CODE', 'v2_guest_codes', btrim(p_label));
  return jsonb_build_object('code', substr(code, 1, 5) || '-' || substr(code, 6, 5), 'expires_at', exp);   -- shown once; only a scrambled copy is kept
end $$;
revoke all on function public.v2_guest_create(text, int) from public, anon;
grant execute on function public.v2_guest_create(text, int) to authenticated;

create or replace function public.v2_guest_list() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.v2_has_role('mayor', 'vice_mayor') then raise exception 'Not allowed'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'label', label, 'expires_at', expires_at, 'revoked', revoked,
      'active', (not revoked and expires_at > now()), 'last_used_at', last_used_at, 'created_by_name', created_by_name) order by created_at desc), '[]'::jsonb)
    from public.v2_guest_codes);
end $$;
grant execute on function public.v2_guest_list() to authenticated;

create or replace function public.v2_guest_revoke(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.v2_has_role('mayor') then raise exception 'Only the Mayor can cancel a guest code'; end if;
  update public.v2_guest_codes set revoked = true where id = p_id;
end $$;
revoke all on function public.v2_guest_revoke(uuid) from public, anon;
grant execute on function public.v2_guest_revoke(uuid) to authenticated;

-- ===========================================================================
-- 8. Only the sign-in function (service role) may check PINs and create sessions
-- ===========================================================================
revoke execute on function public.v2_pin_login(text, text) from public, anon, authenticated;
revoke execute on function public.v2_pin_setup(text, text, text) from public, anon, authenticated;

create or replace function public.v2__account_for(p_member uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select (select jsonb_build_object('user_id', a.user_id, 'email', u.email) from public.v2_member_accounts a join auth.users u on u.id = a.user_id where a.member_id = p_member)
$$;
create or replace function public.v2__link_account(p_member uuid, p_user uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.v2_member_accounts(member_id, user_id, kind, last_login_at) values (p_member, p_user, 'student', now())
  on conflict (member_id) do update set last_login_at = now()
$$;
create or replace function public.v2__touch_login(p_member uuid) returns void
language sql security definer set search_path = '' as $$ update public.v2_member_accounts set last_login_at = now() where member_id = p_member $$;
create or replace function public.v2__guest_check(p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare g public.v2_guest_codes; h text := encode(extensions.digest(upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')), 'sha256'), 'hex');
begin
  select * into g from public.v2_guest_codes where code_hash = h and not revoked and expires_at > now();
  if g.id is null then return jsonb_build_object('ok', false); end if;
  update public.v2_guest_codes set last_used_at = now() where id = g.id;
  return jsonb_build_object('ok', true, 'id', g.id, 'user_id', g.user_id, 'label', g.label,
    'email', (select email from auth.users where id = g.user_id));
end $$;
create or replace function public.v2__guest_set_user(p_id uuid, p_user uuid) returns void
language sql security definer set search_path = '' as $$ update public.v2_guest_codes set user_id = p_user where id = p_id $$;

revoke all on function public.v2__account_for(uuid), public.v2__link_account(uuid, uuid), public.v2__touch_login(uuid),
  public.v2__guest_check(text), public.v2__guest_set_user(uuid, uuid) from public, anon, authenticated;
grant execute on function public.v2_pin_login(text, text), public.v2_pin_setup(text, text, text), public.v2__account_for(uuid),
  public.v2__link_account(uuid, uuid), public.v2__touch_login(uuid), public.v2__guest_check(text), public.v2__guest_set_user(uuid, uuid) to service_role;

-- ===========================================================================
-- Then, in Supabase:
--   1. Edge Functions → New function "student-auth" → paste supabase/functions/student-auth/index.ts → Deploy (Verify JWT OFF).
--   2. Authentication → Sign In / Providers → turn OFF "Allow new users to sign up" (the app now creates accounts itself).
--   3. Leave "Require sign-in" OFF until most students have set a PIN (System tab shows how many).
-- ===========================================================================
