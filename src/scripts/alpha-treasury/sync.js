/* Alpha Treasury — sync.js
   Wires the shared supabase-client.js factory to Treasury's own state,
   STATE_KEY_FOR mapping, and localStorage namespace. This is the only file
   in the app that talks to Supabase directly. */
import { createSupabaseSync } from '../shared/supabase-client.js?v=2';
import { state, STATE_KEY_FOR, SYNC_KEYS } from './state.js?v=4';
import { render, showToast } from './router.js?v=4';

const SUPABASE_URL = 'https://gxwgkbplscsduscoeoph.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd4d2drYnBsc2NzZHVzY29lb3BoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNDA1MjgsImV4cCI6MjEwMjkxNjUyOH0.OViRrNPgfYFOXVvc0R3Cup66KAtC1Pzfh6SETAIkUn0';

// True when this page is loaded inside an <iframe> (e.g. embedded elsewhere)
// — used to hide redundant "Open Alpha Watch" links that would otherwise
// open a second, nested copy of Watch.
export const IS_EMBEDDED = (function () { try { return window.self !== window.top; } catch (e) { return true; } })();

function showToastSafe(msg) { if (state.screen && state.screen !== 'loading') showToast(msg); else console.warn(msg); }

const data = createSupabaseSync({
  url: SUPABASE_URL,
  key: SUPABASE_ANON_KEY,
  storageNamespace: 'alpha-treasury',
  onSaveError: (key, err) => {
    state.syncHealth.lastErrorAt = Date.now();
    state.syncHealth.lastErrorMsg = (err && err.message) || 'Could not reach the server';
    showToastSafe('Sync failed — check your connection and try again');
  },
});

export const sb = data.sb;

// Used only by the Setup screen's safety check before it's allowed to
// create the first Mayor account. Unlike loadShared (which silently
// folds "network error" and "no row yet" into the same fallback value),
// this makes that distinction explicit — Setup needs to know for sure
// whether accounts truly don't exist, versus just failing to reach the
// server, since those two cases call for opposite actions.
// (checkAccountsExistOnServer removed — the treasury_accounts blob it
// guarded no longer exists; officer accounts are Supabase Auth now.)

// Read-only bridge into the newer QR/Supabase-Auth collection system —
// this app never writes here, it just merges these rows into its own
// totals/ledger so a Treasurer only has one place to look. See
// mappedQrCollections() in state.js for how these rows get reshaped.
export async function fetchQrCollections() {
  try {
    const { data: rows, error } = await sb.from('qr_collections_public').select('*');
    if (error) throw error;
    return rows || [];
  } catch (e) {
    console.error('fetchQrCollections failed', e);
    return [];
  }
}

// Removes a scanned payment from the new system. Needs the officer to have
// an active Supabase Auth session (from signing in at officer-login.html —
// that session is shared across this whole site since it's the same
// Supabase project/origin) and to be listed in officer_roles, since RLS
// enforces that server-side regardless of what this function tries to do.
export async function deleteQrCollection(rawId) {
  const id = rawId.replace(/^qr_/, '');

  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    throw new Error('You\'re not signed in here yet — open officer-login.html once on this device/browser, sign in as Mayor, then come back and try again.');
  }

  const { data: txn, error: fetchErr } = await sb
    .from('transactions')
    .select('id, amount, dues_instance_id')
    .eq('id', id)
    .maybeSingle();
  if (fetchErr) throw new Error(fetchErr.message);
  if (!txn) throw new Error('Payment not found — either it was already removed, or your officer role hasn\'t been assigned yet (ask the Mayor to check officer_roles).');

  if (txn.dues_instance_id) {
    const { data: instance } = await sb
      .from('dues_instances')
      .select('amount_due, amount_paid')
      .eq('id', txn.dues_instance_id)
      .maybeSingle();
    if (instance) {
      const newPaid = Math.max(0, Number(instance.amount_paid) - Number(txn.amount));
      const newStatus = newPaid >= Number(instance.amount_due) ? 'paid' : newPaid > 0 ? 'partial' : 'pending';
      await sb.from('dues_instances').update({ amount_paid: newPaid, status: newStatus, updated_at: new Date().toISOString() }).eq('id', txn.dues_instance_id);
    }
  }

  const { data: deletedRows, error: delErr } = await sb.from('transactions').delete().eq('id', id).select();
  if (delErr) throw new Error(delErr.message);
  if (!deletedRows || deletedRows.length === 0) {
    throw new Error('Nothing was deleted — you may need to sign in at officer-login.html first (your Mayor role there is what allows this).');
  }

  await sb.from('audit_log').insert({
    actor_id: user?.id || null,
    action: 'delete_payment',
    target_type: 'transaction',
    target_id: id,
    details: { amount: txn.amount, removed_from: 'alpha-treasury-ledger' },
  });
}
export const loadShared = data.loadShared;

/* ---- Sync health -------------------------------------------------
   The underlying saveShared swallows errors (it just calls onSaveError),
   so wrap both write paths to record what actually happened. The topbar
   chip reads state.syncHealth — see syncChipHTML() in screens.js. */
