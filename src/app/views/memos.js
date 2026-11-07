import { sb, db, watch, esc, toast, modal, skeleton, fmtDateTime, ROLE_LABEL } from '../core.js';

/* The SAILS President sends a memo to the Class Mayors, the VPs, the Marshals or all of them, and sees who has acknowledged it. */
const AUD = { mayors: 'All Class Mayors', vps: 'The Vice Presidents', marshals: 'The Marshals', all: 'All of them' };

export async function mountMemos(el) {
  let memos = [], acks = [], setup = false;
  el.innerHTML = skeleton(3);
  async function load() {
    const [m, a] = await Promise.all([
      sb.from('v2_memos').select('*').order('created_at', { ascending: false }).limit(60).then(r => r.error ? (setup = true, []) : r.data || [], () => []),
      sb.from('v2_memo_acks').select('memo_id').then(r => r.error ? [] : r.data || [], () => []),
    ]);
    memos = m; acks = a; draw();
  }
  function draw() {
    if (setup) { el.innerHTML = '<div class="card"><p class="empty">Run the v50 SQL in Supabase to turn this on.</p></div>'; return; }
    const n = id => acks.filter(a => a.memo_id === id).length;
    el.innerHTML = `<div class="bar"><span class="muted">One announcement to every officer in a group. Each one acknowledges it, and you see who has not.</span><span class="grow"></span><button class="btn gold" id="nm">+ New memo</button></div>
      ${memos.length ? `<div class="card">${memos.map(m => `<button type="button" class="row" data-m="${m.id}" style="display:block;width:100%;text-align:left;background:none;border:0;border-bottom:1px solid var(--line,#e3e8ee);cursor:pointer"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px"><div class="m"><b>${m.urgent ? '🔴 ' : ''}${esc(m.title)}</b><small>${esc(AUD[m.audience])} · ${fmtDateTime(m.created_at)}</small></div><span class="tag">${n(m.id)} acknowledged</span></div></button>`).join('')}</div>` : '<p class="empty">No memos sent yet.</p>'}`;
    el.querySelector('#nm').onclick = form;
    el.querySelectorAll('[data-m]').forEach(b => b.onclick = () => status(memos.find(m => m.id === b.dataset.m)));
  }
  function form() {
    modal(`<h3>New memo</h3><form id="f"><label>To</label><select name="a">${Object.entries(AUD).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <label>Title</label><input name="t" required minlength="3" maxlength="140"><label>Message</label><textarea name="b" rows="5" maxlength="2000"></textarea>
      <label style="display:flex;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" name="u" style="width:auto"> Urgent (phone alert marked red)</label>
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">Send memo</button><button type="button" class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div></form>`, (m, close) => {
      m.querySelector('#cx').onclick = close;
      m.querySelector('#f').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target);
        try { const n = await db(sb.rpc('v2_memo_send', { p_title: f.get('t'), p_body: f.get('b'), p_audience: f.get('a'), p_urgent: !!f.get('u') })); toast(`Sent to ${n} officer${n === 1 ? '' : 's'}`); close(); load(); }
        catch (x) { m.querySelector('#er').textContent = x.message; } };
    });
  }
  async function status(m) {
    const list = await sb.rpc('v2_memo_status', { p_id: m.id }).then(r => r.data || [], () => []);
    modal(`<h3>${m.urgent ? '🔴 ' : ''}${esc(m.title)}</h3><p class="muted" style="margin:0 0 8px">${esc(AUD[m.audience])} · ${fmtDateTime(m.created_at)}</p>${m.body ? `<p style="white-space:pre-wrap;margin:0 0 10px">${esc(m.body)}</p>` : ''}
      <div class="card">${list.map(p => `<div class="row"><div class="m"><b>${esc(p.name)}</b><small>${esc(ROLE_LABEL[p.role] || p.role)}</small></div><span class="tag ${p.acked_at ? 'ok' : 'warn'}">${p.acked_at ? 'Acknowledged ' + fmtDateTime(p.acked_at) : 'Not yet'}</span></div>`).join('') || '<p class="empty">No recipients.</p>'}</div>
      <div style="margin-top:12px"><button type="button" class="btn ghost" id="cx">Close</button></div>`, (mm, close) => { mm.querySelector('#cx').onclick = close; });
  }
  await load();
  return watch(['v2_memos', 'v2_memo_acks'], () => load().catch(() => {}));
}
