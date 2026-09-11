/* Alpha Treasury — sync.js
   Wires the shared supabase-client.js factory to Treasury's own state,
   STATE_KEY_FOR mapping, and localStorage namespace. This is the only file
   in the app that talks to Supabase directly. */
import { createSupabaseSync } from '../shared/supabase-client.js?v=1';
import { state, STATE_KEY_FOR, SYNC_KEYS } from './state.js?v=2';
import { render, showToast } from './router.js?v=1';

const SUPABASE_URL = 'https://gxwgkbplscsduscoeoph.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_m3l1Dxhwj6bIse-3UwBB4w_fqZXLuD0';

// True when this page is loaded inside an <iframe> (e.g. embedded elsewhere)
// — used to hide redundant "Open Alpha Watch" links that would otherwise
// open a second, nested copy of Watch.
export const IS_EMBEDDED = (function () { try { return window.self !== window.top; } catch (e) { return true; } })();

function showToastSafe(msg) { if (state.screen && state.screen !== 'loading') showToast(msg); else console.warn(msg); }

const data = createSupabaseSync({
  url: SUPABASE_URL,
  key: SUPABASE_ANON_KEY,
  storageNamespace: 'alpha-treasury',
  onSaveError: () => showToastSafe('Sync failed — check your connection and try again'),
});

export const sb = data.sb;

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
  const { data: txn, error: fetchErr } = await sb
    .from('transactions')
    .select('id, amount, dues_instance_id')
    .eq('id', id)
    .maybeSingle();
  if (fetchErr || !txn) throw new Error(fetchErr?.message || 'Payment not found — it may already be removed.');

  const { data: { user } } = await sb.auth.getUser();

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
export const saveShared = data.saveShared;
export const mutateShared = data.makeMutateShared(state, STATE_KEY_FOR);
export const loadPersonal = data.loadPersonal;
export const savePersonal = data.savePersonal;

let lastSyncedRaw = {};

export function applyRemoteUpdate(key, value) {
  if (!SYNC_KEYS.includes(key)) return;
  lastSyncedRaw[key] = JSON.stringify(value);
  const stateKey = STATE_KEY_FOR[key] || key;
  state[stateKey] = value;
  if (key === 'treasury_accounts' && state.session) {
    const acc = (value || []).find(a => a.id === state.session.accountId);
    if (!acc) {
      state.session = null;
      state.screen = 'gate';
      savePersonal('session', null);
      showToastSafe('Your account was removed — please sign in again');
      return renderPreserveFocus();
    }
    if (acc.role !== state.session.role || acc.name !== state.session.name) {
      state.session = { ...state.session, role: acc.role, name: acc.name };
    }
  }
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
