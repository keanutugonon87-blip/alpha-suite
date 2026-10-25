import { createClient } from 'npm:@supabase/supabase-js@2';

// Copies the document folders and attached files into the Mayor's Google Drive (one-way: app -> Drive, nothing is ever deleted in Drive).
// Deploy with "Verify JWT" OFF. Needs two function secrets: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.
// The app only gets the "drive.file" permission: it can see only the files and folders it creates itself, nothing else in the Drive.
//   POST {action:'connect'}  Mayor      -> {url} to open Google's sign-in page
//   GET  ?code=&state=       Google     -> stores the login, makes the "Alpha 28 Documents" folder, sends the Mayor back to the app
//   POST {action:'sync'}     Mayor, Vice Mayor, Secretary, or the nightly job (x-hook-secret) -> copies what is missing
//   POST {action:'unlink'}   Mayor      -> forgets the login (Drive copies stay where they are)
const APP = 'https://keanutugonon87-blip.github.io/alpha-suite/';
const ROOT_NAME = 'Alpha 28 Documents';
const SCOPE = 'openid email https://www.googleapis.com/auth/drive.file';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, authorization, apikey, x-client-info, x-hook-secret', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const URL_BASE = Deno.env.get('SUPABASE_URL')!;
const REDIRECT = `${URL_BASE}/functions/v1/drive-sync`;
const db = createClient(URL_BASE, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const hex = (s: string) => '\\x' + [...new TextEncoder().encode(s)].map((b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (v: unknown) => { const s = String(v ?? ''); return s.startsWith('\\x') ? new TextDecoder().decode(Uint8Array.from(s.slice(2).match(/../g) ?? [], (h) => parseInt(h, 16))) : s; };
const getSecret = async (k: string) => { const { data } = await db.from('v2_secrets').select('value').eq('key', k).maybeSingle(); return data ? unhex(data.value) : ''; };
const setSecret = (k: string, v: string) => db.from('v2_secrets').upsert({ key: k, value: hex(v) }, { onConflict: 'key' });
const delSecrets = (...ks: string[]) => db.from('v2_secrets').delete().in('key', ks);
const setSetting = (k: string, v: string | null) => v === null ? db.from('v2_settings').delete().eq('key', k) : db.from('v2_settings').upsert({ key: k, value: v }, { onConflict: 'key' });

async function who(req: Request) {
  const t = (req.headers.get('authorization') || '').replace(/^Bearer /i, '').trim(); if (!t) return null;
  const { data } = await db.auth.getUser(t); const uid = data?.user?.id; if (!uid) return null;
  const { data: p } = await db.from('v2_profiles').select('role').eq('user_id', uid).maybeSingle();
  return p ? { uid, role: p.role as string } : null;
}

class DriveError extends Error { constructor(msg: string, public status = 0) { super(msg); } }
async function g(url: string, tok: string, init: RequestInit = {}) {
  const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${tok}`, ...(init.headers || {}) } });
  if (!r.ok) { let m = ''; try { m = (await r.json())?.error?.message || ''; } catch { /* no body */ } throw new DriveError(m || `Google answered ${r.status}`, r.status); }
  return r.json();
}
async function accessToken(): Promise<string> {
  const refresh = await getSecret('drive_refresh'); if (!refresh) throw new DriveError('Google Drive is not linked yet', 400);
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: Deno.env.get('GOOGLE_CLIENT_ID')!, client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!, refresh_token: refresh, grant_type: 'refresh_token' }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    const why = j.error === 'invalid_grant' ? 'Google access was taken away or has expired. Link Google Drive again.' : `Google sign-in failed (${j.error || r.status})`;
    await setSetting('drive_last_error', why); throw new DriveError(why, 401);
  }
  return j.access_token;
}
const makeFolder = async (tok: string, name: string, parent?: string) => (await g('https://www.googleapis.com/drive/v3/files?fields=id', tok, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', ...(parent ? { parents: [parent] } : {}) }) })).id as string;

async function ensureRoot(tok: string): Promise<string> {
  const have = await getSecret('drive_root');
  if (have) { try { const f = await g(`https://www.googleapis.com/drive/v3/files/${have}?fields=id,trashed`, tok); if (!f.trashed) return have; } catch (e) { if (!(e instanceof DriveError) || e.status !== 404) throw e; } }
  // The root was deleted in Drive (or never made): start a new one and re-copy everything into it
  const id = await makeFolder(tok, ROOT_NAME); await setSecret('drive_root', id);
  await db.from('v2_doc_folders').update({ drive_folder_id: null, drive_name: null, drive_error: null }).not('id', 'is', null);
  await db.from('v2_doc_files').update({ drive_file_id: null, drive_error: null }).not('id', 'is', null);
  return id;
}

async function syncAll(limit: number) {
  const tok = await accessToken(); const root = await ensureRoot(tok);
  let folders = 0, files = 0, failed = 0;
  const { data: fl } = await db.from('v2_doc_folders').select('id,name,drive_folder_id,drive_name');
  const map = new Map<string, string>();
  for (const f of fl ?? []) {
    try {
      let id = f.drive_folder_id as string | null;
      if (id && f.drive_name !== f.name) {
        try { await g(`https://www.googleapis.com/drive/v3/files/${id}?fields=id`, tok, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: f.name }) }); }
        catch (e) { if (e instanceof DriveError && e.status === 404) id = null; else throw e; }
      }
      if (!id) { id = await makeFolder(tok, f.name, root); folders++; }
      await db.from('v2_doc_folders').update({ drive_folder_id: id, drive_name: f.name, drive_error: null }).eq('id', f.id);
      map.set(f.id, id);
    } catch (e) { failed++; await db.from('v2_doc_folders').update({ drive_error: String((e as Error).message).slice(0, 200) }).eq('id', f.id); }
  }
  const { data: pend } = await db.from('v2_doc_files').select('id,path,name,mime,v2_documents!inner(folder_id)').is('drive_file_id', null).order('created_at').limit(limit);
  for (const f of pend ?? []) {
    try {
      const fid = (f as any).v2_documents?.folder_id as string | null;
      const parent = fid ? map.get(fid) : root;
      if (!parent) throw new Error('Its folder is not in Drive yet');
      const dl = await db.storage.from('v2-docs').download(f.path); if (dl.error || !dl.data) throw new Error('The stored file could not be read');
      const b = 'b' + crypto.randomUUID();
      const body = new Blob([`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: f.name, parents: [parent] })}\r\n--${b}\r\nContent-Type: ${f.mime || 'application/octet-stream'}\r\n\r\n`, dl.data, `\r\n--${b}--`]);
      const up = await g('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', tok, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${b}` }, body });
      await db.from('v2_doc_files').update({ drive_file_id: up.id, drive_error: null }).eq('id', f.id); files++;
    } catch (e) { failed++; await db.from('v2_doc_files').update({ drive_error: String((e as Error).message).slice(0, 200) }).eq('id', f.id); }
  }
  const { count } = await db.from('v2_doc_files').select('id', { count: 'exact', head: true }).is('drive_file_id', null);
  await setSetting('drive_last_sync', new Date().toISOString()); await setSetting('drive_last_error', failed ? `${failed} item${failed === 1 ? '' : 's'} could not be copied. Try Sync now again.` : null);
  return { folders, files, failed, remaining: count ?? 0 };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID'), secret = Deno.env.get('GOOGLE_CLIENT_SECRET');
  const url = new URL(req.url);

  // Google sends the Mayor back here after the consent page
  if (req.method === 'GET') {
    const back = (ok: boolean, why = '') => Response.redirect(`${APP}?drive=${ok ? 'ok' : 'error'}${why ? '&why=' + encodeURIComponent(why.slice(0, 80)) : ''}#/staff/docs`, 302);
    try {
      if (!clientId || !secret) return back(false, 'not set up');
      if (url.searchParams.get('error')) return back(false, url.searchParams.get('error')!);
      const [nonce, at] = (await getSecret('drive_state')).split('|'); await delSecrets('drive_state');
      if (!nonce || nonce !== url.searchParams.get('state') || Date.now() - Number(at) > 10 * 60 * 1000) return back(false, 'expired, try again');
      const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code: url.searchParams.get('code') || '', client_id: clientId, client_secret: secret, redirect_uri: REDIRECT, grant_type: 'authorization_code' }) });
      const j = await r.json(); if (!r.ok || !j.refresh_token) return back(false, j.error_description || 'no permission was given');
      let email = ''; try { email = JSON.parse(atob(String(j.id_token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).email || ''; } catch { /* email is only for display */ }
      await setSecret('drive_refresh', j.refresh_token); await setSecret('drive_email', email); await delSecrets('drive_root');
      await setSetting('drive_last_error', null);
      const tok = await accessToken(); await ensureRoot(tok);
      return back(true);
    } catch (e) { return back(false, (e as Error).message); }
  }

  if (req.method !== 'POST') return new Response('method not allowed', { status: 405, headers: CORS });
  let body: Record<string, unknown> = {}; try { body = await req.json(); } catch { /* empty body */ }
  const hook = await getSecret('push_hook'); const viaCron = !!hook && req.headers.get('x-hook-secret') === hook;
  const me = viaCron ? { uid: '', role: 'system' } : await who(req);
  if (!me) return json({ error: 'Sign in first' }, 401);
  const staff = viaCron || ['mayor', 'vice_mayor', 'secretary'].includes(me.role);
  if (!staff) return json({ error: 'Not allowed' }, 403);

  try {
    if (body.action === 'connect') {
      if (me.role !== 'mayor') return json({ error: 'Only the Mayor can link Google Drive' }, 403);
      if (!clientId || !secret) return json({ error: 'not_configured' }, 400);
      const nonce = crypto.randomUUID(); await setSecret('drive_state', `${nonce}|${Date.now()}`);
      const q = new URLSearchParams({ client_id: clientId, redirect_uri: REDIRECT, response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent', state: nonce });
      return json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${q}` });
    }
    if (body.action === 'unlink') {
      if (me.role !== 'mayor') return json({ error: 'Only the Mayor can unlink Google Drive' }, 403);
      const refresh = await getSecret('drive_refresh');
      if (refresh) { try { await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refresh)}`, { method: 'POST' }); } catch { /* best effort */ } }
      await delSecrets('drive_refresh', 'drive_email', 'drive_root', 'drive_state');
      await db.from('v2_doc_folders').update({ drive_folder_id: null, drive_name: null, drive_error: null }).not('id', 'is', null);
      await db.from('v2_doc_files').update({ drive_file_id: null, drive_error: null }).not('id', 'is', null);
      await setSetting('drive_last_error', null); await setSetting('drive_last_sync', null);
      return json({ ok: true });
    }
    if (body.action === 'sync') {
      const lim = Math.min(Math.max(Number(body.limit) || 12, 1), 40);
      return json(await syncAll(lim));
    }
    return json({ error: 'Unknown action' }, 400);
  } catch (e) { return json({ error: (e as Error).message }, e instanceof DriveError ? (e.status === 400 ? 400 : e.status ? 502 : 500) : 500); }
});
