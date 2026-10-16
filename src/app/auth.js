/* Alpha ’28 — sign-in: the lock, the sign-in function, and who is looking at the app. */
import { sb, SB_URL, SB_KEY } from './core.js';

export const auth = { require: false, viewer: 'open', kind: 'none', member_id: null };
const missing = e => /function|schema cache|does not exist/i.test(e?.message || '');

/* Is sign-in required, and is this visitor allowed in? If the v7 SQL is not installed yet, the app stays open as before. */
export async function loadAuth() {
  try {
    const { data, error } = await sb.rpc('v2_gate'); if (error) throw error;
    auth.require = !!data.require; auth.viewer = data.viewer || null;
  } catch (e) { if (!missing(e)) throw e; auth.require = false; auth.viewer = 'open'; }
  auth.kind = 'none'; auth.member_id = null;
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    try { const { data } = await sb.rpc('v2_whoami'); if (data) { auth.kind = data.kind; auth.member_id = data.member_id || null; auth.name = data.name; } } catch { /* older database */ }
  }
  return auth;
}

/* Talks to the student-auth function. Returns its JSON answer ({ok, token_hash, token} or {ok:false, error}). */
export async function callAuth(body) {
  const r = await fetch(`${SB_URL}/functions/v1/student-auth`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SB_KEY }, body: JSON.stringify(body) });
  if (r.status === 404) throw new Error('Sign-in is not switched on yet. Ask the Mayor.');
  let d; try { d = await r.json(); } catch { throw new Error('Could not sign in right now. Try again.'); }
  return d;
}

/* Trades the one-time token for a real session. */
export async function enter(res) {
  const { error } = await sb.auth.verifyOtp({ token_hash: res.token_hash, type: 'magiclink' });
  if (error) throw new Error('Could not sign in. Try again.');
}

export async function signOutViewer() {
  if (auth.kind === 'student' || auth.kind === 'guest') await sb.auth.signOut();
}
