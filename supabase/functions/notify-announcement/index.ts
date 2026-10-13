import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

// Called only by database functions/triggers (shared secret in the x-hook-secret header).
//   kind 'signup'   -> Mayor / Vice Mayor devices only.
//   kind 'reminder' -> one personal message per student: items = [{ member_id, title, body }], sent only to that student's linked devices.
//   anything else   -> a new public notice, sent to every subscribed device.
Deno.serve(async (req) => {
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: sec, error: se } = await db.from('v2_secrets').select('key,value').in('key', ['vapid_public', 'vapid_private', 'push_hook']);
  if (se || !sec) return new Response('config error', { status: 500 });
  const dec = (v: string) => { const s = String(v); return s.startsWith('\\x') ? new TextDecoder().decode(Uint8Array.from(s.slice(2).match(/../g)!.map((h) => parseInt(h, 16)))) : s; };
  const get = (k: string) => dec(sec.find((r) => r.key === k)?.value ?? '');
  if (req.method !== 'POST' || req.headers.get('x-hook-secret') !== get('push_hook')) return new Response('forbidden', { status: 403 });

  let note: { kind?: string; title?: string; body?: string; items?: { member_id: string; title?: string; body?: string }[] };
  try { note = await req.json(); } catch { return new Response('bad request', { status: 400 }); }
  webpush.setVapidDetails('https://keanutugonon87-blip.github.io/alpha-suite/', get('vapid_public'), get('vapid_private'));

  type Sub = { endpoint: string; p256dh: string; auth: string };
  let sent = 0, gone = 0, failed = 0;
  const push = async (s: Sub, payload: string) => {
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400 }); sent++; }
    catch (e) { const code = (e as { statusCode?: number }).statusCode; if (code === 404 || code === 410) { gone++; await db.from('v2_push_subs').delete().eq('endpoint', s.endpoint); } else failed++; }
  };

  if (note.kind === 'reminder') {
    const items = (note.items ?? []).filter((i) => i && i.member_id);
    const ids = items.map((i) => i.member_id);
    const { data } = ids.length ? await db.from('v2_push_subs').select('endpoint,p256dh,auth,member_id').in('member_id', ids) : { data: [] };
    const subs = (data ?? []) as (Sub & { member_id: string })[];
    await Promise.all(subs.map((s) => {
      const it = items.find((i) => i.member_id === s.member_id)!;
      return push(s, JSON.stringify({ title: String(it.title ?? 'Payment reminder').slice(0, 120), body: String(it.body ?? '').slice(0, 200), url: './' }));
    }));
    return new Response(JSON.stringify({ sent, gone, failed }), { headers: { 'Content-Type': 'application/json' } });
  }

  const signup = note.kind === 'signup';
  let subs: Sub[] = [];
  if (signup) {
    const { data: staff } = await db.from('v2_profiles').select('user_id').in('role', ['mayor', 'vice_mayor']);
    const ids = (staff ?? []).map((s) => s.user_id);
    if (ids.length) { const { data } = await db.from('v2_push_subs').select('endpoint,p256dh,auth').in('user_id', ids); subs = data ?? []; }
  } else {
    const { data } = await db.from('v2_push_subs').select('endpoint,p256dh,auth'); subs = data ?? [];
  }
  const payload = JSON.stringify({ title: String(note.title ?? 'New notice').slice(0, 120), body: String(note.body ?? '').slice(0, 160), url: signup ? './#/staff/accounts' : './' });
  await Promise.all(subs.map((s) => push(s, payload)));
  return new Response(JSON.stringify({ sent, gone, failed }), { headers: { 'Content-Type': 'application/json' } });
});
