import { sb, db, esc, peso, fmtDate, onSync, skeleton, modal, initials, dayLabel, share, toast } from '../core.js';
import { renderLearn } from './learn.js';
import { t, getLang, setLang } from '../i18n.js';
import { scanRaw, readQRFromFile } from '../qr.js';
import { pushState, enablePush, disablePush } from '../push.js';

const FB = 'https://www.facebook.com/plugins/page.php?href=https%3A%2F%2Fwww.facebook.com%2Fprofile.php%3Fid%3D61593577524416&tabs=timeline&width=500&height=600&small_header=false&adapt_container_width=true&hide_cover=false&show_facepile=false';
const PERIOD = 'q150 -26 300 0 t300 0 t300 0 t300 0 t300 0 t300 0 t300 0 t300 0';
const ROSE = (() => { let t = ''; for (let i = 0; i < 72; i++) t += `<line x1="0" y1="-${i % 6 ? 90 : 86}" x2="0" y2="-94" transform="rotate(${i * 5})" stroke="#2a7fb0" stroke-opacity="${i % 6 ? .3 : .6}" stroke-width="${i % 6 ? 1 : 1.6}"/>`; return `<svg viewBox="-100 -100 200 200" aria-hidden="true"><circle r="97" fill="none" stroke="#2a7fb0" stroke-opacity=".4" stroke-width="1.5"/><circle r="72" fill="none" stroke="#2a7fb0" stroke-opacity=".25" stroke-dasharray="2 5"/>${t}
  <polygon points="0,-96 11,-11 96,0 11,11 0,96 -11,11 -96,0 -11,-11" fill="#d9a63c" fill-opacity=".38"/><polygon points="0,-62 7,-7 62,0 7,7 0,62 -7,7 -62,0 -7,-7" transform="rotate(45)" fill="#2a7fb0" fill-opacity=".3"/></svg>`; })();
const FLAG = '<svg viewBox="0 0 70 64" aria-label="Alpha signal flag"><rect x="0" y="0" width="3" height="64" rx="1.5" fill="#9a6f12"/><path d="M3 6H35V32H3z" fill="#fff" stroke="#0c1f5c" stroke-width="1"/><path d="M35 6H68L52 19 68 32H35z" fill="#1d4fd8" stroke="#0c1f5c" stroke-width="1"/></svg>';
const SHIP = '<svg viewBox="0 0 64 36" aria-hidden="true"><path d="M2 24H62L54 34H11z" fill="#0c1f5c"/><rect x="6" y="14" width="10" height="10" fill="#d0453c"/><rect x="17" y="14" width="10" height="10" fill="#d9a63c"/><rect x="28" y="14" width="10" height="10" fill="#2a7fb0"/><rect x="42" y="8" width="12" height="16" fill="#fff" stroke="#0c1f5c"/><rect x="45" y="3" width="6" height="6" fill="#0c1f5c"/><rect x="44" y="11" width="8" height="3" fill="#2a7fb0"/></svg>';
const SEA = `<div class="sea" aria-hidden="true"><svg class="w1" viewBox="0 0 2400 110" preserveAspectRatio="none"><path d="M0 46 ${PERIOD} V110H0z" fill="#2a7fb0" fill-opacity=".28"/></svg>
  <svg class="w2" viewBox="0 0 2400 110" preserveAspectRatio="none"><path d="M0 62 ${PERIOD.replace('q150 -26', 'q150 24')} V110H0z" fill="#2a7fb0" fill-opacity=".42"/></svg>
  <svg class="w3" viewBox="0 0 2400 110" preserveAspectRatio="none"><path d="M0 82 q150 -20 300 0 t300 0 t300 0 t300 0 t300 0 t300 0 t300 0 t300 0 V110H0z" fill="#fff"/></svg></div>`;
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
function countUp(el, to) {
  if (reduceMotion()) { el.textContent = peso(to); return; }
  const t0 = performance.now(), dur = 1100;
  const step = t => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = peso(to * e); if (k < 1) requestAnimationFrame(step); else el.textContent = peso(to); };
  requestAnimationFrame(step);
}

