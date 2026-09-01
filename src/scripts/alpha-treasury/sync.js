/* Alpha Treasury — sync.js
   Wires the shared supabase-client.js factory to Treasury's own state,
   STATE_KEY_FOR mapping, and localStorage namespace. This is the only file
   in the app that talks to Supabase directly. */
import { createSupabaseSync } from '../shared/supabase-client.js';
import { state, STATE_KEY_FOR, SYNC_KEYS } from './state.js';
import { render, showToast } from './router.js';

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
