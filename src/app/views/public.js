import { sb, db, esc, peso, fmtDate, onSync, watch, skeleton } from '../core.js';

const FB = 'https://www.facebook.com/plugins/page.php?href=https%3A%2F%2Fwww.facebook.com%2Fprofile.php%3Fid%3D61593577524416&tabs=timeline&width=500&height=560&small_header=false&adapt_container_width=true&hide_cover=false&show_facepile=false';

export async function renderPublic(root) {
  root.innerHTML = `<div class="top"><img src="assets/wolf-crest.png" alt=""><div class="t"><b>ALPHA SUITE</b><small>BSMT 1-Alpha · Batch 28 · PIT-COMED</small></div>
    <span class="chip" id="sync"><i></i><span>Live</span></span><a class="btn gold sm" href="#/staff" style="text-decoration:none">Officer sign in</a></div>
    <main id="m">${skeleton(5)}</main>`;
  const off = onSync((s, d) => { const c = root.querySelector('#sync'); if (!c) return; c.className = 'chip ' + s;
    c.querySelector('span').textContent = { live: 'Live', syncing: 'Syncing…', offline: 'Offline', error: 'Sync error' }[s]; c.title = d || ''; });
  let openPast = null, data = null;
  const m = root.querySelector('#m');

  const list = id => ((data.tre.entries || []).filter(e => e.period_id === id).map(e => `<div class="row"><div class="m"><b>${esc(e.payer || '—')}</b>
    <small>${esc(e.category)}${e.purpose ? ' · ' + esc(e.purpose) : ''} · ${fmtDate(e.at)}</small></div>
    <div class="amt ${e.kind === 'expense' ? 'out' : 'in'}">${e.kind === 'expense' ? '−' : '+'}${peso(e.amount)}</div></div>`).join('')) || '<p class="empty">No entries.</p>';

  function paint() {
    const { off: officers, tre, stand } = data;
    m.innerHTML = `<div class="hero"><img src="assets/wolf-crest.png" alt=""><div><h1>BSMT 1-ALPHA</h1><p>Class fund, standing board and officers — updated live.</p></div></div>
      <h2 style="margin:4px 0 10px">Class Fund</h2>
      <div class="grid"><div class="stat gold"><small>Current balance</small><b>${peso(tre.balance)}</b></div><div class="stat"><small>Period</small><b style="font-size:1rem">${esc(tre.open?.name || '—')}</b></div></div>
      <div class="card" style="margin-top:12px"><h3 style="font-size:1rem;margin-bottom:4px">Current period</h3>${tre.open ? list(tre.open.id) : ''}</div>
      <h3 style="margin:18px 0 8px">Past collection periods</h3>
      ${(tre.past || []).map(p => `<div class="card"><div class="row" style="border:0;cursor:pointer" data-p="${p.id}"><div class="m"><b>${esc(p.name)}</b><small>Closed ${fmtDate(p.closed_at)}</small></div>
        <div style="text-align:right"><div class="amt">${peso(p.closing_balance)}</div><small class="muted">in ${peso(p.collections_total)} · out ${peso(p.expenses_total)}</small></div></div>${openPast === p.id ? list(p.id) : ''}</div>`).join('') || '<p class="empty">None yet.</p>'}
      <h2 style="margin:22px 0 10px">Standing Board</h2>
      <div class="card">${stand.length ? stand.map(s => `<div class="row"><b>${esc(s.name)}</b><span class="tag bad">${s.outstanding} outstanding</span></div>`).join('') : '<p class="empty">Everyone is in good standing.</p>'}</div>
      <h2 style="margin:22px 0 10px">Officers</h2>
      <div class="card">${officers.map(o => `<div class="row"><div class="officer"><div class="av">${o.photo ? `<img src="${o.photo}" alt="" style="object-position:${o.x}% ${o.y}%">` : esc(o.name.split(' ').map(w => w[0]).slice(0, 2).join(''))}</div>
        <div><b>${esc(o.name)}</b><br><small class="muted">${esc(o.position)}</small></div></div></div>`).join('')}</div>
      <h2 style="margin:22px 0 10px">Class Bulletin</h2><iframe class="fb" src="${FB}" width="500" height="560" scrolling="yes" loading="lazy" title="Facebook page" allow="encrypted-media"></iframe>`;
    m.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { openPast = openPast === b.dataset.p ? null : b.dataset.p; paint(); });
  }
  async function load() {
    try {
      const [o, t, s] = await Promise.all([db(sb.rpc('v2_public_officers')), db(sb.rpc('v2_public_treasury')), db(sb.rpc('v2_public_standing'))]);
      data = { off: o, tre: t, stand: s }; paint();
    } catch (e) { if (!data) m.innerHTML = `<div class="card"><b>Couldn't load.</b><p class="muted">${esc(e.message)}</p><button class="btn" onclick="location.reload()">Retry</button></div>`; }
  }
  await load();
  const iv = setInterval(load, 60000);
  return () => { off(); clearInterval(iv); };
}
