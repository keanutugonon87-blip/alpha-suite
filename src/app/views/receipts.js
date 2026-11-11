import { sb, esc, fmtDate, skeleton } from '../core.js';

/* Who has received what: for the SAILS Secretary, the SAILS VP Internal and the SAILS President.
   Shows, for each agenda, minutes, letter and resolution sent to the Class Mayors, who has marked it received and who has not.
   Needs v59. */
export async function mountReceipts(el) {
  let data = null, waitingOnly = false, setup = false;
  el.innerHTML = skeleton(3);
  const when = t => new Date(t).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' });
  async function load() {
    const r = await sb.rpc('v2_receipt_overview');
    if (r.error) { setup = /could not find|does not exist/i.test(r.error.message || ''); el.innerHTML = `<div class="card"><p class="empty">${setup ? 'Run the v59 SQL in Supabase to turn this on.' : esc(r.error.message)}</p></div>`; return; }
    data = r.data; paint();
  }
  function paint() {
    const mayors = data.mayors || [], got = {};
    (data.got || []).forEach(g => { (got[g.src + ':' + g.id] = got[g.src + ':' + g.id] || {})[g.user_id] = g.at; });
    const items = (data.items || []).map(i => { const g = got[i.src + ':' + i.id] || {}; return { ...i, done: mayors.filter(m => g[m.user_id]).map(m => ({ ...m, at: g[m.user_id] })), wait: mayors.filter(m => !g[m.user_id]) }; });
    const list = items.filter(i => !waitingOnly || i.wait.length);
    el.innerHTML = `<div class="bar"><span class="muted">What the Class Mayors have been sent, and who has marked it received.</span><span class="grow"></span><label class="chip"><input type="checkbox" id="wo"${waitingOnly ? ' checked' : ''}> Waiting only</label></div>
      ${mayors.length ? '' : '<div class="card"><p class="empty">No Class Mayor account yet.</p></div>'}
      <div class="card">${list.map(i => `<details class="row" style="display:block;padding:12px 14px"><summary style="cursor:pointer;display:flex;gap:10px;align-items:center"><div class="m" style="flex:1"><b>${esc(i.title)}</b><small>${esc(i.kind)} · ${fmtDate(String(i.at).slice(0, 10) + 'T00:00:00+08:00')}</small></div><span class="tag ${i.wait.length ? 'warn' : 'ok'}">${i.done.length} of ${mayors.length}</span></summary>
        <div style="margin-top:8px">${i.done.map(m => `<div class="muted">✓ ${esc(m.name)} · ${when(m.at)}</div>`).join('')}${i.wait.map(m => `<div>⏳ ${esc(m.name)} · not yet received</div>`).join('')}</div></details>`).join('') || '<p class="empty">Nothing has been sent to the Class Mayors yet.</p>'}</div>`;
    el.querySelector('#wo').onchange = e => { waitingOnly = e.target.checked; paint(); };
  }
  await load();
}
