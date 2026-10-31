-- Alpha ’28 · v20 · Scan inspection: Marshals and SAILS officers can scan a student's QR card.
-- Safe to run more than once. Paste all of it into Supabase > SQL Editor > Run.
--
-- v2_resolve_token checks a student's QR code and returns only the name and Student ID. It used to allow just the Mayor and Treasurer.
-- Scan inspection in the Watch screen needs it for everyone who can report violations: Mayor, Vice Mayor, Secretary, Treasurer, Marshal and SAILS officer.
-- The code is still checked against the secret key, so a made-up or revoked card is refused as before.
create or replace function public.v2_resolve_token(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare parts text[]; m public.v2_members; k bytea; good text;
begin
  if not public.v2_has_role('mayor', 'vice_mayor', 'secretary', 'treasurer', 'marshall', 'sails') then raise exception 'Not allowed'; end if;
  parts := string_to_array(p_token, '.');
  if array_length(parts, 1) <> 4 or parts[1] <> 'A1' then raise exception 'Not an Alpha Suite QR code'; end if;
  select * into m from public.v2_members where id = parts[2]::uuid;
  if m.id is null then raise exception 'Unknown student'; end if;
  select value into k from public.v2_secrets where key = 'qr_hmac';
  good := left(encode(extensions.hmac((m.id::text || '.' || parts[3])::bytea, k, 'sha256'), 'hex'), 16);
  if good <> parts[4] then raise exception 'QR code could not be verified'; end if;
  if m.token_revoked or m.token_version::text <> parts[3] then raise exception 'This QR code was revoked or replaced'; end if;
  return jsonb_build_object('id', m.id, 'name', m.full_name, 'student_no', m.student_no);
end $$;
grant execute on function public.v2_resolve_token(text) to authenticated;