function markSyncOk() {
  state.syncHealth.lastOkAt = Date.now();
  state.syncHealth.lastErrorAt = null;
  state.syncHealth.lastErrorMsg = null;
}
function markSyncFailed(msg) {
  state.syncHealth.lastErrorAt = Date.now();
  state.syncHealth.lastErrorMsg = msg || 'Could not reach the server';
}
// Verifies a write actually landed, rather than trusting a silent success.
async function confirmWrite(key) {
  try {
    const { error } = await sb.from('shared_data').select('key').eq('key', key).maybeSingle();
    if (error) throw error;
    markSyncOk();
    return true;
  } catch (e) {
    markSyncFailed(e.message);
    return false;
  }
}

const _saveShared = data.saveShared;
const _mutateShared = data.makeMutateShared(state, STATE_KEY_FOR);

export async function saveShared(key, value) {
  state.syncHealth.saving = true;
  try { await _saveShared(key, value); await confirmWrite(key); }
  finally { state.syncHealth.saving = false; }
}
export async function mutateShared(key, fn) {
  state.syncHealth.saving = true;
  try { const r = await _mutateShared(key, fn); await confirmWrite(key); return r; }
  finally { state.syncHealth.saving = false; }
}
export async function retrySync() {
  try {
    const { error } = await sb.from('shared_data').select('key').eq('key', 'treasury_transactions').maybeSingle();
    if (error) throw error;
    markSyncOk();
    return true;
  } catch (e) {
    markSyncFailed(e.message);
    return false;
  }
}

/* ---- Officer accounts, now on Supabase Auth instead of the classic
   treasury_accounts blob. One row per person in officer_roles, real
   sessions, no way for one save to clobber everyone else's account. ---- */
export async function fetchOfficerRoles() {
  try {
    const { data, error } = await sb.from('officer_roles').select('user_id, role, full_name, email').order('created_at');
    if (error) throw error;
    return data || [];
  } catch (e) {
    console.error('fetchOfficerRoles failed', e);
    return [];
  }
}
export async function getCurrentAuthUser() {
  try {
    const { data: { user } } = await sb.auth.getUser();
    return user || null;
  } catch (e) {
    return null;
  }
}
export async function officerSignIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error('Email or password is incorrect.');
  return data.user;
}
export async function officerSignUp({ email, password, fullName }) {
  const { data, error } = await sb.auth.signUp({ email, password, options: { data: { full_name: fullName } } });
  if (error) throw error;
  const user = data.user;
  if (!user) throw new Error('Account created — check your email to confirm, then sign in.');
  // Self-insert: 'pending' unless this is truly the first-ever officer,
  // in which case the RLS policy itself allows claiming 'mayor' directly.
  const { count } = await sb.from('officer_roles').select('*', { count: 'exact', head: true });
  const role = (count || 0) === 0 ? 'mayor' : 'pending';
  const { error: insErr } = await sb.from('officer_roles').insert({ user_id: user.id, email, full_name: fullName, role });
  if (insErr) console.error('officer_roles self-insert failed', insErr);
  return { user, role };
}
export async function officerSignOut() {
  await sb.auth.signOut();
}
export const loadPersonal = data.loadPersonal;
export const savePersonal = data.savePersonal;

let lastSyncedRaw = {};

export function applyRemoteUpdate(key, value) {
  if (!SYNC_KEYS.includes(key)) return;
  lastSyncedRaw[key] = JSON.stringify(value);
  const stateKey = STATE_KEY_FOR[key] || key;
  state[stateKey] = value;
  if (state.modal) return;
  if (state.screen !== 'app' && state.screen !== 'public') return;
  renderPreserveFocus();
}

// Re-renders while preserving focus + cursor position on whatever input the
// person is currently typing in, so a background sync doesn't interrupt
// e.g. someone mid-search.
export function renderPreserveFocus() {
  const active = document.activeElement;
  const id = active && active.id;
  const hasSelection = active && 'selectionStart' in active;
  const selStart = hasSelection ? active.selectionStart : null;
  const selEnd = hasSelection ? active.selectionEnd : null;
  render();
  if (id) {
    const el = document.getElementById(id);
    if (el) {
      el.focus();
      if (selStart != null && el.setSelectionRange) { try { el.setSelectionRange(selStart, selEnd); } catch (e) { } }
    }
  }
}

export function subscribeRealtime() {
  data.subscribeRealtime((key, value) => applyRemoteUpdate(key, value));
}

export function startSyncPolling() {
  data.startPolling(SYNC_KEYS, {
    getLastRaw: (k) => lastSyncedRaw[k],
    onChange: (k, v) => applyRemoteUpdate(k, v),
    shouldPoll: () => !state.modal && (state.screen === 'app' || state.screen === 'public'),
  });
}

export function setLastSyncedRaw(obj) { lastSyncedRaw = obj; }
export { showToastSafe };
