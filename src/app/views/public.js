import { FUNDS, fundLabel, sb, db, esc, peso, fmtDate, onSync, skeleton, modal, initials, dayLabel, share, toast, printHTML, letterhead } from '../core.js';
import { t, getLang, setLang } from '../i18n.js';
import { getTheme, setTheme, getTextSize, setTextSize } from '../display.js';
import { showOfficerProfile } from '../profile.js';
import { heroScene, warmScenes, sceneMode, setSceneMode } from '../scenes.js';
import { percentPaid } from '../money.js';
import { pushState, enablePush, disablePush, linkDevice } from '../push.js';

const FB = 'https://www.facebook.com/plugins/page.php?href=https%3A%2F%2Fwww.facebook.com%2Fprofile.php%3Fid%3D61593577524416&tabs=timeline&width=500&height=600&small_header=false&adapt_container_width=true&hide_cover=false&show_facepile=false';
const ROSE = (() => { let t = ''; for (let i = 0; i < 72; i++) t += `<line x1="0" y1="-${i % 6 ? 90 : 86}" x2="0" y2="-94" transform="rotate(${i * 5})" stroke="#2a7fb0" stroke-opacity="${i % 6 ? .3 : .6}" stroke-width="${i % 6 ? 1 : 1.6}"/>`; return `<svg viewBox="-100 -100 200 200" aria-hidden="true"><circle r="97" fill="none" stroke="#2a7fb0" stroke-opacity=".4" stroke-width="1.5"/><circle r="72" fill="none" stroke="#2a7fb0" stroke-opacity=".25" stroke-dasharray="2 5"/>${t}
  <polygon points="0,-96 11,-11 96,0 11,11 0,96 -11,11 -96,0 -11,-11" fill="#d9a63c" fill-opacity=".38"/><polygon points="0,-62 7,-7 62,0 7,7 0,62 -7,7 -62,0 -7,-7" transform="rotate(45)" fill="#2a7fb0" fill-opacity=".3"/></svg>`; })();
const TABS = ['fund', 'standing', 'me', 'officers', 'learn', 'bulletin'];
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
function countUp(el, to) {
  if (reduceMotion()) { el.textContent = peso(to); return; }
  const t0 = performance.now(), dur = 1100;
  const step = t => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = peso(to * e); if (k < 1) requestAnimationFrame(step); else el.textContent = peso(to); };
  requestAnimationFrame(step);
}

const ME = 'alpha-me';
const ordn = n => { const r = n % 100; if (r >= 11 && r <= 13) return n + 'th'; return n + (['th','st','nd','rd'][n % 10] || 'th'); };

/* Balance reminders: a student links their own phone to their QR card, so the Treasurer can remind only those who still owe. */
async function remBox(rm, token) {
  if (!rm) return;
  const bar = (txt, btn = '') => { rm.innerHTML = `<div class="alertbar" style="margin:10px 0"><span>🔔 ${txt}</span>${btn}</div>`; };
  const ps = await pushState();
  if (ps === 'on') { try { await linkDevice(token); bar(t('remOn')); } catch { rm.innerHTML = ''; } }
  else if (ps === 'off') {
    bar(t('remOff'), `<button class="btn gold sm" id="ron">${t('turnOn')}</button>`);
    rm.querySelector('#ron').onclick = async e => { e.target.disabled = true; try { await enablePush(false, token); toast(t('remOn')); } catch (x) { toast(x.message, true); } remBox(rm, token); };
  } else if (ps === 'ios-install') bar(t('alertIos'));
  else if (ps === 'denied') bar(t('alertDenied'));
}

