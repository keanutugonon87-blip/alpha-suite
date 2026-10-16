import { createClient } from 'npm:@supabase/supabase-js@2';

// Alpha ’28 sign-in. The app calls this with { action: 'login' | 'setup' | 'guest', ... }.
// It checks the Student ID + PIN (or QR card + new PIN, or guest code) with the database, then returns a one-time
// sign-in token. The app trades that token for a normal Supabase session. Nobody can sign in without passing the checks here.
// Deploy with "Verify JWT" OFF (visitors are not signed in yet).
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, authorization, apikey, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405);
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch { return json({ ok: false, error: 'bad_request' }, 400); }
  const s = (k: string) => (typeof b[k] === 'string' ? (b[k] as string).slice(0, 400) : '');

  // Turns "this person passed the checks" into a one-time sign-in token for the app
  const session = async (email: string) => {
    const { data, error } = await db.auth.admin.generateLink({ type: 'magiclink', email });
    const th = data?.properties?.hashed_token;
    if (error || !th) return json({ ok: false, error: 'server' }, 500);
    return th;
  };

  try {
    if (b.action === 'login' || b.action === 'setup') {
      const r = b.action === 'login'
        ? await db.rpc('v2_pin_login', { p_student_no: s('student_no'), p_pin: s('pin') })
        : await db.rpc('v2_pin_setup', { p_student_no: s('student_no'), p_token: s('token'), p_pin: s('pin') });
      if (r.error) return json({ ok: false, error: 'server' }, 500);
      const res = r.data as { ok: boolean; token?: string };
      if (!res?.ok) return json(res);
      const member = String(res.token).split('.')[1];             // QR code format: A1.<member id>.<version>.<signature>
      const acc = (await db.rpc('v2__account_for', { p_member: member })).data as { user_id: string; email: string } | null;
      let email = acc?.email;
      if (!acc) {
        email = `${member}@students.alpha28.invalid`;
        const c = await db.auth.admin.createUser({ email, email_confirm: true, user_metadata: { alpha_kind: 'student' } });
        let uid = c.data?.user?.id;
        if (!uid) {                                                // account exists in Auth but is not linked yet (an earlier attempt stopped halfway)
          const l = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
          uid = l.data?.users?.find((u) => u.email === email)?.id;
        }
        if (!uid) return json({ ok: false, error: 'server' }, 500);
        const k = await db.rpc('v2__link_account', { p_member: member, p_user: uid });
        if (k.error) return json({ ok: false, error: 'server' }, 500);
      } else {
        await db.rpc('v2__touch_login', { p_member: member });
      }
      const th = await session(email!);
      if (th instanceof Response) return th;
      return json({ ok: true, token_hash: th, token: res.token });
    }

    if (b.action === 'guest') {
      const g = (await db.rpc('v2__guest_check', { p_code: s('code') })).data as { ok: boolean; id: string; user_id: string | null; email: string | null } | null;
      if (!g?.ok) return json({ ok: false, error: 'bad' });
      let email = g.email;
      if (!g.user_id) {
        email = `guest-${g.id}@guests.alpha28.invalid`;
        const c = await db.auth.admin.createUser({ email, email_confirm: true, user_metadata: { alpha_kind: 'guest' } });
        if (!c.data?.user?.id) return json({ ok: false, error: 'server' }, 500);
        await db.rpc('v2__guest_set_user', { p_id: g.id, p_user: c.data.user.id });
      }
      const th = await session(email!);
      if (th instanceof Response) return th;
      return json({ ok: true, token_hash: th });
    }
    return json({ ok: false, error: 'bad_request' }, 400);
  } catch (_e) {
    return json({ ok: false, error: 'server' }, 500);
  }
});
