import { sb, db, watch, esc, toast, modal, ROLE_LABEL, ROLES, fmtDateTime, fmtDate, confirmDialog, initials } from '../core.js';
import { pushState, enablePush, disablePush } from '../push.js';

const ROLE_INFO = {
  mayor: 'Full control. Approves entries, closes periods, manages accounts.',
  vice_mayor: 'Co-manages students, violations and accounts. Approves violation resolutions.',
  secretary: 'Keeps the student list, officer profiles and violation records.',
  treasurer: 'Records collections and expenses. Entries wait for the Mayor to approve.',
  auditor: 'Checks the money and the audit log. Does not record entries.',
  marshall: 'Reports violations. Reports wait for approval.',
  sails: 'Reports violations. Reports wait for approval.',
  pio: 'Posts notices and keeps officer profiles up to date.',
};
const ago = d => { const s = (Date.now() - new Date(d)) / 1000; if (s < 90) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago'; if (s < 86400) return Math.round(s / 3600) + ' h ago'; return Math.round(s / 86400) + ' d ago'; };
const changed = p => new Date(p.updated_at) - new Date(p.created_at) > 60000;

export async function mountAccounts(el, ctx) {
  const isMayor = ctx.can('mayor'), canAlert = ctx.can('mayor', 'vice_mayor');
  let tab = 'people', pstate = 'unsupported';
  if (canAlert) pstate = await pushState();

  async function remove(p, pending) {
    const ok = await confirmDialog(`${p.full_name} (${p.email}) will be deleted completely. Their login is erased and they would have to sign up again. Entries they recorded stay in the ledger with their name.`,
      { ok: pending ? 'Reject & delete' : 'Delete account', danger: true, title: pending ? 'Reject this request?' : 'Delete this account?' });
    if (!ok) return;
    try { await db(sb.rpc('v2_delete_account', { p_user: p.user_id })); toast('Account deleted'); }
    catch (e) { toast(/function|schema cache/i.test(e.message) ? 'Delete is not switched on in the database yet.' : e.message, true); }
  }

  function review(p) {
    modal(`<h3>Review access request</h3>
      <div class="rq"><span class="ini">${esc(initials(p.full_name))}</span><div><b>${esc(p.full_name)}</b><div class="em">${esc(p.email)}</div><small class="muted">Requested ${fmtDateTime(p.created_at)} (${ago(p.created_at)})</small></div></div>
      <label>Assign a role</label>
      <div class="roles">${ROLES.map(r => `<label class="rl"><input type="radio" name="r" value="${r}"><span><b>${ROLE_LABEL[r]}</b><small>${esc(ROLE_INFO[r] || '')}</small></span></label>`).join('')}</div>
      <label class="ck"><input type="checkbox" id="ok"><span>I confirmed that <b>${esc(p.email)}</b> belongs to <b>${esc(p.full_name)}</b> and the role is right.</span></label>
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" id="go" style="flex:1" disabled>Approve</button><button class="btn danger" id="rj">Reject</button><button class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div>`,
      (m, close) => {
        const go = m.querySelector('#go'), ck = m.querySelector('#ok'), role = () => (m.querySelector('input[name=r]:checked') || {}).value;
        const sync = () => { const r = role(); go.disabled = !(r && ck.checked); go.textContent = r ? `Approve as ${ROLE_LABEL[r]}` : 'Approve'; };
        m.querySelectorAll('input').forEach(i => i.onchange = sync);
        m.querySelector('#cx').onclick = close;
        m.querySelector('#rj').onclick = () => { close(); remove(p, true); };
        go.onclick = async () => {
          go.disabled = true;
          try { await db(sb.from('v2_profiles').update({ role: role(), updated_at: new Date().toISOString() }).eq('user_id', p.user_id)); toast(`${p.full_name} approved as ${ROLE_LABEL[role()]}`); close(); }
          catch (e) { m.querySelector('#er').textContent = e.message; go.disabled = false; }
        };
      });
  }

  async function draw() {
    const people = await db(sb.from('v2_profiles').select('*').order('created_at'));
    const audit = ctx.can('mayor', 'auditor', 'vice_mayor') ? await db(sb.from('v2_audit').select('at,actor_name,action,table_name,row_id').order('at', { ascending: false }).limit(80)) : [];
    let files = [], bErr = '';
    if (tab === 'backups' && canAlert) { const r = await sb.storage.from('v2-backups').list('', { limit: 50, sortBy: { column: 'name', order: 'desc' } }); files = (r.data || []).filter(f => f.name.startsWith('alpha28-backup-')); bErr = r.error ? r.error.message : ''; }
    const pend = people.filter(p => p.role === 'pending'), active = people.filter(p => p.role !== 'pending');
    const bar = () => {
      if (!canAlert) return '';
      const box = (t, b) => `<div class="alertbar"><span>🔔 ${t}</span>${b}</div>`;
      if (pstate === 'off') return box('Get a phone alert when someone asks for access', '<button class="btn gold sm" id="pon">Turn on</button>');
      if (pstate === 'on') return box('Sign-up alerts are on for this device', '<button class="btn ghost sm" id="poff">Turn off</button>');
      if (pstate === 'ios-install') return box('On iPhone, add the site to your Home Screen first, then turn alerts on from there.', '');
      if (pstate === 'denied') return box('Alerts are blocked in your browser settings.', '');
      return '';
    };
    el.innerHTML = `<div class="bar"><button class="btn ${tab === 'people' ? '' : 'ghost'}" data-k="people">Accounts${pend.length ? ` <span class="badge">${pend.length}</span>` : ''}</button>
      ${audit.length || ctx.can('auditor') ? `<button class="btn ${tab === 'audit' ? '' : 'ghost'}" data-k="audit">Audit log</button>` : ''}${canAlert ? `<button class="btn ${tab === 'backups' ? '' : 'ghost'}" data-k="backups">Backups</button>` : ''}</div>
      ${tab === 'people' ? `${bar()}
      <h3 class="sec">Waiting for approval ${pend.length ? `<span class="badge">${pend.length}</span>` : ''}</h3>
      <div class="card pendbox">${pend.map(p => `<div class="row stk"><div class="lead"><span class="ini">${esc(initials(p.full_name))}</span><div class="m"><b>${esc(p.full_name)}</b><small>${esc(p.email)}</small><small>Requested ${ago(p.created_at)}</small></div></div>
          ${isMayor ? `<div class="acts"><button class="btn gold sm" data-rv="${p.user_id}">Review</button><button class="btn ghost sm" data-rj="${p.user_id}">Reject</button></div>` : '<span class="tag warn">Pending</span>'}</div>`).join('') || '<p class="empty">No one is waiting. New sign-ups appear here.</p>'}</div>
      <h3 class="sec">Officers (${active.length})</h3>
      <div class="card">${active.map(p => `<div class="row stk"><div class="lead"><span class="ini">${esc(initials(p.full_name))}</span><div class="m"><b>${esc(p.full_name)}</b><small>${esc(p.email)}</small>
          <small>Joined ${fmtDate(p.created_at)}${changed(p) ? ` · role changed ${fmtDate(p.updated_at)}` : ''}</small></div></div>
        <div class="acts">${isMayor && p.user_id !== ctx.profile.user_id
          ? `<select data-u="${p.user_id}" data-prev="${p.role}" aria-label="Role">${ROLES.map(r => `<option value="${r}"${p.role === r ? ' selected' : ''}>${ROLE_LABEL[r]}</option>`).join('')}</select><button class="btn danger sm" data-del="${p.user_id}">Remove</button>`
          : `<span class="tag ok">${ROLE_LABEL[p.role]}${p.user_id === ctx.profile.user_id ? ' (you)' : ''}</span>`}</div></div>`).join('')}</div>`
      : tab === 'backups' ? `<p class="muted" style="margin:0 0 10px">A full copy of every record is saved automatically each Monday at 3 AM and the newest 12 are kept. Passwords, device keys and inline receipt photos are left out.</p>
        <div class="bar"><button class="btn gold" id="bnow">Back up now</button></div>
        <div class="card">${files.map(f => { const m = f.name.match(/(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})/); const when = m ? new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+08:00`) : null;
          return `<div class="row"><div class="m"><b>${when ? fmtDateTime(when) : esc(f.name)}</b><small>${f.metadata?.size ? Math.max(1, Math.round(f.metadata.size / 1024)) + ' KB · ' : ''}${esc(f.name)}</small></div><button class="btn ghost sm" data-bk="${esc(f.name)}">Download</button></div>`; }).join('') || `<p class="empty">${bErr ? esc(bErr) : 'No backups yet. Tap Back up now to make the first one.'}</p>`}</div>`
      : `<div class="card">${audit.map(a => `<div class="row"><div class="m"><b>${esc(a.action)} · ${esc(a.table_name.replace('v2_', ''))}</b><small>${esc(a.actor_name || 'system')} · ${fmtDateTime(a.at)}</small></div></div>`).join('') || '<p class="empty">Nothing logged yet.</p>'}</div>`}`;
    const by = id => people.find(p => p.user_id === id);
    el.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { tab = b.dataset.k; draw(); });
    el.querySelectorAll('[data-rv]').forEach(b => b.onclick = () => review(by(b.dataset.rv)));
    el.querySelectorAll('[data-rj]').forEach(b => b.onclick = () => remove(by(b.dataset.rj), true));
    el.querySelectorAll('[data-del]').forEach(b => b.onclick = () => remove(by(b.dataset.del), false));
    el.querySelectorAll('select[data-u]').forEach(s => s.onchange = async () => {
      const p = by(s.dataset.u), to = s.value;
      if (!await confirmDialog(`${p.full_name} (${p.email}) will change from ${ROLE_LABEL[p.role]} to ${ROLE_LABEL[to]}.\n${ROLE_INFO[to] || ''}`, { ok: 'Change role', title: 'Change role?' })) return draw();
      try { await db(sb.from('v2_profiles').update({ role: to, updated_at: new Date().toISOString() }).eq('user_id', p.user_id)); toast('Role updated'); } catch (e) { toast(e.message, true); draw(); } });
    el.querySelector('#bnow')?.addEventListener('click', async e => { e.target.disabled = true;
      try { await db(sb.rpc('v2_backup_now')); toast('Backup started. It appears here in a few seconds.'); setTimeout(() => draw().catch(() => {}), 7000); }
      catch (x) { toast(/function|schema cache/i.test(x.message) ? 'Backups are not switched on in the database yet.' : x.message, true); e.target.disabled = false; } });
    el.querySelectorAll('[data-bk]').forEach(b => b.onclick = async () => {
      const { data, error } = await sb.storage.from('v2-backups').createSignedUrl(b.dataset.bk, 120, { download: b.dataset.bk });
      if (error) return toast(error.message, true); const a = document.createElement('a'); a.href = data.signedUrl; a.download = b.dataset.bk; a.click(); });
    el.querySelector('#pon')?.addEventListener('click', async e => { e.target.disabled = true; try { await enablePush(true); toast('Sign-up alerts are on'); } catch (x) { toast(x.message, true); } pstate = await pushState(); draw(); });
    el.querySelector('#poff')?.addEventListener('click', async () => { try { await disablePush(); } catch { /* ignore */ } pstate = await pushState(); draw(); });
  }
  await draw();
  return watch(['v2_profiles'], () => draw().catch(() => {}));
}
