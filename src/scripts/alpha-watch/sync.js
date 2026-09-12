/* Alpha Watch — sync.js
   Wires the shared supabase-client.js factory to Watch's own state and
   localStorage namespace. This is the only file in the app that talks to
   Supabase directly. Also forwards treasury_* key updates to the embedded
   Treasury module's own applyRemoteUpdate, since both apps share one
   `shared_data` table. */
import { createSupabaseSync } from '../shared/supabase-client.js?v=1';
import { state } from './state.js?v=1';
import { render, showToast } from './router.js?v=1';
import { Treasury } from './treasury-embed.js?v=1';

const SUPABASE_URL = 'https://gxwgkbplscsduscoeoph.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd4d2drYnBsc2NzZHVzY29lb3BoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNDA1MjgsImV4cCI6MjEwMjkxNjUyOH0.OViRrNPgfYFOXVvc0R3Cup66KAtC1Pzfh6SETAIkUn0';

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

// A quick reachability probe before the real load — loadShared() silently
// falls back to an empty default on any error (by design, so a save
// failure mid-session doesn't crash the app), which means a genuine
// connectivity problem at boot would otherwise look identical to "this is
// a brand new class with no data yet". Checking first lets main.js show a
// clear "couldn't connect" screen instead of a misleadingly empty app.
export async function checkConnectivity(){
  try{
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    await fetch(SUPABASE_URL + '/rest/v1/', { headers: { apikey: SUPABASE_ANON_KEY }, signal: ctrl.signal });
    clearTimeout(timer);
    return true; // reaching the server at all (even a 4xx) counts as "online"
  }catch(e){
    return false;
  }
}
