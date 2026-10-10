import { sb, db, watch, esc, toast, modal, resizeImage, blobToDataUrl } from '../core.js';
export async function mountOfficers(el, ctx) {
  el.innerHTML = '<div class="skel"></div><div class="skel"></div>';
  const can = ctx.can('mayor','vice_mayor','secretary','pio');
  async function draw() {
    const rows = await db(sb.from('v2_officers').select('*').order('sort_order'));
    el.innerHTML = `<div class="bar"><h2 style="flex:1;font-size:1.2rem">Officers</h2>${can ? '<button class="btn gold" id="add">+ Add</button>' : ''}</div>
      <div class="card">${rows.map(o => `<div class="row"><div class="officer"><div class="av">${o.photo ? `<img src="${o.photo}" alt="" style="object-position:${o.photo_pos_x}% ${o.photo_pos_y}%">` : esc(o.full_name.split(' ').map(w => w[0]).slice(0, 2).join(''))}</div>
        <div><b>${esc(o.full_name)}</b><br><small class="muted">${esc(o.position)}</small></div></div>${can ? `<button class="btn ghost sm" data-e="${o.id}">Edit</button>` : ''}</div>`).join('')}</div>`;
    el.querySelector('#add')?.addEventListener('click', () => form(null, rows.length));
    el.querySelectorAll('[data-e]').forEach(b => b.onclick = () => form(rows.find(r => r.id === b.dataset.e), 0));
  }
  function form(o, n) {
    modal(`<h3>${o ? 'Edit' : 'Add'} officer</h3><form id="of"><label>Full name</label><input name="n" required value="${esc(o?.full_name)}"><label>Position</label><input name="p" required value="${esc(o?.position)}">
      <label>Credentials</label><textarea name="c" rows="4">${esc(o?.credentials)}</textarea><label>Photo</label><input name="i" type="file" accept="image/*">
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">Save</button>${o ? '<button type="button" class="btn danger" id="rm">Delete</button>' : ''}<button type="button" class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div></form>`,
      (m, close) => { m.querySelector('#cx').onclick = close;
        m.querySelector('#rm')?.addEventListener('click', async () => { if (!confirm('Delete this officer?')) return; try { await db(sb.from('v2_officers').delete().eq('id', o.id)); close(); draw(); } catch (e) { m.querySelector('#er').textContent = e.message; } });
        m.querySelector('#of').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target);
          try { const row = { full_name: f.get('n'), position: f.get('p'), credentials: f.get('c'), updated_at: new Date().toISOString() };
            const file = f.get('i'); if (file && file.size) row.photo = await blobToDataUrl(await resizeImage(file, 400, 0.7));
            await db(o ? sb.from('v2_officers').update(row).eq('id', o.id) : sb.from('v2_officers').insert({ ...row, sort_order: n + 1 }));
            toast('Saved'); close(); draw(); } catch (x) { m.querySelector('#er').textContent = x.message; } }; });
  }
  await draw();
  return watch(['v2_officers'], () => draw().catch(() => {}));
}