const ME = 'alpha-me';
const ordn = n => { const r = n % 100; if (r >= 11 && r <= 13) return n + 'th'; return n + (['th','st','nd','rd'][n % 10] || 'th'); };
function renderMe(host) {
  const get = () => { try { return localStorage.getItem(ME) || ''; } catch { return ''; } };
  const put = v => { try { v ? localStorage.setItem(ME, v) : localStorage.removeItem(ME); } catch { /* ignore */ } };
  async function show(token) {
    host.innerHTML = skeleton(3);
    try {
      const { data, error } = await sb.rpc('v2_self_check', { p_token: token }); if (error) throw error;
      put(token);
      const owed = data.balances.reduce((a, b) => a + +b.owed, 0), open = data.violations.filter(v => v.status !== 'resolved');
      host.innerHTML = `<div class="card pad"><small>${t('hello')}</small><h2 style="margin:2px 0 8px">${esc(data.name)}</h2>
        <div style="font-size:1.15rem;font-weight:700;color:var(${owed ? '--bad' : '--ok'})">${owed ? `${t('owed')} ${peso(owed)}` : '✓ ' + t('clear')}</div></div>
        <div class="card">${data.balances.map(b => `<div class="row"><div class="m"><b>${esc(b.charge)}</b><small>${peso(b.paid)} / ${peso(b.due)}</small></div><span class="tag ${+b.owed ? 'bad' : 'ok'}">${+b.owed ? peso(b.owed) : t('paid')}</span></div>`).join('') || '<p class="empty">—</p>'}</div>
        <div class="card">${data.violations.map(v => `<div class="row"><div class="m"><b>${esc(v.standard)}</b><small>${fmtDate(v.date)} · ${v.offense === 1 ? '1st offense: verbal warning' : ordn(v.offense) + ' offense: ₱25 fine'}</small></div><span class="tag ${v.status === 'resolved' ? 'ok' : 'bad'}">${v.status === 'resolved' ? t('resolved') : t('outstanding')}</span></div>`).join('') || `<div class="empty"><b>${t('noviol')}</b></div>`}</div>
        <p style="text-align:center"><button class="btn ghost sm" id="fg">${t('forget')}</button></p>`;
      host.querySelector('#fg').onclick = () => { put(''); start(); };
    } catch (e) { put(''); start(e.message); }
  }
  function start(err = '') {
    host.innerHTML = `<div class="card pad" style="text-align:center"><h3>${t('mytitle')}</h3><p class="muted">${t('mydesc')}</p>
      <div style="display:grid;gap:8px;max-width:320px;margin:14px auto 0"><button class="btn gold" id="sc">${t('scan')}</button>
      <label class="btn ghost" style="cursor:pointer">${t('photo')}<input id="ph" type="file" accept="image/*" hidden></label>
      <button class="btn ghost" id="pa">${t('paste')}</button></div><div class="err" id="er" style="margin-top:10px">${esc(err)}</div></div>`;
    const go = async fn => { try { const tk = await fn(); if (tk) show(tk); } catch (e) { host.querySelector('#er').textContent = e.message; } };
    host.querySelector('#sc').onclick = () => go(() => scanRaw());
    host.querySelector('#ph').onchange = e => e.target.files[0] && go(() => readQRFromFile(e.target.files[0]));
    host.querySelector('#pa').onclick = () => go(() => { const v = prompt('Paste the code under your QR (starts with A1.)'); return v && v.trim(); });
  }
  const saved = get(); saved ? show(saved) : start();
}

