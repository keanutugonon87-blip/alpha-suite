import { createClient } from 'npm:@supabase/supabase-js@2';

// Called by pg_cron every Monday 3 AM (Manila) and by the "Back up now" button (shared secret in x-hook-secret).
// Writes one JSON file with every record to the private "v2-backups" bucket and keeps the newest 12 files.
// Not included on purpose: login secrets and student PINs (v2_secrets, v2_member_pins), push-device keys, guest codes, the login and backup logs,
// and inline photos (receipt and progress-report photos are replaced by a note; uploaded document files stay in their own bucket).
const TABLES = [
  // the class money and discipline records
  'v2_members', 'v2_periods', 'v2_charges', 'v2_entries', 'v2_violations', 'v2_standards', 'v2_officers', 'v2_officer_edits',
  'v2_announcements', 'v2_settings', 'v2_month_close', 'v2_waivers', 'v2_quiz_scores', 'v2_reminders', 'v2_profiles', 'v2_audit',
  'v2_budgets', 'v2_budget_requests', 'v2_liquidations', 'v2_promises', 'v2_events', 'v2_event_scans', 'v2_faq', 'v2_trash',
  // the SAILS chain of command: directives, class reports and requests, council, memos, office records, calendar, units and seats
  'v2_directives', 'v2_directive_templates', 'v2_class_reports', 'v2_class_asks', 'v2_class_ask_photos', 'v2_desk_receipts',
  'v2_council_meetings', 'v2_council_actions', 'v2_council_attendance', 'v2_memos', 'v2_memo_acks', 'v2_office_records', 'v2_record_requests',
  'v2_coa', 'v2_decisions', 'v2_deputy', 'v2_units', 'v2_seat_types', 'v2_seat_holders', 'v2_member_accounts',
  'v2_vp_activities', 'v2_vp_council', 'v2_vp_delegations', 'v2_vp_meetings', 'v2_vp_partners', 'v2_vp_reps', 'v2_vp_resolutions', 'v2_vp_tasks',
  // marshals and inspection
  'v2_marshal_blocks', 'v2_marshal_incidents', 'v2_marshal_requests', 'v2_inspections',
  // duties, escalations, approvals, documents (the file records; the files stay in their own bucket), admin log
  'v2_duty_log', 'v2_duty_sent', 'v2_duty_templates', 'v2_escalations', 'v2_approval_nudges', 'v2_approval_questions',
  'v2_documents', 'v2_doc_folders', 'v2_doc_files', 'v2_admin_log', 'v2_role_log', 'v2_sql_applied',
  // the older app
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
      if (error) { if (!/does not exist|schema cache/i.test(error.message)) errors[t] = error.message; break; }   // a table from a newer SQL file that is not installed yet is skipped, not an error
      rows.push(...(data ?? [])); if (!data || data.length < 1000) break;
    }
    for (const r of rows) for (const k of ['receipt_image', 'image']) if (typeof r[k] === 'string' && (r[k] as string).startsWith('data:')) r[k] = '[inline photo omitted]';
    out[t] = rows;
  }
  const now = new Date();
  const stamp = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .format(now).replace(', ', '-').replace(':', '');
  const name = `alpha28-backup-${stamp}.json`;
  const body = JSON.stringify({ app: 'Alpha ’28', created_at: now.toISOString(), counts: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length])), errors, tables: out });
  const up = await db.storage.from('v2-backups').upload(name, new Blob([body], { type: 'application/json' }), { upsert: true, contentType: 'application/json' });
  if (up.error) { await db.from('v2_backup_log').insert({ ok: false, name, errors: { upload: up.error.message }, note: 'upload failed' }); return new Response(JSON.stringify({ ok: false, error: up.error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } }); }

  // Check the file we just wrote: download it, read it back, and compare it with the database (row counts and the total of every entry).
  let verified = false, vnote = '';
  try {
    const dl = await db.storage.from('v2-backups').download(name);
    if (dl.error) throw new Error('could not read the file back: ' + dl.error.message);
    const parsed = JSON.parse(await dl.data.text());
    const short = Object.entries(out).filter(([t, rows]) => (parsed.tables?.[t]?.length ?? -1) !== rows.length).map(([t]) => t);
    if (short.length) throw new Error('the file is missing rows in: ' + short.join(', '));
    const sumOf = (rows: Record<string, unknown>[]) => Math.round(rows.reduce((a, r) => a + Number(r.amount ?? 0), 0) * 100) / 100;
    const fileRows = (parsed.tables?.v2_entries ?? []) as Record<string, unknown>[];
    for (let attempt = 0; attempt < 2 && !verified; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 2500));   // an entry saved during the check: look again once
      const live: Record<string, unknown>[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await db.from('v2_entries').select('amount').range(from, from + 999);
        if (error) throw new Error('could not read the database: ' + error.message);
        live.push(...(data ?? [])); if (!data || data.length < 1000) break;
      }
      if (live.length === fileRows.length && sumOf(live) === sumOf(fileRows)) { verified = true; vnote = `File reads back correctly. ${fileRows.length} entries, total ${sumOf(fileRows).toFixed(2)}, match the database.`; }
      else vnote = `Entries differ: file has ${fileRows.length} (total ${sumOf(fileRows).toFixed(2)}), database has ${live.length} (total ${sumOf(live).toFixed(2)}).`;
    }
  } catch (e) { vnote = (e as Error).message; }

  const { data: files } = await db.storage.from('v2-backups').list('', { limit: 200, sortBy: { column: 'name', order: 'desc' } });
  const old = (files ?? []).filter((f) => f.name.startsWith('alpha28-backup-')).slice(KEEP).map((f) => f.name);
  if (old.length) await db.storage.from('v2-backups').remove(old);
  await db.from('v2_backup_log').insert({ ok: Object.keys(errors).length === 0, name, bytes: body.length, errors: Object.keys(errors).length ? errors : null, note: old.length ? `removed ${old.length} old` : null, verified, verify_note: vnote });
  return new Response(JSON.stringify({ ok: true, name, bytes: body.length, removed: old.length, errors, verified, vnote }), { headers: { 'Content-Type': 'application/json' } });
});
