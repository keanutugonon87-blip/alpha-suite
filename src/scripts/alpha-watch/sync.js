/* Alpha Watch — sync.js
   Wires the shared supabase-client.js factory to Watch's own state and
   localStorage namespace. This is the only file in the app that talks to
   Supabase directly. Also forwards treasury_* key updates to the embedded
   Treasury module's own applyRemoteUpdate, since both apps share one
   `shared_data` table. */
import { createSupabaseSync } from '../shared/supabase-client.js';
import { state } from './state.js';
import { render, showToast } from './router.js';
import { Treasury } from './treasury-embed.js';

const SUPABASE_URL = 'https://gxwgkbplscsduscoeoph.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_m3l1Dxhwj6bIse-3UwBB4w_fqZXLuD0';

function showToastSafe(msg) { if (state.screen && state.screen !== 'loading') showToast(msg); else console.warn(msg); }

const data = createSupabaseSync({
  url: SUPABASE_URL,
  key: SUPABASE_ANON_KEY,
  storageNamespace: 'alpha-watch',
  onSaveError: () => showToastSafe('Sync failed — check your connection and try again'),
});

export const sb = data.sb;
export const loadShared = data.loadShared;
export const saveShared = data.saveShared;
export const mutateShared = data.makeMutateShared(state); // Watch's storage keys ARE its state property names, so no STATE_KEY_FOR needed
export const makeMutateShared = data.makeMutateShared; // exposed so treasury-embed.js can bind its own (trState uses a different key mapping)
export const loadPersonal = data.loadPersonal;
export const savePersonal = data.savePersonal;

export const SYNC_KEYS = ['roster','standard','ledger','accounts'];
let lastSyncedRaw = {};

export function applyRemoteUpdate(key, value){
  if(key.startsWith('treasury_')){
    lastSyncedRaw[key] = JSON.stringify(value);
    Treasury.applyRemoteUpdate(key, value);
    return;
  }
  if(!SYNC_KEYS.includes(key)) return;
  lastSyncedRaw[key] = JSON.stringify(value);
  state[key] = value;
  // If our own account was edited or removed by the Mayor elsewhere, keep
  // the session in step (or sign out) rather than acting on stale info.
  if(key==='accounts' && state.session){
    const acc = value.find(a=>a.id===state.session.accountId);
    if(!acc){
      state.session = null;
      state.screen = 'gate';
      savePersonal('session', null);
      showToastSafe('Your account was removed — please sign in again');
      return renderPreserveFocus();
    }
    if(acc.role!==state.session.role || acc.name!==state.session.name){
      state.session = {...state.session, role:acc.role, name:acc.name};
    }
  }
  // Don't yank the rug out from under someone mid-edit in a modal — the
  // fresh data is already in state, it'll show as soon as they close it.
  if(state.modal) return;
  if(state.screen!=='app' && state.screen!=='public') return;
  renderPreserveFocus();
}

// Re-renders while preserving focus + cursor position on whatever input the
// person is currently typing in, so a background sync doesn't interrupt
// e.g. someone mid-search.
export function renderPreserveFocus(){
  const active = document.activeElement;
  const id = active && active.id;
  const hasSelection = active && 'selectionStart' in active;
  const selStart = hasSelection ? active.selectionStart : null;
  const selEnd = hasSelection ? active.selectionEnd : null;
  render();
  if(id){
    const el = document.getElementById(id);
    if(el){
      el.focus();
      if(selStart!=null && el.setSelectionRange){
        try{ el.setSelectionRange(selStart, selEnd); }catch(e){}
      }
    }
  }
}

export function subscribeRealtime(){
  data.subscribeRealtime((key, value) => applyRemoteUpdate(key, value));
}

export function startSyncPolling(){
  // Matches original behavior: polling only covers Watch's own 4 keys.
  // treasury_* keys are picked up via the realtime subscription above,
  // whose callback (applyRemoteUpdate) forwards them to Treasury.
  data.startPolling(SYNC_KEYS, {
    getLastRaw: (k) => lastSyncedRaw[k],
    onChange: (k, v) => applyRemoteUpdate(k, v),
    shouldPoll: () => !state.modal && (state.screen === 'app' || state.screen === 'public'),
  });
}

export function setLastSyncedRaw(obj) { lastSyncedRaw = obj; }
export { showToastSafe };