export async function renderPublic(root) {
  root.innerHTML = `<div class="top"><span class="crest-ring"><img src="assets/wolf-crest.png" alt=""></span><div class="t"><b>Alpha ’28</b><small>BSMT 1-Alpha · Batch 28 · PIT-COMED</small></div>
    <span class="chip" id="sync"><i></i><span>Live</span></span><button class="btn ghost sm" id="lang" aria-label="Language">${getLang() === 'ceb' ? 'EN' : 'CEB'}</button><a class="btn gold sm" href="#/staff" style="text-decoration:none;display:inline-grid;align-items:center">${t('signin')}</a></div>
    <main id="m" style="padding-bottom:40px">${skeleton(5)}</main>`;
  const off = onSync((s, d) => { const c = root.querySelector('#sync'); if (!c) return; c.className = 'chip ' + s;
    c.querySelector('span').textContent = { live: 'Live', syncing: 'Syncing…', offline: 'Offline', error: 'Sync error' }[s]; c.title = d || ''; });
  let pstate = 'unsupported', tab = 'fund', data = null, animated = false, vf = 'open', vq = '';
  const ord = n => { const r = n % 100; if (r >= 11 && r <= 13) return n + 'th'; return n + (['th','st','nd','rd'][n % 10] || 'th'); };
  const isOpen = v => v.status !== 'resolved';
  const m = root.querySelector('#m');
  root.querySelector('#lang').onclick = () => { setLang(getLang() === 'ceb' ? 'en' : 'ceb'); renderPublic(root); };

  const byDay = list => { const g = new Map(); list.forEach(e => { const k = dayLabel(e.at); g.set(k, [...(g.get(k) || []), e]); }); return g; };
  const entryRow = e => `<div class="row"><div class="lead"><span class="ini ${e.kind === 'expense' ? 'out' : ''}">${esc(initials(e.payer))}</span>
    <div class="m"><b>${esc(e.payer || '—')}</b><small>${esc(e.purpose || e.category)}</small></div></div><span class="amt ${e.kind === 'expense' ? 'out' : 'in'}">${e.kind === 'expense' ? '−' : '+'}${peso(e.amount)}</span></div>`;
  const grouped = list => list.length ? [...byDay(list)].map(([d, es]) => `<div class="dayhead">${esc(d)}</div>${es.map(entryRow).join('')}`).join('') : `<div class="empty"><b>${t('noentries')}</b>${t('noentriesd')}</div>`;

  function openPeriod(p) {
    const list = (data.tre.entries || []).filter(e => e.period_id === p.id);
    modal(`<h3>${esc(p.name)}</h3><p class="muted" style="margin:4px 0 10px">Closed ${fmtDate(p.closed_at)} · collected ${peso(p.collections_total)} · spent ${peso(p.expenses_total)} · balance ${peso(p.closing_balance)}</p>${grouped(list)}
      <button class="btn ghost" id="x" style="width:100%;margin-top:14px">Close</button>`, (el, close) => { el.querySelector('#x').onclick = close; });
  }

  const alertBar = () => {
    const box = (txt, btn) => `<div class="alertbar"><span>🔔 ${txt}</span>${btn}</div>`;
    if (pstate === 'off') return box(t('alertOff'), `<button class="btn gold sm" id="pon">${t('turnOn')}</button>`);
    if (pstate === 'on') return box(t('alertOn'), `<button class="btn ghost sm" id="poff">${t('turnOff')}</button>`);
    if (pstate === 'ios-install') return box(t('alertIos'), '');
    if (pstate === 'denied') return box(t('alertDenied'), '');
    return '';
  };
  const seenKey = 'alpha-seen-ann';
  function announceNew(list) {
    try {
      const seen = JSON.parse(localStorage.getItem(seenKey) || 'null'), ids = list.map(a => a.id);
      if (seen) list.filter(a => !seen.includes(a.id)).forEach(a => toast('📣 ' + a.title));
      localStorage.setItem(seenKey, JSON.stringify(ids));
    } catch { /* storage unavailable */ }
  }
  function paint() {
    const { off: officers, tre, stand } = data;
    const cur = tre.open ? (tre.entries || []).filter(e => e.period_id === tre.open.id) : [];
    const views = {
      fund: () => `${(data.prog || []).length ? `<div class="card pad"><h3 style="margin-bottom:8px">${t('progress')}</h3>${data.prog.map(p => { const pc = p.total ? Math.round(p.paid / p.total * 100) : 0;
          return `<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;gap:8px"><b>${esc(p.charge)} · ${peso(p.amount)}</b><span class="muted">${p.paid}/${p.total} ${t('paid')}</span></div><div class="prog"><i style="width:${pc}%"></i></div></div>`; }).join('')}</div>` : ''}
        <div class="card pad" style="padding-bottom:6px"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h3 style="margin-bottom:2px">${esc(tre.open?.name || 'Current period')}</h3><button class="btn ghost sm" id="shf">${t('share')}</button></div>${grouped(cur)}</div>
        <h3 style="margin:18px 2px 8px">${t('past')}</h3>
        ${(tre.past || []).length ? `<div class="card">${tre.past.map(p => `<button class="row" data-p="${p.id}" style="width:100%;background:none;border:0;border-bottom:1px solid var(--line);text-align:left;cursor:pointer"><div class="m"><b>${esc(p.name)}</b><small>Closed ${fmtDate(p.closed_at)}</small></div>
          <div style="text-align:right"><div class="amt">${peso(p.closing_balance)}</div><small class="muted">${peso(p.collections_total)} in · ${peso(p.expenses_total)} out</small></div></button>`).join('')}</div>` : '<div class="empty"><b>No closed periods</b>When the Mayor closes a collection period, its full record is kept here.</div>'}`,
      standing: () => {
        const all = data.viol || [], nOpen = all.filter(isOpen).length, nRes = all.length - nOpen;
        const q = vq.trim().toLowerCase();
        const list = all.filter(v => (vf === 'all' || (vf === 'open' ? isOpen(v) : !isOpen(v))) && (!q || v.name.toLowerCase().includes(q) || (v.standard || '').toLowerCase().includes(q)));
        const row = v => `<div class="row"><div class="lead"><span class="ini">${esc(initials(v.name))}</span><div class="m"><b>${esc(v.name)}</b>
          <small>${esc(v.standard)} · ${fmtDate(v.date)} · ${v.offense === 1 ? '1st offense: verbal warning' : `${ord(v.offense)} offense: ₱25 fine`}</small></div></div>
          <span class="tag ${isOpen(v) ? 'bad' : 'ok'}">${isOpen(v) ? t('outstanding') : t('resolved')}</span></div>`;
        return `<div class="card pad" style="display:flex;gap:18px;flex-wrap:wrap;margin-bottom:10px"><div><b style="font-size:1.4rem">${nOpen}</b><br><small class="muted">${t('outstanding').toLowerCase()}</small></div><div><b style="font-size:1.4rem">${nRes}</b><br><small class="muted">${t('resolved').toLowerCase()}</small></div><div><b style="font-size:1.4rem">${all.length}</b><br><small class="muted">${t('total')}</small></div><button class="btn ghost sm" id="shv" style="margin-left:auto;align-self:center">${t('share')}</button></div>
          <div class="seg" id="vf" style="margin-bottom:8px">${[['open',t('outstanding')],['done',t('resolved')],['all',t('all')]].map(([k,l]) => `<button data-vf="${k}" class="${vf === k ? 'on' : ''}">${l}</button>`).join('')}</div>
          <input id="vq" type="search" placeholder="${t('search')}" value="${esc(vq)}" aria-label="Search violations" style="width:100%;margin-bottom:10px">
          <div class="card">${list.length ? list.map(row).join('') : `<div class="empty"><b>${t('nomatch')}</b></div>`}</div>`;
      },
      officers: () => `<div class="officers">${officers.map(o => `<div class="ocard"><div class="ph">${o.photo ? `<img src="${o.photo}" alt="${esc(o.name)}" style="object-position:${o.x}% ${o.y}%">` : esc(initials(o.name))}</div><div class="tx"><b>${esc(o.name)}</b><small>${esc(o.position)}</small></div></div>`).join('')}</div>`,
      me: () => '',
      learn: () => '',
      bulletin: () => `<iframe class="fb" src="${FB}" width="500" height="600" scrolling="yes" loading="lazy" title="Class Facebook page" allow="encrypted-media"></iframe>`,
    };
    m.innerHTML = `${(data.ann || []).length ? `<div class="notices">${data.ann.map(a => `<div class="notice ${a.pinned ? 'pin' : ''}"><b>${a.pinned ? '📌 ' : '📣 '}${esc(a.title)}</b>${a.body ? `<p>${esc(a.body)}</p>` : ''}</div>`).join('')}</div>` : ''}${alertBar()}<div class="hero"><div class="flag">${FLAG}</div>
        <div class="emblem">${'<div class="rose">' + ROSE + '</div>'}<span class="crest-ring"><img src="assets/wolf-crest.png" alt="Alpha crest"></span></div>
        <div class="copy"><small>${t('balance')}</small><div class="big" id="bal">${peso(tre.balance)}</div>
          <p>${esc(tre.open?.name || '')}${stand.length ? ` · ${stand.length} ${t('openv')}` : ' · ' + t('good')}</p></div>
        <div class="ship">${SHIP}</div>${SEA}</div>
      <div class="seg" role="tablist">${[['fund', t('fund')], ['standing', t('viol')], ['me', t('me')], ['officers', t('officers')], ['learn', t('learn')], ['bulletin', t('bulletin')]].map(([k, l]) => `<button role="tab" data-t="${k}" class="${tab === k ? 'on' : ''}" aria-selected="${tab === k}">${l}</button>`).join('')}</div>
      <section id="sec">${tab === 'learn' || tab === 'me' ? '' : views[tab]()}</section>`;
    if (!animated) { animated = true; countUp(m.querySelector('#bal'), +tre.balance || 0); }
    if (tab === 'learn') renderLearn(m.querySelector('#sec'));
    if (tab === 'me') renderMe(m.querySelector('#sec'));
    m.querySelector('#pon')?.addEventListener('click', async e => { e.target.disabled = true; try { await enablePush(); toast('Alerts are on'); } catch (x) { toast(x.message, true); } pstate = await pushState(); paint(); });
    m.querySelector('#poff')?.addEventListener('click', async () => { try { await disablePush(); } catch { /* ignore */ } pstate = await pushState(); paint(); });
    m.querySelector('#shf')?.addEventListener('click', () => share({ title: 'BSMT 1-Alpha class fund', text: `BSMT 1-Alpha fund balance: ${peso(tre.balance)}.`, url: location.origin + location.pathname }));
    m.querySelector('#shv')?.addEventListener('click', () => share({ title: 'BSMT 1-Alpha violations', text: 'BSMT 1-Alpha public violation ledger.', url: location.origin + location.pathname }));
    m.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { tab = b.dataset.t; paint(); });
    m.querySelectorAll('[data-vf]').forEach(b => b.onclick = () => { vf = b.dataset.vf; paint(); });
    const qi = m.querySelector('#vq'); if (qi) qi.oninput = () => { vq = qi.value; const pos = qi.selectionStart; paint(); const n = m.querySelector('#vq'); n.focus(); n.setSelectionRange(pos, pos); };
    m.querySelectorAll('[data-p]').forEach(b => b.onclick = () => openPeriod(tre.past.find(p => p.id === b.dataset.p)));
  }
  async function load() {
    try {
      const opt = p => db(p).catch(() => []);
      const [o, tr, s, vv, ann, prog] = await Promise.all([db(sb.rpc('v2_public_officers')), db(sb.rpc('v2_public_treasury')), db(sb.rpc('v2_public_standing')), db(sb.rpc('v2_public_violations')), opt(sb.rpc('v2_public_announcements')), opt(sb.rpc('v2_public_progress'))]);
      const first = !data; data = { off: o, tre: tr, stand: s, viol: vv, ann, prog }; announceNew(ann); if (first) pstate = await pushState(); if (first || (tab !== 'learn' && tab !== 'me')) paint();
    } catch (e) { if (!data) m.innerHTML = `<div class="card pad"><b>Couldn't load the class page.</b><p class="muted">${esc(e.message)}</p><button class="btn" onclick="location.reload()">Try again</button></div>`; }
  }
  await load();
  const iv = setInterval(load, 60000);
  return () => { off(); clearInterval(iv); };
}