/* A student's own statement of account (what they paid and what they still owe), printable as a PDF. */
async function statement(token) {
  let d;
  try { const { data, error } = await sb.rpc('v2_self_statement', { p_token: token }); if (error) throw error; d = data; }
  catch (e) { return toast(/function|schema cache/i.test(e.message) ? 'Statements are not switched on yet. Ask the Mayor.' : e.message, true); }
  const paid = d.payments.filter(p => p.status === 'approved').reduce((a, p) => a + +p.amount, 0), owe = d.balances.reduce((a, b) => a + +b.owed, 0);
  const rows = d.payments.map(p => `<div class="row"><div class="m"><b>${esc(p.for)}</b><small>${fmtDate(p.at)}${p.receipt_no ? ' · ' + esc(p.receipt_no) : ''}${p.fund ? ' · ' + esc(fundLabel(p.fund)) : ''}${p.status === 'pending' ? ' · awaiting approval' : ''}</small></div><b>${peso(p.amount)}</b></div>`).join('') || `<p class="empty">${t('stmtNone')}</p>`;
  const owing = d.balances.filter(b => +b.owed > 0 && !b.closed).map(b => `<div class="row"><div class="m"><b>${esc(b.charge)}</b><small>${peso(b.paid)} / ${peso(b.due)}</small></div><span class="tag bad">${peso(b.owed)}</span></div>`).join('');
  modal(`<h3>${t('stmtTitle')}</h3><p class="muted" style="margin:0 0 8px">${esc(d.name)}${d.student_no && !/^PENDING/.test(d.student_no) ? ' · ' + esc(d.student_no) : ''}</p>
    <div class="grid"><div class="stat gold"><small>${t('stmtPaid')}</small><b>${peso(paid)}</b></div><div class="stat"><small>${t('stmtOwe')}</small><b>${peso(owe)}</b></div></div>
    <div class="card" style="margin-top:10px;max-height:44vh;overflow:auto">${rows}</div>${owing ? `<div class="card">${owing}</div>` : ''}
    <div style="display:flex;gap:8px;margin-top:12px"><button class="btn gold" id="sp" style="flex:1">${t('stmtPrint')}</button><button class="btn ghost" id="sc">${t('stmtClose')}</button></div>`,
    (m, close) => {
      m.querySelector('#sc').onclick = close;
      m.querySelector('#sp').onclick = () => {
        const tbl = `<table><thead><tr><th>Date</th><th>For</th><th>Receipt no.</th><th>Verify code</th><th class="r">Amount</th></tr></thead><tbody>${d.payments.map(p => `<tr><td>${fmtDate(p.at)}</td><td>${esc(p.for)}${p.fund ? ' · ' + esc(fundLabel(p.fund)) : ''}</td><td>${esc(p.receipt_no || '—')}${p.status === 'pending' ? ' (awaiting approval)' : ''}</td><td>${esc(p.code || '—')}</td><td class="r">${peso(p.amount)}</td></tr>`).join('') || '<tr><td colspan="5">No payments yet</td></tr>'}</tbody></table>`;
        const ow = d.balances.filter(b => +b.owed > 0 && !b.closed);
        printHTML('Statement - ' + d.name, `${letterhead('Statement of account', d.name + ' · BSMT 1-Alpha · Batch 28')}<div class="sum"><div>Payments made<b>${peso(paid)}</b></div><div>Still owed<b>${peso(owe)}</b></div></div>
          <h2>Payments</h2>${tbl}${ow.length ? `<h2>Still owed</h2><table><thead><tr><th>Charge</th><th class="r">Paid</th><th class="r">Due</th><th class="r">Owed</th></tr></thead><tbody>${ow.map(b => `<tr><td>${esc(b.charge)}</td><td class="r">${peso(b.paid)}</td><td class="r">${peso(b.due)}</td><td class="r">${peso(b.owed)}</td></tr>`).join('')}</tbody></table>` : '<p>✓ All charges are paid up.</p>'}
          <p style="font-size:11px;color:#58708a">Receipts can be checked at ${esc(location.origin + location.pathname)}#/receipt/&lt;code&gt;. Printed ${new Date().toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}.</p>`);
      };
    });
}

