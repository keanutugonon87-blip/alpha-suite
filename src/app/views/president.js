import { esc } from '../core.js';

/* The President's one desk: Directives, VP Desk and Approvals (announcements and FAQ) under a single menu entry. */
const SK = 'alpha-president-section';
const SECTIONS = [
  ['directives', 'Directives', () => import('./directives.js').then(m => m.mountDirectives)],
  ['vp', 'VP Desk', () => import('./vp.js').then(m => m.mountVp)],
  ['approvals', 'Approvals and FAQ', () => import('./office.js').then(m => m.mountOffice)],
];

export async function mountPresident(el, ctx) {
  const want = ctx.section === 'office' ? 'approvals' : ctx.section;
  let cur = SECTIONS.some(s => s[0] === want) ? want : (() => { try { const s = localStorage.getItem(SK); return SECTIONS.some(x => x[0] === s) ? s : 'directives'; } catch { return 'directives'; } })();
  let stop = null, token = 0;
  el.innerHTML = `<div class="bar" id="pds" role="tablist" aria-label="President Desk" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px"></div><div id="pdb"></div>`;
  const bar = el.querySelector('#pds'), body = el.querySelector('#pdb');
  async function show(id) {
    cur = id; const my = ++token;
    try { localStorage.setItem(SK, id); } catch { /* ignore */ }
    bar.innerHTML = SECTIONS.map(([k, l]) => `<button class="btn ${k === id ? 'gold' : 'ghost'} sm" role="tab" aria-selected="${k === id}" data-s="${k}">${esc(l)}</button>`).join('');
    bar.querySelectorAll('[data-s]').forEach(b => b.onclick = () => { if (b.dataset.s !== cur) show(b.dataset.s); });
    if (typeof stop === 'function') { try { stop(); } catch { /* ignore */ } } stop = null;
    body.innerHTML = '';
    const mount = await SECTIONS.find(s => s[0] === id)[2]();
    if (my !== token) return;
    const sub = document.createElement('div'); body.appendChild(sub);
    const off = await mount(sub, ctx);
    if (my !== token) { if (typeof off === 'function') off(); return; }
    stop = off;
  }
  await show(cur);
  return () => { token++; if (typeof stop === 'function') { try { stop(); } catch { /* ignore */ } } };
}
