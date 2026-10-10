import { sb, db, esc, peso, fmtDate, fmtDateTime, onSync, skeleton, modal, initials, dayLabel } from '../core.js';

const FB = 'https://www.facebook.com/plugins/page.php?href=https%3A%2F%2Fwww.facebook.com%2Fprofile.php%3Fid%3D61593577524416&tabs=timeline&width=500&height=600&small_header=false&adapt_container_width=true&hide_cover=false&show_facepile=false';
const WAVE = '<svg viewBox="0 0 1200 46" preserveAspectRatio="none" aria-hidden="true"><path d="M0 24C150 4 300 4 450 22s300 20 450 2 225-14 300-4v26H0z"/></svg>';

export async function renderPublic(root) {
  root.innerHTML = `<div class="top"><img src="assets/wolf-crest.png" alt=""><div class="t"><b>ALPHA SUITE</b><small>BSMT 1-Alpha · Batch 28 · PIT-COMED</small></div>
    <span class="chip" id="sync"><i></i><span>Live</span></span><a class="btn gold sm" href="#/staff" style="text-decoration:none;display:inline-grid;align-items:center">Officer sign in</a></div>
    <main id="m" style="padding-bottom:40px">${skeleton(5)}</main>`;
  const off = onSync((s, d) => { const c = root.querySelector('#sync'); if (!c) return; c.className = 'chip ' + s;
    c.querySelector('span').textContent = { live: 'Live', syncing: 'Syncing…', offline: 'Offline', error: 'Sync error' }[s]; c.title = d || ''; });
  let tab = 'fund', data = null;
  const m = root.querySelector('#m');

  const byDay = list => { const g = new Map(); list.forEach(e => { const k = dayLabel(e.at); g.set(k, [...(g.get(k) || []), e]); }); return g; };
  const entryRow = e => `<div class="row"><div class="lead"><span class="ini ${e.kind === 'expense' ? 'out' : ''}">${esc(initials(e.payer))}</span>
    <div class="m"><b>${esc(e.payer || '—')}</b><small>${esc(e.purpose || e.category)}</small></div></div><span class="amt ${e.kind === 'expense' ? 'out' : 'in'}">${e.kind === 'expense' ? '−' : '+'}${peso(e.amount)}</span></div>`;
  const grouped = list => list.length ? [...byDay(list)].map(([d, es]) => `<div class="dayhead">${esc(d)}</div>${es.map(entryRow).join('')}`).join('') : '<div class="empty"><b>No entries yet</b>Collections and expenses show up here as soon as they are approved.</div>';

  function openPeriod(p) {
    const list = (data.tre.entries || []).filter(e => e.period_id === p.id);
    modal(`<h3>${esc(p.name)}</h3><p class="muted" style="margin:4px 0 10px">Closed ${fmtDate(p.closed_at)} · collected ${peso(p.collections_total)} · spent ${peso(p.expenses_total)} · balance ${peso(p.closing_balance)}</p>${grouped(list)}
      <button class="btn ghost" id="x" style="width:100%;margin-top:14px">Close</button>`, (el, close) => { el.querySelector('#x').onclick = close; });
  }

  function paint() {
    const { off: officers, tre, stand } = data;
    const cur = tre.open ? (tre.entries || []).filter(e => e.period_id === tre.open.id) : [];
    const views = {
      fund: () => `<div class="card pad" style="padding-bottom:6px"><h3 style="margin-bottom:2px">${esc(tre.open?.name || 'Current period')}</h3>${grouped(cur)}</div>
        <h3 style="margin:18px 2px 8px">Past collection periods</h3>
        ${(tre.past || []).length ? `<div class="card">${tre.past.map(p => `<button class="row" data-p="${p.id}" style="width:100%;background:none;border:0;border-bottom:1px solid var(--line);text-align:left;cursor:pointer"><div class="m"><b>${esc(p.name)}</b><small>Closed ${fmtDate(p.closed_at)}</small></div>
          <div style="text-align:right"><div class="amt">${peso(p.closing_balance)}</div><small class="muted">${peso(p.collections_total)} in · ${peso(p.expenses_total)} out</small></div></button>`).join('')}</div>` : '<div class="empty"><b>No closed periods</b>When the Mayor closes a collection period, its full record is kept here.</div>'}`,
      standing: () => `<div class="card">${stand.length ? stand.map(s => `<div class="row"><div class="lead"><span class="ini">${esc(initials(s.name))}</span><b>${esc(s.name)}</b></div><span class="tag bad">${s.outstanding} outstanding</span></div>`).join('')
        : '<div class="empty"><b>Everyone is in good standing</b>No outstanding violations right now.</div>'}</div>`,
      officers: () => `<div class="officers">${officers.map(o => `<div class="ocard"><div class="ph">${o.photo ? `<img src="${o.photo}" alt="${esc(o.name)}" style="object-position:${o.x}% ${o.y}%">` : esc(initials(o.name))}</div><div class="tx"><b>${esc(o.name)}</b><small>${esc(o.position)}</small></div></div>`).join('')}</div>`,
      bulletin: () => `<iframe class="fb" src="${FB}" width="500" height="600" scrolling="yes" loading="lazy" title="Class Facebook page" allow="encrypted-media"></iframe>`,
    };
    m.innerHTML = `<div class="waterline"><img class="crest" src="assets/wolf-crest.png" alt=""><small>Class fund balance</small><div class="big">${peso(tre.balance)}</div>
        <p>${esc(tre.open?.name || '')}${stand.length ? ` · ${stand.length} student${stand.length > 1 ? 's' : ''} with open violations` : ''}</p>${WAVE}</div>
      <div class="seg" role="tablist">${[['fund', 'Fund'], ['standing', 'Standing'], ['officers', 'Officers'], ['bulletin', 'Bulletin']].map(([k, l]) => `<button role="tab" data-t="${k}" class="${tab === k ? 'on' : ''}" aria-selected="${tab === k}">${l}</button>`).join('')}</div>
      <section>${views[tab]()}</section>`;
    m.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { tab = b.dataset.t; paint(); });
    m.querySelectorAll('[data-p]').forEach(b => b.onclick = () => openPeriod(tre.past.find(p => p.id === b.dataset.p)));
  }
  async function load() {
    try {
      const [o, t, s] = await Promise.all([db(sb.rpc('v2_public_officers')), db(sb.rpc('v2_public_treasury')), db(sb.rpc('v2_public_standing'))]);
      data = { off: o, tre: t, stand: s }; paint();
    } catch (e) { if (!data) m.innerHTML = `<div class="card pad"><b>Couldn't load the class page.</b><p class="muted">${esc(e.message)}</p><button class="btn" onclick="location.reload()">Try again</button></div>`; }
  }
  await load();
  const iv = setInterval(load, 60000);
  return () => { off(); clearInterval(iv); };
}