function renderMe(host) {
  const get = () => { try { return localStorage.getItem(ME) || ''; } catch { return ''; } };
  const put = v => { try { v ? localStorage.setItem(ME, v) : localStorage.removeItem(ME); } catch { /* ignore */ } };
  const CK = 'alpha-me-cache';
  const cget = tk => { try { const c = JSON.parse(localStorage.getItem(CK) || 'null'); return c && c.token === tk ? c : null; } catch { return null; } };
  const cput = (token, data, note) => { try { localStorage.setItem(CK, JSON.stringify({ token, at: Date.now(), data, note })); } catch { /* ignore */ } };
  const netErr = e => !navigator.onLine || /failed to fetch|networkerror|load failed|network request/i.test(e?.message || '');
  async function show(token) {
    host.innerHTML = skeleton(3);
    try {
      let data, note = '', stale = 0;
      try {
        const { data: d, error } = await sb.rpc('v2_self_check', { p_token: token }); if (error) throw error; data = d;
        note = await sb.rpc('v2_public_pay_note').then(r => r.data || '', () => '');   // empty until the v4 SQL is run
        data.pay = await sb.rpc('v2_self_statement', { p_token: token }).then(r => (r.data?.payments || []).slice(0, 6), () => []);
        cput(token, data, note);
      } catch (e) { const c = cget(token); if (c && netErr(e)) { data = c.data; note = c.note || ''; stale = c.at; } else throw e; }
      put(token);
      const owed = data.balances.reduce((a, b) => a + +b.owed, 0), open = data.violations.filter(v => v.status !== 'resolved');
      host.innerHTML = `${stale ? `<div class="alertbar"><span>📴 ${t('offlineAsOf')} ${fmtDate(stale)}</span></div>` : ''}<div class="card pad"><small>${t('hello')}</small><h2 style="margin:2px 0 8px">${esc(data.name)}</h2>
        <div style="font-size:1.15rem;font-weight:700;color:var(${owed ? '--bad' : '--ok'})">${owed ? `${t('owed')} ${peso(owed)}` : '✓ ' + t('clear')}</div></div>
        ${owed && note ? `<div class="card pad"><b>${t('howPay')}</b><p style="margin:4px 0 8px;white-space:pre-line">${esc(note)}</p><button class="btn ghost sm" id="cpn">${t('copy')}</button></div>` : ''}
        <div class="card">${data.balances.map(b => `<div class="row"><div class="m"><b>${esc(b.charge)}</b><small>${b.waived ? t('excusedNote') : `${peso(b.paid)} / ${peso(b.due)}`}</small>${+b.paid > 0 && +b.owed > 0 ? `<div class="prog mini" role="img" aria-label="${percentPaid(b.paid, b.due)}%"><i style="width:${percentPaid(b.paid, b.due)}%"></i></div>` : ''}</div><span class="tag ${+b.owed ? 'bad' : 'ok'}">${+b.owed ? peso(b.owed) : b.waived ? t('excused') : t('paid')}</span></div>`).join('') || '<p class="empty">—</p>'}</div>
        ${(data.pay || []).length ? `<h3 class="sec">${t('myPays')}</h3><div class="card">${data.pay.map(p => `<div class="row"><div class="m"><b>${esc(p.for || '—')}</b><small>${fmtDate(p.at)}${p.receipt_no ? ' · ' + esc(p.receipt_no) : ''}${p.status === 'pending' ? ' · ' + t('pendingTag') : ''}</small></div><span class="tag ok">${peso(p.amount)}</span></div>`).join('')}</div>` : ''}
        <div class="card">${data.violations.map(v => `<div class="row"><div class="m"><b>${esc(v.standard)}</b><small>${fmtDate(v.date)} · ${v.offense === 1 ? '1st offense: verbal warning' : ordn(v.offense) + ' offense: ₱25 fine'}</small></div><span class="tag ${v.status === 'resolved' ? 'ok' : 'bad'}">${v.status === 'resolved' ? t('resolved') : t('outstanding')}</span></div>`).join('') || `<div class="empty"><b>${t('noviol')}</b></div>`}</div>
        <div id="rm"></div>
        <p style="text-align:center;display:flex;gap:8px;justify-content:center;flex-wrap:wrap"><button class="btn gold sm" id="st" ${stale ? 'disabled' : ''}>${t('stmt')}</button><button class="btn ghost sm" id="fg">${t('forget')}</button></p>`;
      host.querySelector('#cpn')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(note); toast(t('copied')); } catch { toast(note); } });
      host.querySelector('#fg').onclick = () => { put(''); try { localStorage.removeItem(CK); } catch { /* ignore */ } start(); };
      host.querySelector('#st').onclick = () => statement(token);
      if (!stale) remBox(host.querySelector('#rm'), token);
    } catch (e) { put(''); start(e.message); }
  }
  /* Sign in: Student ID + PIN, or the QR card. First time, the QR card proves who you are while you choose a PIN. */
  const SID = 'alpha-sid', lastId = () => { try { return localStorage.getItem(SID) || ''; } catch { return ''; } };
  const rememberId = v => { try { localStorage.setItem(SID, v); } catch { /* ignore */ } };
  const missing = e => /function|schema cache|does not exist/i.test(e?.message || '');
  const pinErr = d => d.error === 'locked' ? t('pinLocked').replace('{n}', d.wait_minutes) : d.error === 'revoked' ? t('pinRevoked') : d.error === 'mismatch' ? t('pinMismatchId') : d.error === 'weak' ? t('pinWeak') : d.error === 'format' ? t('pinFormat') : t('pinBad');
  const grab = (box, fn, done) => async () => { try { const tk = await fn(); if (tk) done(tk); } catch (e) { box.textContent = e.message; } };
  const qrButtons = () => `<button type="button" class="btn ghost" id="sc">${t('scan')}</button><label class="btn ghost" style="cursor:pointer">${t('photo')}<input id="ph" type="file" accept="image/*" hidden></label><button type="button" class="btn ghost" id="pa">${t('paste')}</button>`;
  function qrWire(box, done) {
    host.querySelector('#sc').onclick = grab(box, () => import('../qr.js').then(q => q.scanRaw()), done);
    host.querySelector('#ph').onchange = e => e.target.files[0] && grab(box, () => import('../qr.js').then(q => q.readQRFromFile(e.target.files[0])), done)();
    host.querySelector('#pa').onclick = grab(box, () => { const v = prompt(t('pasteAsk')); return v && v.trim(); }, done);
  }
  function start(err = '') {
    host.innerHTML = `<div class="card pad" style="text-align:center"><h3>${t('mytitle')}</h3><p class="muted">${t('mydesc')}</p>
      <form id="pf" style="display:grid;gap:6px;max-width:320px;margin:14px auto 0;text-align:left">
        <label for="sid">${t('studentId')}</label><input id="sid" autocomplete="username" autocapitalize="characters" spellcheck="false" placeholder="26-0000-000" required value="${esc(lastId())}">
        <label for="spin">${t('pin')}</label><input id="spin" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="current-password" placeholder="••••••" required>
        <button class="btn gold" style="margin-top:6px">${t('signin2')}</button></form>
      <p style="margin:12px 0 0"><a href="#" id="np">${t('firstTime')}</a></p>
      <details style="max-width:320px;margin:14px auto 0;text-align:left"><summary>${t('useQr')}</summary><div style="display:grid;gap:8px;margin-top:8px">${qrButtons()}</div></details>
      <div class="err" id="er" role="alert" style="margin-top:10px">${esc(err)}</div></div>`;
    const er = host.querySelector('#er');
    qrWire(er, tk => show(tk));
    host.querySelector('#np').onclick = e => { e.preventDefault(); setup(); };
    host.querySelector('#pf').onsubmit = async e => { e.preventDefault(); const btn = e.target.querySelector('button'), id = host.querySelector('#sid').value.trim(); btn.disabled = true; er.textContent = '';
      try { const { data, error } = await sb.rpc('v2_pin_login', { p_student_no: id, p_pin: host.querySelector('#spin').value }); if (error) throw error;
        if (data.ok) { rememberId(id); return show(data.token); } er.textContent = pinErr(data); host.querySelector('#spin').value = ''; }
      catch (x) { er.textContent = missing(x) ? t('pinNotReady') : netErr(x) ? t('noNet') : x.message; } btn.disabled = false; };
  }
  function setup(err = '', token = '', id = lastId()) {
    host.innerHTML = `<div class="card pad" style="text-align:center"><h3>${t('setupTitle')}</h3><p class="muted">${t('setupDesc')}</p>
      <div style="display:grid;gap:8px;max-width:320px;margin:12px auto 0;text-align:left">
        <div style="display:grid;gap:8px" id="qrs">${token ? `<div class="tag ok" style="justify-self:start">✓ ${t('qrRead')}</div>` : qrButtons()}</div>
        <form id="sf" style="display:grid;gap:6px"><label for="sid">${t('studentId')}</label><input id="sid" autocomplete="username" autocapitalize="characters" spellcheck="false" placeholder="26-0000-000" required value="${esc(id)}">
          <label for="n1">${t('pinNew')}</label><input id="n1" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="new-password" placeholder="••••••" required>
          <label for="n2">${t('pinConfirm')}</label><input id="n2" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="new-password" placeholder="••••••" required>
          <button class="btn gold" style="margin-top:6px">${t('pinSave')}</button></form></div>
      <p style="margin:12px 0 0"><a href="#" id="bk">${t('back')}</a></p><div class="err" id="er" role="alert" style="margin-top:10px">${esc(err)}</div></div>`;
    const er = host.querySelector('#er'), keep = () => host.querySelector('#sid').value;
    if (!token) qrWire(er, tk => setup('', tk, keep()));
    host.querySelector('#bk').onclick = e => { e.preventDefault(); start(); };
    host.querySelector('#sf').onsubmit = async e => { e.preventDefault(); const btn = e.target.querySelector('button'), n1 = host.querySelector('#n1').value; er.textContent = '';
      if (!token) return void (er.textContent = t('qrNeeded'));
      if (n1 !== host.querySelector('#n2').value) return void (er.textContent = t('pinNoMatch'));
      btn.disabled = true;
      try { const { data, error } = await sb.rpc('v2_pin_setup', { p_student_no: keep().trim(), p_token: token, p_pin: n1 }); if (error) throw error;
        if (data.ok) { rememberId(keep().trim()); toast(t('pinSaved')); return show(data.token); } er.textContent = pinErr(data); }
      catch (x) { er.textContent = missing(x) ? t('pinNotReady') : netErr(x) ? t('noNet') : x.message; } btn.disabled = false; };
  }
  const saved = get(); saved ? show(saved) : start();
}

