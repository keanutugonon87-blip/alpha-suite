import { sb, db, watch, esc, toast, modal, confirmDialog, fmtDate } from '../core.js';

export async function mountNotices(el, ctx) {
  const can = ctx.can('mayor', 'vice_mayor', 'secretary', 'pio');
  async function draw() {
    const [rows, set] = await Promise.all([db(sb.from('v2_announcements').select('*').order('created_at', { ascending: false })), db(sb.from('v2_settings').select('*'))]);
    const names = (set.find(s => s.key === 'public_names') || {}).value || 'full';
    el.innerHTML = `<div class="bar"><h2 style="flex:1;font-size:1.2rem">Notices</h2>${can ? '<button class="btn gold" id="add">+ New notice</button>' : ''}</div>
      <p class="muted" style="margin:0 0 10px">Shown at the top of the public page until they expire.</p>
      <div class="card">${rows.map(a => `<div class="row"><div class="m"><b>${a.pinned ? '📌 ' : ''}${esc(a.title)}</b><small>${esc(a.body || '')}${a.expires_on ? ` · until ${fmtDate(a.expires_on)}` : ''}</small></div>${can ? `<div class="acts"><button class="btn ghost sm" data-d="${a.id}">Delete</button></div>` : ''}</div>`).join('') || '<p class="empty">No notices yet.</p>'}</div>
      <h3 style="margin:18px 2px 8px">Privacy</h3>
      <div class="card pad"><b>Names on the public violation list</b><p class="muted" style="margin:4px 0 10px">${ctx.can('mayor') ? 'Choose how classmates appear to anyone who opens the page.' : 'Only the Mayor can change this.'}</p>
        <div class="seg" id="nm">${[['full', 'Full names'], ['initials', 'Initials only']].map(([k, l]) => `<button data-n="${k}" class="${names === k ? 'on' : ''}" ${ctx.can('mayor') ? '' : 'disabled'}>${l}</button>`).join('')}</div></div>`;
    el.querySelector('#add')?.addEventListener('click', form);
    el.querySelectorAll('[data-d]').forEach(b => b.onclick = async () => { if (await confirmDialog('This notice disappears from the public page.', { ok: 'Delete', danger: true })) db(sb.from('v2_announcements').delete().eq('id', b.dataset.d)).then(draw).catch(e => toast(e.message, true)); });
    el.querySelectorAll('[data-n]').forEach(b => b.onclick = () => db(sb.from('v2_settings').upsert({ key: 'public_names', value: b.dataset.n })).then(() => { toast('Saved'); draw(); }).catch(e => toast(e.message, true)));
  }
  function form() {
    modal(`<h3>New notice</h3><form id="f"><label>Title</label><input name="t" required maxlength="120" placeholder="Siglakas due Friday">
      <label>Details (optional)</label><textarea name="b" rows="3" maxlength="600"></textarea>
      <label>Hide after (optional)</label><input name="e" type="date">
      <label style="display:flex;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" name="p" style="width:auto"> Pin to the top</label>
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">Post</button><button type="button" class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div></form>`,
      (m, close) => { m.querySelector('#cx').onclick = close;
        m.querySelector('#f').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target);
          try { await db(sb.from('v2_announcements').insert({ title: f.get('t').trim(), body: f.get('b').trim(), pinned: !!f.get('p'), expires_on: f.get('e') || null, created_by_name: ctx.profile.full_name })); toast('Posted'); close(); draw(); }
          catch (x) { m.querySelector('#er').textContent = x.message; } }; });
  }
  await draw();
  return watch(['v2_announcements', 'v2_settings'], () => draw().catch(() => {}));
}
