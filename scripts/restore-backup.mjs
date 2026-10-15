#!/usr/bin/env node
/* Restore records from an Alpha ’28 weekly backup file.
 *
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/restore-backup.mjs alpha28-backup-2026-10-14-0809.json            (look only)
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/restore-backup.mjs alpha28-backup-....json --apply                 (write)
 *   ... --tables v2_members,v2_entries      only these tables
 *
 * What it does:  compares the file with the live database, table by table, and reports rows that are missing or different.
 *                With --apply it puts the missing and different rows back (an upsert by primary key).
 * What it never does:  delete anything, touch the audit log, or restore login accounts (v2_profiles) unless you name them with --tables.
 * Receipt photos that were left out of the backup stay as they are in the database.
 * The service-role key is in Supabase > Project Settings > API. Keep it secret. It is only read from the environment, never saved.
 * Run it from the project folder after `npm install` (it uses @supabase/supabase-js).
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2), file = args.find(a => !a.startsWith('--')), apply = args.includes('--apply');
const only = (args.find(a => a.startsWith('--tables=')) || '').slice(9) || (args.includes('--tables') ? args[args.indexOf('--tables') + 1] : '');
const URL = process.env.SUPABASE_URL || 'https://gxwgkbplscsduscoeoph.supabase.co', KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!file || !KEY) { console.error('Usage: SUPABASE_SERVICE_ROLE_KEY=... node scripts/restore-backup.mjs <backup.json> [--apply] [--tables a,b]'); process.exit(1); }

// Parents before children so foreign keys are satisfied. The audit log is history and is never restored.
const ORDER = ['v2_members', 'v2_periods', 'v2_charges', 'v2_officers', 'v2_standards', 'v2_settings', 'v2_announcements', 'v2_entries', 'v2_violations',
  'v2_quiz_scores', 'v2_officer_edits', 'v2_reminders', 'students', 'transactions', 'shared_data', 'officer_roles', 'dues_config', 'v2_profiles'];
const NEVER = new Set(['v2_audit', 'audit_log']), OPT_IN = new Set(['v2_profiles']), PLACEHOLDER = '[inline photo omitted]';

const backup = JSON.parse(readFileSync(file, 'utf8'));
if (!backup.tables) { console.error('That file does not look like an Alpha ’28 backup.'); process.exit(1); }
const sb = createClient(URL, KEY, { auth: { persistSession: false } });
const wanted = only ? only.split(',').map(s => s.trim()) : ORDER.filter(t => !OPT_IN.has(t));
const same = (a, b) => JSON.stringify(Object.keys(a).sort().map(k => [k, a[k]])) === JSON.stringify(Object.keys(a).sort().map(k => [k, b[k]]));
const norm = (row, live) => { const r = { ...row }; for (const k of Object.keys(r)) if (r[k] === PLACEHOLDER) { if (live && live[k] !== undefined) r[k] = live[k]; else delete r[k]; } return r; };

console.log(`Backup made ${backup.created_at}. Mode: ${apply ? 'APPLY (writing)' : 'look only (nothing is written)'}\n`);
let total = 0;
for (const t of wanted) {
  if (NEVER.has(t)) { console.log(`${t}: skipped (history is never restored)`); continue; }
  const rows = backup.tables[t];
  if (!rows) { console.log(`${t}: not in this backup`); continue; }
  if (!rows.length) { console.log(`${t}: empty in the backup`); continue; }
  const pk = ['id', 'key', 'user_id'].find(k => k in rows[0]);
  if (!pk) { console.log(`${t}: skipped (no id column to match on)`); continue; }
  const live = new Map();
  for (let from = 0; ; from += 1000) { const { data, error } = await sb.from(t).select('*').range(from, from + 999); if (error) { console.log(`${t}: cannot read (${error.message})`); live.clear(); break; } data.forEach(r => live.set(r[pk], r)); if (data.length < 1000) break; }
  if (!live.size && rows.length && false) continue;
  const missing = [], changed = [];
  for (const r of rows) { const l = live.get(r[pk]); if (!l) missing.push(norm(r)); else { const n = norm(r, l); const cmp = Object.fromEntries(Object.keys(n).map(k => [k, l[k]])); if (!same(n, cmp)) changed.push(n); } }
  console.log(`${t}: ${rows.length} in backup · ${rows.length - missing.length - changed.length} identical · ${missing.length} missing from the database · ${changed.length} different`);
  if (!apply || (!missing.length && !changed.length)) continue;
  const todo = [...missing, ...changed];
  for (let i = 0; i < todo.length; i += 200) {
    const { error } = await sb.from(t).upsert(todo.slice(i, i + 200), { onConflict: pk });
    if (error) { console.log(`  ✗ ${t}: ${error.message}\n    (Closed months or other rules may block old rows. Fix that and run again; finished tables are not harmed.)`); break; }
    total += Math.min(200, todo.length - i);
  }
}
console.log(apply ? `\nDone. ${total} rows written.` : '\nNothing was changed. Add --apply to write the missing and different rows.');