export async function renderPublic(root) {
  root.innerHTML = `<div class="top"><span class="crest-ring"><img src="assets/wolf-crest.png" alt=""></span><div class="t"><b>Alpha ’28</b><small>BSMT 1-Alpha · Batch 28 · PIT-COMED</small></div>
    <span class="chip" id="sync"><i></i><span>Live</span></span><button class="btn ghost sm" id="txt" aria-label="Display: text size and dark mode" title="Text size, dark mode, scenery">Aa</button><button class="btn ghost sm" id="lang" aria-label="Language">${getLang() === 'ceb' ? 'EN' : 'CEB'}</button><a class="btn gold sm" href="#/staff" style="text-decoration:none;display:inline-grid;align-items:center">${t('signin')}</a></div>
    <main id="m" style="padding-bottom:40px">${skeleton(5)}</main>`;
  const off = onSync((s, d) => { const c = root.querySelector('#sync'); if (!c) return; c.className = 'chip ' + s;
    c.querySelector('span').textContent = { live: 'Live', syncing: 'Syncing…', offline: 'Offline', error: 'Sync error' }[s]; c.title = d || ''; });
  let ang = 0, lastTab = '', lastTop = '', pstate = 'unsupported', tab = 'fund', data = null, animated = false, vf = 'open', vq = '';
  const ord = n => { const r = n % 100; if (r >= 11 && r <= 13) return n + 'th'; return n + (['th','st','nd','rd'][n % 10] || 'th'); };
  const isOpen = v => v.status !== 'resolved';
  const m = root.querySelector('#m');
  root.querySelector('#lang').onclick = () => { setLang(getLang() === 'ceb' ? 'en' : 'ceb'); renderPublic(root); };
  root.querySelector('#txt').onclick = () => {
    let sceneChanged = false; const th = getTheme(), sz = getTextSize(), on = (c, v) => c === v ? ' on' : '';
    modal(`<h3>${t('display')}</h3><label>${t('textSize')}</label><div class="dispgrid" data-g="sz">${[[100, 'Aa'], [115, 'Aa+'], [130, 'Aa++']].map(([v, l]) => `<button class="btn ghost${on(sz, v)}" data-v="${v}" aria-pressed="${sz === v}">${l}</button>`).join('')}</div>
      <label>${t('theme')}</label><div class="dispgrid" data-g="th">${[['auto', t('themeAuto')], ['light', t('themeLight')], ['dark', t('themeDark')]].map(([v, l]) => `<button class="btn ghost${on(th, v)}" data-v="${v}" aria-pressed="${th === v}">${l}</button>`).join('')}</div>
      <label>${t('scenery')}</label><div class="dispgrid" data-g="sc">${[['auto', t('themeAuto')], ['on', t('sceneOn')], ['off', t('sceneOff')]].map(([v, l]) => `<button class="btn ghost${on(sceneMode(), v)}" data-v="${v}" aria-pressed="${sceneMode() === v}">${l}</button>`).join('')}</div>
      <p class="muted" style="margin:-6px 0 12px;font-size:.85rem">${t('sceneHint')}</p>
      <button class="btn ghost" id="dx" style="width:100%">${t('done')}</button>`, (m, close) => {
      m.querySelector('#dx').onclick = () => { close(); if (sceneChanged) renderPublic(root); };
      m.querySelectorAll('[data-g] .btn').forEach(b => b.onclick = () => { const g = b.parentElement.dataset.g; if (g === 'sz') setTextSize(+b.dataset.v); else if (g === 'th') setTheme(b.dataset.v); else { setSceneMode(b.dataset.v); sceneChanged = true; }
        b.parentElement.querySelectorAll('.btn').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); }); });
    });
  };

  const byDay = list => { const g = new Map(); list.forEach(e => { const k = dayLabel(e.at); g.set(k, [...(g.get(k) || []), e]); }); return g; };
  const entryRow = e => `<div class="row"><div class="lead"><span class="ini ${e.kind === 'expense' ? 'out' : ''}">${esc(initials(e.payer))}</span>
    <div class="m"><b>${esc(e.payer || '—')}</b><small>${esc(e.purpose || e.category)}${e.fund ? ' · ' + esc(fundLabel(e.fund)) : ''}</small></div></div><span class="amt ${e.kind === 'expense' ? 'out' : 'in'}">${e.kind === 'expense' ? '−' : '+'}${peso(e.amount)}</span></div>`;
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
  const fundCards = () => {
    const rows = data.tre?.funds || [], by = Object.fromEntries(rows.map(r => [r.fund, r]));
    const list = [...FUNDS.map(f => ({ k: f.k, label: f.label })), ...(by.none && (+by.none.collected || +by.none.spent) ? [{ k: 'none', label: 'Unassigned' }] : [])];
    return `<div class="funds">${list.map(f => { const r = by[f.k] || {}, c = +r.collected || 0, s = +r.spent || 0; return `<div class="fund f-${f.k}"><b>${esc(f.label)}</b><div class="rem">${peso(c - s)}</div><small>${peso(c)} collected · ${peso(s)} spent</small></div>`; }).join('')}</div>`;
  };
  const fundChips = () => {
    const rows = data.tre?.funds || [], by = Object.fromEntries(rows.map(r => [r.fund, r]));
    const list = [...FUNDS, ...(by.none && (+by.none.collected || +by.none.spent) ? [{ k: 'none', label: 'Unassigned' }] : [])];
    return `<div class="fchips">${list.map(f => { const r = by[f.k] || {}; return `<span class="fchip f-${f.k}"><i></i>${esc(f.label)} <b>${peso((+r.collected || 0) - (+r.spent || 0))}</b></span>`; }).join('')}</div>`;
  };
  function paint() {
    const { off: officers, tre, stand } = data;
    const cur = tre.open ? (tre.entries || []).filter(e => e.period_id === tre.open.id) : [];
    const views = {
      fund: () => `${fundCards()}${(data.prog || []).length ? `<div class="card pad"><h3 style="margin-bottom:8px">${t('progress')}</h3>${data.prog.map(p => { const pc = p.total ? Math.round(p.paid / p.total * 100) : 0;
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
      officers: () => `<div class="officers">${officers.map((o, i) => `<button class="ocard" data-o="${i}" aria-label="View ${esc(o.name)}’s profile"><div class="ph">${o.photo ? `<img src="${o.photo}" alt="${esc(o.name)}" style="object-position:${o.x}% ${o.y}%">` : esc(initials(o.name))}</div><div class="tx"><b>${esc(o.name)}</b><small>${esc(o.position)}</small></div></button>`).join('')}</div><p class="muted" style="text-align:center;font-size:.85rem">Tap an officer to see their leadership profile.</p>`,
      me: () => '',
      learn: () => '',
      bulletin: () => `<iframe class="fb" src="${FB}" width="500" height="600" scrolling="yes" loading="lazy" title="Class Facebook page" allow="encrypted-media"></iframe>`,
    };
    const hs = heroScene(tab);
    m.innerHTML = `${(data.ann || []).length ? `<div class="notices">${data.ann.map(a => `<div class="notice ${a.pinned ? 'pin' : ''}"><b>${a.pinned ? '📌 ' : '📣 '}${esc(a.title)}</b>${a.body ? `<p>${esc(a.body)}</p>` : ''}</div>`).join('')}</div>` : ''}${alertBar()}<div class="hero ${hs.dark ? 'dk' : ''}" style="background:${hs.top}">
        <div class="emblem">${'<div class="rose">' + ROSE + '</div>'}<span class="crest-ring"><img src="assets/wolf-crest.png" alt="Alpha crest"></span></div>
        <div class="copy"><small>${t('balance')}</small><div class="big" id="bal">${peso(tre.balance)}</div>
          <p>${esc(tre.open?.name || '')}${stand.length ? ` · ${stand.length} ${t('openv')}` : ' · ' + t('good')}</p>${fundChips()}</div>
        ${hs.html}</div>
      <div class="seg" role="tablist">${[['fund', t('fund')], ['standing', t('viol')], ['me', t('me')], ['officers', t('officers')], ['learn', t('learn')], ['bulletin', t('bulletin')]].map(([k, l]) => `<button role="tab" data-t="${k}" class="${tab === k ? 'on' : ''}" aria-selected="${tab === k}">${l}</button>`).join('')}</div>
      <section id="sec">${tab === 'learn' || tab === 'me' ? '' : views[tab]()}</section>`;
    {
      /* the compass answers the tap: swing to this tab's bearing, fade the scenery, ease the sky colour */
      const rose = m.querySelector('.rose'), hero = m.querySelector('.hero'), hsc = m.querySelector('.hscene');
      const prev = ang; ang += ((TABS.indexOf(tab) * 60 - ang + 540) % 360) - 180;
      if (rose && !reduceMotion()) { rose.style.transform = `rotate(${prev}deg)`; requestAnimationFrame(() => requestAnimationFrame(() => { rose.style.transform = `rotate(${ang}deg)`; })); }
      else if (rose) rose.style.transform = `rotate(${ang}deg)`;
      if (hero && lastTop && lastTop !== hs.top && !reduceMotion()) { hero.style.background = lastTop; hero.style.transition = 'background .7s ease'; requestAnimationFrame(() => requestAnimationFrame(() => { hero.style.background = hs.top; })); }
      if (hsc && lastTab && lastTab !== tab && !reduceMotion()) hsc.classList.add('swap');
      hsc?.querySelectorAll('.hvid').forEach(v => v.addEventListener('error', () => hsc.classList.add('novid'), { once: true }));
      warmScenes();
      lastTab = tab; lastTop = hs.top;
    }
    if (!animated) { animated = true; countUp(m.querySelector('#bal'), +tre.balance || 0); }
    if (tab === 'learn') import('./learn.js').then(l => { if (tab === 'learn' && m.querySelector('#sec')) l.renderLearn(m.querySelector('#sec')); });
    if (tab === 'me') renderMe(m.querySelector('#sec'));
    m.querySelector('#pon')?.addEventListener('click', async e => { e.target.disabled = true; try { await enablePush(); toast('Alerts are on'); } catch (x) { toast(x.message, true); } pstate = await pushState(); paint(); });
    m.querySelector('#poff')?.addEventListener('click', async () => { try { await disablePush(); } catch { /* ignore */ } pstate = await pushState(); paint(); });
    m.querySelector('#shf')?.addEventListener('click', () => share({ title: 'BSMT 1-Alpha class fund', text: `BSMT 1-Alpha fund balance: ${peso(tre.balance)}.`, url: location.origin + location.pathname }));
    m.querySelector('#shv')?.addEventListener('click', () => share({ title: 'BSMT 1-Alpha violations', text: 'BSMT 1-Alpha public violation ledger.', url: location.origin + location.pathname }));
    m.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { tab = b.dataset.t; paint(); });
    m.querySelectorAll('[data-o]').forEach(b => b.onclick = () => showOfficerProfile(officers[+b.dataset.o]));
    m.querySelectorAll('[data-vf]').forEach(b => b.onclick = () => { vf = b.dataset.vf; paint(); });
    const qi = m.querySelector('#vq'); if (qi) qi.oninput = () => { vq = qi.value; const pos = qi.selectionStart; paint(); const n = m.querySelector('#vq'); n.focus(); n.setSelectionRange(pos, pos); };
    m.querySelectorAll('[data-p]').forEach(b => b.onclick = () => openPeriod(tre.past.find(p => p.id === b.dataset.p)));
  }
  async function load() {
    try {
      const opt = p => db(p).catch(() => []);
      const [o, tr, s, vv, ann, prog] = await Promise.all([db(sb.rpc('v2_public_officers')), db(sb.rpc('v2_public_treasury')), db(sb.rpc('v2_public_standing')), db(sb.rpc('v2_public_violations')), opt(sb.rpc('v2_public_announcements')), opt(sb.rpc('v2_public_progress'))]);
      const first = !data; data = { off: o, tre: tr, stand: s, viol: vv, ann, prog }; announceNew(ann); if (first) pstate = await pushState(); if (first || (tab !== 'learn' && tab !== 'me')) paint();
    } catch (e) {
      if (!data) {   // no connection: still show the student's own saved status, if this phone has one
        m.innerHTML = `<div class="card pad"><b>Couldn't load the class page.</b><p class="muted">${esc(e.message)}</p><button class="btn" onclick="location.reload()">Try again</button></div><div id="offme"></div>`;
        let saved = ''; try { saved = localStorage.getItem(ME) || ''; } catch { /* ignore */ }
        if (saved) renderMe(m.querySelector('#offme'));
      }
    }
  }
  await load();
  const iv = setInterval(load, 60000);
  return () => { off(); clearInterval(iv); };
}
