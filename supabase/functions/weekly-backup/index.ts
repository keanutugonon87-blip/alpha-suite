import { createClient } from 'npm:@supabase/supabase-js@2';

// Called by pg_cron every Monday 3 AM (Manila) and by the "Back up now" button (shared secret in x-hook-secret).
// Writes one JSON file with every record to the private "v2-backups" bucket and keeps the newest 12 files.
// Not included on purpose: login secrets, push-device keys, and inline receipt photos (photo files stay in their own bucket).
const TABLES = ['v2_members', 'v2_periods', 'v2_charges', 'v2_entries', 'v2_violations', 'v2_standards', 'v2_officers', 'v2_officer_edits',
  'v2_announcements', 'v2_settings', 'v2_quiz_scores', 'v2_reminders', 'v2_profiles', 'v2_audit',
  'students', 'transactions', 'audit_log', 'shared_data', 'officer_roles', 'dues_config'];
const KEEP = 12;

Deno.serve(async (req) => {
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: sec } = await db.from('v2_secrets').select('key,value').eq('key', 'push_hook');
  const dec = (v: string) => { const s = String(v); return s.startsWith('\\x') ? new TextDecoder().decode(Uint8Array.from(s.slice(2).match(/../g)!.map((h) => parseInt(h, 16)))) : s; };
  const hook = dec(sec?.[0]?.value ?? '');
  if (req.method !== 'POST' || !hook || req.headers.get('x-hook-secret') !== hook) return new Response('forbidden', { status: 403 });

  const out: Record<string, unknown[]> = {}; const errors: Record<string, string> = {};
  for (const t of TABLES) {
    const rows: Record<string, unknown>[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from(t).select('*').range(from, from + 999);
      if (error) { errors[t] = error.message; break; }
      rows.push(...(data ?? [])); if (!data || data.length < 1000) break;
    }
    for (const r of rows) if (typeof r.receipt_image === 'string' && r.receipt_image.startsWith('data:')) r.receipt_image = '[inline photo omitted]';
    out[t] = rows;
  }
  const now = new Date();
  const stamp = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .format(now).replace(', ', '-').replace(':', '');
  const name = `alpha28-backup-${stamp}.json`;
  const body = JSON.stringify({ app: 'Alpha ’28', created_at: now.toISOString(), counts: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length])), errors, tables: out });
  const up = await db.storage.from('v2-backups').upload(name, new Blob([body], { type: 'application/json' }), { upsert: true, contentType: 'application/json' });
  if (up.error) return new Response(JSON.stringify({ ok: false, error: up.error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  const { data: files } = await db.storage.from('v2-backups').list('', { limit: 200, sortBy: { column: 'name', order: 'desc' } });
  const old = (files ?? []).filter((f) => f.name.startsWith('alpha28-backup-')).slice(KEEP).map((f) => f.name);
  if (old.length) await db.storage.from('v2-backups').remove(old);
  return new Response(JSON.stringify({ ok: true, name, bytes: body.length, removed: old.length, errors }), { headers: { 'Content-Type': 'application/json' } });
});
