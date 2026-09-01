/* Alpha Suite — shared Supabase data layer (supabase-client.js)
   Both Alpha Watch and Alpha Treasury talk to the SAME Supabase project and
   the SAME `shared_data` table (key text primary key, value jsonb) — they
   just use different key prefixes (Watch: roster/standard/ledger/accounts,
   Treasury: treasury_accounts/treasury_transactions/...). This module used
   to be two near-identical copies of loadShared/saveShared/mutateShared
   pasted into each app; it's now one parameterized implementation.

   Usage (per app):
     const data = createSupabaseSync({
       url: 'https://xxxx.supabase.co',
       key: 'sb_publishable_xxxx',
       storageNamespace: 'alpha-watch',       // localStorage key prefix for personal/session data
       onSaveError: (key, err) => showToastSafe('Sync failed — check your connection and try again'),
     });
     const mutateShared = data.makeMutateShared(state, STATE_KEY_FOR); // STATE_KEY_FOR optional
*/

export function createSupabaseSync({ url, key, storageNamespace, onSaveError, table = 'shared_data' }) {
  const sb = window.supabase.createClient(url, key);

  async function loadShared(dataKey, fallback) {
    try {
      const { data, error } = await sb.from(table).select('value').eq('key', dataKey).maybeSingle();
      if (error) throw error;
      return data ? data.value : fallback;
    } catch (e) {
      console.error('load failed', dataKey, e);
      return fallback;
    }
  }

  async function saveShared(dataKey, value) {
    try {
      const { error } = await sb.from(table).upsert({ key: dataKey, value, updated_at: new Date().toISOString() });
      if (error) throw error;
    } catch (e) {
      console.error('save failed', dataKey, e);
      if (onSaveError) onSaveError(dataKey, e);
    }
  }

  // Re-fetches the latest copy of a shared list right before writing, then
  // applies `mutator` to THAT copy (not local state) and saves the result.
  // This shrinks the window in which two officers' near-simultaneous edits
  // can silently clobber each other. `stateKeyFor` maps a storage key
  // (e.g. "treasury_accounts") to the state property it hydrates (e.g.
  // "accounts"), for apps whose storage keys are prefixed — pass {} (or
  // omit) for apps where the storage key IS the state property name.
  function makeMutateShared(state, stateKeyFor = {}) {
    return async function mutateShared(dataKey, mutator) {
      const stateKey = stateKeyFor[dataKey] || dataKey;
      const latest = (await loadShared(dataKey, state[stateKey])) || [];
      const next = await mutator(latest);
      state[stateKey] = next;
      await saveShared(dataKey, next);
      return next;
    };
  }

  // "Personal" data (just the local sign-in session) stays on-device via
  // localStorage — it should NOT sync across browsers. Namespaced per app
  // so Watch and Treasury sessions never collide in the same browser.
  async function loadPersonal(personalKey, fallback) {
    try {
      const raw = localStorage.getItem(storageNamespace + '::' + personalKey);
      return raw != null ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  async function savePersonal(personalKey, value) {
    try {
      localStorage.setItem(storageNamespace + '::' + personalKey, JSON.stringify(value));
    } catch (e) {
      console.error('save failed', personalKey, e);
    }
  }

  // Live sync: realtime subscription with a polling fallback (in case the
  // table isn't added to Supabase's `supabase_realtime` publication).
  function subscribeRealtime(onChange) {
    try {
      sb.channel(table + '_sync')
        .on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
          const row = payload.new && payload.new.key ? payload.new : payload.old;
          if (!row || !row.key || !payload.new) return;
          onChange(row.key, payload.new.value);
        })
        .subscribe();
    } catch (e) {
      console.error('realtime subscribe failed', e);
    }
  }

  function startPolling(keys, { getLastRaw, onChange, shouldPoll, intervalMs = 20000 } = {}) {
    setInterval(async () => {
      if (shouldPoll && !shouldPoll()) return;
      for (const k of keys) {
        try {
          const value = await loadShared(k, undefined);
          if (value === undefined) continue;
          const raw = JSON.stringify(value);
          if (raw !== (getLastRaw ? getLastRaw(k) : undefined)) onChange(k, value);
        } catch (e) {
          console.error('poll failed', k, e);
        }
      }
    }, intervalMs);
  }

  return { sb, loadShared, saveShared, makeMutateShared, loadPersonal, savePersonal, subscribeRealtime, startPolling };
}
