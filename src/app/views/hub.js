import { esc } from '../core.js';

/* A hub is one menu entry that holds several related screens, with a row of buttons to switch between them.
   sections: [[id, label, load]]; the last one used is remembered per hub. */
export async function mountHub(el, ctx, hubId, sections) {
  const SK = 'alpha-hub-' + hubId;
  let cur = ctx.section && sections.some(s => s[0] === ctx.section) ? ctx.section : (() => { try { const s = localStorage.getItem(SK); return sections.some(x => x[0] === s) ? s : sections[0][0]; } catch { return sections[0][0]; } })();
  let stop = null, token = 0;
  el.innerHTML = `<div class="hubbar" role="tablist" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px"></div><div class="hubbody"></div>`;
  const bar = el.querySelector('.hubbar'), body = el.querySelector('.hubbody');
  async function show(id) {
    cur = id; const my = ++token;
    try { localStorage.setItem(SK, id); } catch { /* ignore */ }
    bar.innerHTML = sections.map(([k, l]) => `<button class="btn ${k === id ? 'gold' : 'ghost'} sm" role="tab" aria-selected="${k === id}" data-s="${k}">${esc(l)}</button>`).join('');
    bar.querySelectorAll('[data-s]').forEach(b => b.onclick = () => { if (b.dataset.s !== cur) show(b.dataset.s); });
    if (typeof stop === 'function') { try { stop(); } catch { /* ignore */ } } stop = null;
    body.innerHTML = '';
    const mount = await sections.find(s => s[0] === id)[2]();
    if (my !== token) return;
    const sub = document.createElement('div'); body.appendChild(sub);
    const off = await mount(sub, ctx);
    if (my !== token) { if (typeof off === 'function') off(); return; }
    stop = off;
  }
  await show(cur);
  return () => { token++; if (typeof stop === 'function') { try { stop(); } catch { /* ignore */ } } };
}
