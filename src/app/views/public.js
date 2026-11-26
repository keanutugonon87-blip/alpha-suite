import { FUNDS, fundLabel, sb, db, esc, peso, fmtDate, onSync, skeleton, modal, initials, dayLabel, share, toast, printHTML, letterhead } from '../core.js';
import { t, getLang, setLang } from '../i18n.js';
import { getTheme, setTheme, getTextSize, setTextSize } from '../display.js';
import { showOfficerProfile } from '../profile.js';
import { percentPaid } from '../money.js';
import { calendarHTML, wireCalendar, newCalState, todayYMD, catLabel } from '../coa.js';
import { auth, loadAuth, callAuth, enter, signOutViewer } from '../auth.js';
import { pushState, enablePush, disablePush, linkDevice } from '../push.js';

const ROSE = (() => { let t = ''; for (let i = 0; i < 72; i++) t += `<line x1="0" y1="-${i % 6 ? 90 : 86}" x2="0" y2="-94" transform="rotate(${i * 5})" stroke="#2a7fb0" stroke-opacity="${i % 6 ? .3 : .6}" stroke-width="${i % 6 ? 1 : 1.6}"/>`; return `<svg viewBox="-100 -100 200 200" aria-hidden="true"><circle r="97" fill="none" stroke="#2a7fb0" stroke-opacity=".4" stroke-width="1.5"/><circle r="72" fill="none" stroke="#2a7fb0" stroke-opacity=".25" stroke-dasharray="2 5"/>${t}
  <polygon points="0,-96 11,-11 96,0 11,11 0,96 -11,11 -96,0 -11,-11" fill="#d9a63c" fill-opacity=".38"/><polygon points="0,-62 7,-7 62,0 7,7 0,62 -7,7 -62,0 -7,-7" transform="rotate(45)" fill="#2a7fb0" fill-opacity=".3"/></svg>`; })();
const TABS = ['archive', 'faq', 'privacy', 'me', 'officers', 'learn', 'docs', 'bulletin'];
const GUEST_HIDE = ['me', 'docs'];
const SCENE_OF = { archive: 'fund', privacy: 'standing' };   // the Harbor and the Lighthouse scenery, kept for the two Article XVI tabs
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
function countUp(el, to) {
  if (reduceMotion()) { el.textContent = peso(to); return; }
  const t0 = performance.now(), dur = 1100;
  const step = t => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = peso(to * e); if (k < 1) requestAnimationFrame(step); else el.textContent = peso(to); };
  requestAnimationFrame(step);
}

const ME = 'alpha-me';
/* "Add to home screen" nudge, shown once after sign-in on a phone that has not installed the app */
let deferredInstall = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; });
function installBar(box) {
  if (!box) return;
  try { if (localStorage.getItem('alpha-install-no') || matchMedia('(display-mode: standalone)').matches || navigator.standalone) return; } catch { return; }
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !navigator.standalone;
  if (!deferredInstall && !ios) return;
  box.innerHTML = `<div class="alertbar"><span>📲 ${deferredInstall ? t('instTitle') : t('instIos')}</span><span style="display:flex;gap:6px">${deferredInstall ? `<button class="btn gold sm" id="ib">${t('instBtn')}</button>` : ''}<button class="btn ghost sm" id="in">${t('instNo')}</button></span></div>`;
  box.querySelector('#ib')?.addEventListener('click', async () => { try { deferredInstall.prompt(); await deferredInstall.userChoice; } catch { /* ignore */ } deferredInstall = null; box.innerHTML = ''; });
  box.querySelector('#in').onclick = () => { try { localStorage.setItem('alpha-install-no', '1'); } catch { /* ignore */ } box.innerHTML = ''; };
}
const sanctionText = (v, ord) => v.excused ? 'excused, no fine' : v.kind ? 'attendance record' : v.fine ? `Fine ₱${Number(v.fine).toLocaleString('en-PH')}` : v.offense === 1 ? '1st offense: verbal warning' : `${ord(v.offense)} offense: ₱25 fine`;
const ordn = n => { const r = n % 100; if (r >= 11 && r <= 13) return n + 'th'; return n + (['th','st','nd','rd'][n % 10] || 'th'); };

/* Balance reminders: a student links their own phone to their QR card, so the SAILS Treasurer can remind only those who still owe. */
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
  const rows = d.payments.map(p => `<div class="row"><div class="m"><b>${esc(p.for)}</b><small>${fmtDate(p.at)}${p.receipt_no ? ' · ' + esc(p.receipt_no) : p.status === 'approved' && p.confirmed === false ? ' · ' + t('receiptSoon') : ''}${p.fund ? ' · ' + esc(fundLabel(p.fund)) : ''}${p.status === 'pending' ? ' · awaiting approval' : ''}</small></div><b>${peso(p.amount)}</b></div>`).join('') || `<p class="empty">${t('stmtNone')}</p>`;
  const owing = d.balances.filter(b => +b.owed > 0 && !b.closed).map(b => `<div class="row"><div class="m"><b>${esc(b.charge)}</b><small>${peso(b.paid)} / ${peso(b.due)}</small></div><span class="tag bad">${peso(b.owed)}</span></div>`).join('');
  modal(`<h3>${t('stmtTitle')}</h3><p class="muted" style="margin:0 0 8px">${esc(d.name)}${d.student_no && !/^PENDING/.test(d.student_no) ? ' · ' + esc(d.student_no) : ''}</p>
    <div class="grid"><div class="stat gold"><small>${t('stmtPaid')}</small><b>${peso(paid)}</b></div><div class="stat"><small>${t('stmtOwe')}</small><b>${peso(owe)}</b></div></div>
    <div class="card" style="margin-top:10px;max-height:44vh;overflow:auto">${rows}</div>${owing ? `<div class="card">${owing}</div>` : ''}
    <div style="display:flex;gap:8px;margin-top:10px;align-items:center"><select id="sy" style="width:auto">${[0, 1, 2].map(i => { const y = new Date().getFullYear() - i; return `<option>${y}</option>`; }).join('')}</select><button class="btn ghost" id="sya">Yearly statement</button></div>
    <div style="display:flex;gap:8px;margin-top:12px"><button class="btn gold" id="sp" style="flex:1">${t('stmtPrint')}</button><button class="btn ghost" id="sc">${t('stmtClose')}</button></div>`,
    (m, close) => {
      m.querySelector('#sc').onclick = close;
      m.querySelector('#sya').onclick = async () => {
        try {
          const { data: y, error } = await sb.rpc('v2_self_year', { p_token: token, p_year: +m.querySelector('#sy').value }); if (error) throw error;
          const cats = Object.entries(y.by_category || {}), total = cats.reduce((a, [, v]) => a + +v, 0);
          printHTML('Yearly statement - ' + y.name, `${letterhead('Yearly statement of contributions ' + y.year, y.name + ' · PIT-COMED · Batch 28')}<div class="sum"><div>Paid in ${y.year}<b>${peso(total)}</b></div></div>
            <h2>By category</h2><table><thead><tr><th>Category</th><th class="r">Amount</th></tr></thead><tbody>${cats.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="r">${peso(v)}</td></tr>`).join('') || '<tr><td colspan="2">No payments this year</td></tr>'}</tbody></table>
            <h2>Payments</h2><table><thead><tr><th>Date</th><th>For</th><th>Receipt no.</th><th class="r">Amount</th></tr></thead><tbody>${(y.payments || []).map(p => `<tr><td>${fmtDate(p.at)}</td><td>${esc(p.for)}</td><td>${esc(p.receipt_no || '')}</td><td class="r">${peso(p.amount)}</td></tr>`).join('')}</tbody></table>`);
        } catch (e) { toast(/function|schema cache/i.test(e.message) ? 'The yearly statement is not switched on yet. Ask the Mayor.' : e.message, true); }
      };
      m.querySelector('#sp').onclick = () => {
        const tbl = `<table><thead><tr><th>Date</th><th>For</th><th>Receipt no.</th><th>Verify code</th><th class="r">Amount</th></tr></thead><tbody>${d.payments.map(p => `<tr><td>${fmtDate(p.at)}</td><td>${esc(p.for)}${p.fund ? ' · ' + esc(fundLabel(p.fund)) : ''}</td><td>${esc(p.receipt_no || '—')}${p.status === 'pending' ? ' (awaiting approval)' : ''}</td><td>${esc(p.code || '—')}</td><td class="r">${peso(p.amount)}</td></tr>`).join('') || '<tr><td colspan="5">No payments yet</td></tr>'}</tbody></table>`;
        const ow = d.balances.filter(b => +b.owed > 0 && !b.closed);
        printHTML('Statement - ' + d.name, `${letterhead('Statement of account', d.name + ' · PIT-COMED · Batch 28')}<div class="sum"><div>Payments made<b>${peso(paid)}</b></div><div>Still owed<b>${peso(owe)}</b></div></div>
          <h2>Payments</h2>${tbl}${ow.length ? `<h2>Still owed</h2><table><thead><tr><th>Charge</th><th class="r">Paid</th><th class="r">Due</th><th class="r">Owed</th></tr></thead><tbody>${ow.map(b => `<tr><td>${esc(b.charge)}</td><td class="r">${peso(b.paid)}</td><td class="r">${peso(b.due)}</td><td class="r">${peso(b.owed)}</td></tr>`).join('')}</tbody></table>` : '<p>✓ All charges are paid up.</p>'}
          <p style="font-size:11px;color:#58708a">Receipts can be checked at ${esc(location.origin + location.pathname)}#/receipt/&lt;code&gt;. Printed ${new Date().toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}.</p>`);
      };
    });
}

function renderMe(host, opts = {}) {
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
      host.innerHTML = `<div id="inst"></div>${stale ? `<div class="alertbar"><span>📴 ${t('offlineAsOf')} ${fmtDate(stale)}</span></div>` : ''}<div class="card pad"><small>${t('hello')}</small><h2 style="margin:2px 0 8px">${esc(data.name)}</h2>
        <div style="font-size:1.15rem;font-weight:700;color:var(${owed ? '--bad' : '--ok'})">${owed ? `${t('owed')} ${peso(owed)}` : '✓ ' + t('clear')}</div></div>
        ${owed && note ? `<div class="card pad"><b>${t('howPay')}</b><p style="margin:4px 0 8px;white-space:pre-line">${esc(note)}</p><button class="btn ghost sm" id="cpn">${t('copy')}</button></div>` : ''}
        <div class="card">${data.balances.map(b => `<div class="row"><div class="m"><b>${esc(b.charge)}</b><small>${b.waived ? t('excusedNote') : `${peso(b.paid)} / ${peso(b.due)}`}</small>${+b.paid > 0 && +b.owed > 0 ? `<div class="prog mini" role="img" aria-label="${percentPaid(b.paid, b.due)}%"><i style="width:${percentPaid(b.paid, b.due)}%"></i></div>` : ''}</div><span class="tag ${+b.owed ? 'bad' : 'ok'}">${+b.owed ? peso(b.owed) : b.waived ? t('excused') : t('paid')}</span></div>`).join('') || '<p class="empty">—</p>'}</div>
        ${(data.pay || []).length ? `<h3 class="sec">${t('myPays')}</h3><div class="card">${data.pay.map(p => `<div class="row"><div class="m"><b>${esc(p.for || '—')}</b><small>${fmtDate(p.at)}${p.receipt_no ? ' · ' + esc(p.receipt_no) : p.confirmed === false ? ' · ' + t('receiptSoon') : ''}${p.status === 'pending' ? ' · ' + t('pendingTag') : ''}</small></div><span class="tag ok">${peso(p.amount)}</span></div>`).join('')}</div>` : ''}
        <div class="card">${data.violations.map(v => `<div class="row"><div class="m"><b>${esc(v.standard)}</b><small>${fmtDate(v.date)} · ${sanctionText(v, ordn)}</small></div><span class="tag ${v.status === 'resolved' ? 'ok' : 'bad'}">${v.status === 'resolved' ? t('resolved') : t('outstanding')}</span></div>`).join('') || `<div class="empty"><b>${t('noviol')}</b></div>`}</div>
        <div id="rm"></div>
        <p style="text-align:center;display:flex;gap:8px;justify-content:center;flex-wrap:wrap"><button class="btn gold sm" id="st" ${stale ? 'disabled' : ''}>${t('stmt')}</button><button class="btn ghost sm" id="fg">${t('forget')}</button></p>`;
      installBar(host.querySelector('#inst'));
      host.querySelector('#cpn')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(note); toast(t('copied')); } catch { toast(note); } });
      host.querySelector('#fg').onclick = async () => { put(''); try { localStorage.removeItem(CK); } catch { /* ignore */ } await signOutViewer().catch(() => {}); await loadAuth().catch(() => {}); if (auth.require) location.reload(); else start(); };
      host.querySelector('#st').onclick = () => statement(token);
      if (!stale) remBox(host.querySelector('#rm'), token);
    } catch (e) { put(''); start(e.message); }
  }
  /* Sign in: Student ID + PIN, or the QR card. First time, the QR card proves who you are while you choose a PIN. */
  const SID = 'alpha-sid', lastId = () => { try { return localStorage.getItem(SID) || ''; } catch { return ''; } };
  const rememberId = v => { try { localStorage.setItem(SID, v); } catch { /* ignore */ } };
  const missing = e => /function|schema cache|does not exist/i.test(e?.message || '');
  const pinErr = d => d.error === 'locked' ? t('pinLocked').replace('{n}', d.wait_minutes).replace('{t}', new Date(Date.now() + d.wait_minutes * 60000).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' })) : d.error === 'revoked' ? t('pinRevoked') : d.error === 'mismatch' ? t('pinMismatchId') : d.error === 'weak' ? t('pinWeak') : d.error === 'format' ? t('pinFormat') : t('pinBad');
  const done = async tk => { await loadAuth().catch(() => {}); return opts.lock ? opts.onSignedIn() : show(tk); };
  const pin = (id, ac, ph = '••••••') => `<div class="pw"><input id="${id}" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="${ac}" placeholder="${ph}" required><button type="button" class="eye" data-eye="${id}" aria-label="${t('showPin')}" aria-pressed="false">👁</button></div>`;
  const eyes = () => host.querySelectorAll('[data-eye]').forEach(b => b.onclick = () => { const i = host.querySelector('#' + b.dataset.eye), show = i.type === 'password'; i.type = show ? 'text' : 'password'; b.setAttribute('aria-pressed', show); b.setAttribute('aria-label', t(show ? 'hidePin' : 'showPin')); b.textContent = show ? '🙈' : '👁'; });
  const grab = (box, fn, done) => async () => { try { const tk = await fn(); if (tk) done(tk); } catch (e) { box.textContent = e.message; } };
  const qrButtons = () => `<button type="button" class="btn ghost" id="sc">${t('scan')}</button><label class="btn ghost" style="cursor:pointer">${t('photo')}<input id="ph" type="file" accept="image/*" hidden></label><button type="button" class="btn ghost" id="pa">${t('paste')}</button>`;
  function qrWire(box, done) {
    host.querySelector('#sc').onclick = grab(box, () => import('../qr.js').then(q => q.scanRaw()), done);
    host.querySelector('#ph').onchange = e => e.target.files[0] && grab(box, () => import('../qr.js').then(q => q.readQRFromFile(e.target.files[0])), done)();
    host.querySelector('#pa').onclick = grab(box, () => { const v = prompt(t('pasteAsk')); return v && v.trim(); }, done);
  }
  function start(err = '') {
    host.innerHTML = `<div class="card pad" style="text-align:center"><h3>${opts.lock ? t('lockTitle') : t('mytitle')}</h3><p class="muted">${opts.lock ? t('lockDesc') : t('mydesc')}</p>
      <form id="pf" style="display:grid;gap:6px;max-width:320px;margin:14px auto 0;text-align:left">
        <label for="sid">${t('studentId')}</label><input id="sid" autocomplete="username" autocapitalize="characters" spellcheck="false" placeholder="26-0000-000" required value="${esc(lastId())}">
        <label for="spin">${t('pin')}</label>${pin('spin', 'current-password')}
        <button class="btn gold" style="margin-top:6px">${t('signin2')}</button></form>
      <p style="margin:12px 0 0"><a href="#" id="np">${t('firstTime')}</a></p>
      ${opts.lock ? `<form id="gf" style="display:grid;gap:6px;max-width:320px;margin:14px auto 0;text-align:left"><label for="gc">${t('guestCode')}</label><div style="display:flex;gap:8px"><input id="gc" autocapitalize="characters" spellcheck="false" placeholder="XXXXX-XXXXX" style="flex:1"><button class="btn ghost">${t('guestGo')}</button></div><small class="muted">${t('guestHint')}</small></form>
        <p style="margin:14px 0 0;font-size:.9rem"><a href="#/staff">${t('officerEmail')}</a></p>` : ''}
      ${opts.lock ? '' : `<details style="max-width:320px;margin:14px auto 0;text-align:left"><summary>${t('useQr')}</summary><div style="display:grid;gap:8px;margin-top:8px">${qrButtons()}</div></details>`}
      <div class="err" id="er" role="alert" style="margin-top:10px">${esc(err)}</div></div>`;
    const er = host.querySelector('#er'); eyes();
    if (!opts.lock) qrWire(er, tk => done(tk));
    host.querySelector('#np').onclick = e => { e.preventDefault(); setup(); };
    const gf = host.querySelector('#gf');
    if (gf) gf.onsubmit = async e => { e.preventDefault(); const b = gf.querySelector('button'); b.disabled = true; er.textContent = '';
      try { const d = await callAuth({ action: 'guest', code: host.querySelector('#gc').value }); if (!d.ok) er.textContent = d.error === 'server' ? t('noNet') : t('guestBad'); else { await enter(d); return done(''); } }
      catch (x) { er.textContent = netErr(x) ? t('noNet') : x.message; } b.disabled = false; };
    host.querySelector('#pf').onsubmit = async e => { e.preventDefault(); const btn = e.target.querySelector('button'), id = host.querySelector('#sid').value.trim(); btn.disabled = true; er.textContent = '';
      try { const data = await callAuth({ action: 'login', student_no: id, pin: host.querySelector('#spin').value });
        if (data.ok) { await enter(data); rememberId(id); return done(data.token); } er.textContent = pinErr(data); host.querySelector('#spin').value = ''; }
      catch (x) { er.textContent = missing(x) ? t('pinNotReady') : netErr(x) ? t('noNet') : x.message; } btn.disabled = false; };
  }
  function setup(err = '', token = '', id = lastId()) {
    host.innerHTML = `<div class="card pad" style="text-align:center"><h3>${t('setupTitle')}</h3><p class="muted">${t('setupDesc')}</p>
      <div style="display:grid;gap:8px;max-width:320px;margin:12px auto 0;text-align:left">
        <div style="display:grid;gap:8px" id="qrs">${token ? `<div class="tag ok" style="justify-self:start">✓ ${t('qrRead')}</div>` : qrButtons()}</div>
        <form id="sf" style="display:grid;gap:6px"><label for="sid">${t('studentId')}</label><input id="sid" autocomplete="username" autocapitalize="characters" spellcheck="false" placeholder="26-0000-000" required value="${esc(id)}">
          <label for="n1">${t('pinNew')}</label>${pin('n1', 'new-password')}
          <label for="n2">${t('pinConfirm')}</label>${pin('n2', 'new-password')}
          <button class="btn gold" style="margin-top:6px">${t('pinSave')}</button></form></div>
      <p style="margin:12px 0 0"><a href="#" id="bk">${t('back')}</a></p><div class="err" id="er" role="alert" style="margin-top:10px">${esc(err)}</div></div>`;
    const er = host.querySelector('#er'), keep = () => host.querySelector('#sid').value; eyes();
    if (!token) qrWire(er, tk => setup('', tk, keep()));
    host.querySelector('#bk').onclick = e => { e.preventDefault(); start(); };
    host.querySelector('#sf').onsubmit = async e => { e.preventDefault(); const btn = e.target.querySelector('button'), n1 = host.querySelector('#n1').value; er.textContent = '';
      if (!token) return void (er.textContent = t('qrNeeded'));
      if (n1 !== host.querySelector('#n2').value) return void (er.textContent = t('pinNoMatch'));
      btn.disabled = true;
      try { const data = await callAuth({ action: 'setup', student_no: keep().trim(), token, pin: n1 });
        if (data.ok) { await enter(data); rememberId(keep().trim()); toast(t('pinSaved')); return done(data.token); } er.textContent = pinErr(data); }
      catch (x) { er.textContent = missing(x) ? t('pinNotReady') : netErr(x) ? t('noNet') : x.message; } btn.disabled = false; };
  }
  const saved = get();
  if (opts.lock) start();
  else if (saved) show(saved);
  else if (auth.member_id) sb.rpc('v2_my_token').then(r => r.data ? show(r.data) : start(), () => start());   // signed in already: no scanning needed
  else start();
}

export async function renderPublic(root) {
  await loadAuth();
  if (auth.require && !auth.viewer) return lockScreen(root);
  root.innerHTML = `<div class="top"><span class="crest-ring"><img src="assets/wolf-crest.png" alt=""></span><div class="t"><b>SAILS ’28</b><small>PIT-COMED · Batch 28</small></div>
    <span class="chip" id="sync"><i></i><span>Live</span></span><button class="btn ghost sm" id="txt" aria-label="Display: text size and dark mode" title="Text size, dark mode, scenery">Aa</button><button class="btn ghost sm" id="lang" aria-label="Language">${getLang() === 'ceb' ? 'EN' : 'CEB'}</button>${auth.kind === 'guest' ? `<button class="btn ghost sm" id="so">${t('signOut')}</button>` : ''}<a class="btn gold sm" href="#/staff" style="text-decoration:none;display:inline-grid;align-items:center">${t('signin')}</a></div>
    <main id="m" style="padding-bottom:40px">${skeleton(5)}</main>`;
  const off = onSync((s, d) => { const c = root.querySelector('#sync'); if (!c) return; c.className = 'chip ' + s;
    c.querySelector('span').textContent = { live: 'Live', syncing: 'Syncing…', offline: 'Offline', error: 'Sync error' }[s]; c.title = d || ''; });
  let ang = 0, lastTab = '', lastTop = '', pstate = 'unsupported', tab = 'home', cal = newCalState(), data = null, animated = false, pdOpen = null;
  const ord = n => { const r = n % 100; if (r >= 11 && r <= 13) return n + 'th'; return n + (['th','st','nd','rd'][n % 10] || 'th'); };
  const isOpen = v => v.status !== 'resolved';
  const m = root.querySelector('#m');
  root.querySelector('#lang').onclick = () => { setLang(getLang() === 'ceb' ? 'en' : 'ceb'); renderPublic(root); };
  root.querySelector('#so')?.addEventListener('click', async () => { await signOutViewer().catch(() => {}); location.reload(); });
  root.querySelector('#txt').onclick = () => {
    let sceneChanged = false; const th = getTheme(), sz = getTextSize(), on = (c, v) => c === v ? ' on' : '';
    modal(`<h3>${t('display')}</h3><label>${t('textSize')}</label><div class="dispgrid" data-g="sz">${[[100, 'Aa'], [115, 'Aa+'], [130, 'Aa++']].map(([v, l]) => `<button class="btn ghost${on(sz, v)}" data-v="${v}" aria-pressed="${sz === v}">${l}</button>`).join('')}</div>
      <label>${t('theme')}</label><div class="dispgrid" data-g="th">${[['auto', t('themeAuto')], ['light', t('themeLight')], ['dark', t('themeDark')]].map(([v, l]) => `<button class="btn ghost${on(th, v)}" data-v="${v}" aria-pressed="${th === v}">${l}</button>`).join('')}</div>
      <button class="btn ghost" id="dx" style="width:100%">${t('done')}</button>`, (m, close) => {
      m.querySelector('#dx').onclick = () => { close(); if (sceneChanged) renderPublic(root); };
      m.querySelectorAll('[data-g] .btn').forEach(b => b.onclick = () => { const g = b.parentElement.dataset.g; if (g === 'sz') setTextSize(+b.dataset.v); else setTheme(b.dataset.v);
        b.parentElement.querySelectorAll('.btn').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); }); });
    });
  };

  const byDay = list => { const g = new Map(); list.forEach(e => { const k = dayLabel(e.at); g.set(k, [...(g.get(k) || []), e]); }); return g; };
  const entryRow = e => `<div class="row"><div class="lead"><span class="ini ${e.kind === 'expense' ? 'out' : ''}">${esc(initials(e.payer))}</span>
    <div class="m"><b>${esc(e.payer || '—')}</b><small>${esc(e.purpose || e.category)}${e.fund ? ' · ' + esc(fundLabel(e.fund)) : ''}</small></div></div><span class="amt ${e.kind === 'expense' ? 'out' : 'in'}">${e.kind === 'expense' ? '−' : '+'}${peso(e.amount)}</span></div>`;
  const grouped = list => list.length ? [...byDay(list)].map(([d, es]) => `<div class="dayhead">${esc(d)}</div>${es.map(entryRow).join('')}`).join('') : `<div class="empty"><b>${t('noentries')}</b>${t('noentriesd')}</div>`;

  /* CBL Article XVI: the official archive (Sections 1 and 2) and the data-protection notice (Sections 3 to 5) */
  const CATS = [['CBL and amendments'], ['Membership records'], ['Election documents'], ['Minutes', 'minutes'], ['Resolutions', 'resolution'], ['Annual plans'], ['Accomplishment reports'], ['Financial reports'], ['Inventory and turnover documents']];
  const tok = () => { try { return localStorage.getItem(ME) || null; } catch { return null; } };   // the QR-card token My Status already keeps on this phone
  const canAsk = () => ['student', 'officer'].includes(auth.kind) || !!tok();
  const age = d => Math.floor((Date.now() - new Date(d)) / 864e5);
  function askRecord(title = '', hint = '', to = 'secretary') {
    modal(`<h3>${t(to === 'treasurer' ? 'askReceipt' : 'askRecord')}</h3><p class="muted" style="margin:0 0 8px">${t(to === 'treasurer' ? 'askReceiptNote' : 'askRecordNote')}</p>
      <label>${t('whichRecord')}</label><input id="rq-t" maxlength="120" value="${esc(title)}" placeholder="${esc(hint || t('whichEg'))}">
      <label>${t('whyNeeded')}</label><textarea id="rq-n" rows="3" maxlength="500"></textarea>
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" id="rq-go" style="flex:1">${t('sendRequest')}</button><button class="btn ghost" id="rq-x">${t('cancel')}</button></div>`, (el, close) => {
      el.querySelector('#rq-x').onclick = close;
      el.querySelector('#rq-go').onclick = async e => {
        const ttl = el.querySelector('#rq-t').value.trim(); if (ttl.length < 3) return toast(t('whichRecord'), true);
        e.target.disabled = true;
        try { await db(sb.rpc('v2_record_request', { p_title: ttl, p_note: el.querySelector('#rq-n').value.trim() || null, p_token: tok(), ...(to === 'treasurer' ? { p_to: 'treasurer' } : {}) })); close(); toast(t('requestSent')); await load(); }
        catch (x) { e.target.disabled = false; toast(/function|schema cache|does not exist/i.test(x.message || '') ? t('requestNotReady') : x.message, true); }
      };
    });
  }
  /* FAQ: questions the SAILS Secretary keeps up to date; tap one to open its answer */
  function faqView() {
    const items = data.faq || [];
    if (!items.length) return `<div class="card"><p class="empty">${t('faqEmpty')}</p></div>`;
    const topics = [...new Set(items.map(x => x.topic || ''))];
    return `<p class="muted" style="margin:0 2px 8px">${t('faqNote')}</p>${topics.map(tp => `${tp ? `<p class="muted" style="margin:10px 4px 4px;font-weight:600">${esc(tp)}</p>` : ''}<div class="card">${items.filter(x => (x.topic || '') === tp).map(x => `<details class="faqi" style="padding:12px 14px;border-bottom:1px solid var(--line)"><summary style="cursor:pointer;font-weight:600">${esc(x.question)}</summary><p style="margin:8px 0 0;white-space:pre-wrap">${esc(x.answer)}</p></details>`).join('')}</div>`).join('')}`;
  }
  function archiveView() {
    const dl = data.docs || [], cnt = k => dl.filter(x => x.kind === k).length, mine = data.mine || [], ask = canAsk();
    const row = ([name, kind], i) => { const n = kind ? cnt(kind) : 0;
      return `<div class="row"><div class="m"><b>${t('cat' + i)}</b><small>${n ? `${n} ${t('posted')}` : t('askSecretary')}</small></div>
        <div style="display:flex;gap:6px">${n ? `<button class="btn ghost sm" data-t="docs">${t('read')}</button>` : ''}${ask ? `<button class="btn ghost sm" data-rq="${esc(name)}">${t('request')}</button>` : ''}</div></div>`; };
    const st = { open: ['warn', t('reqOpen')], granted: ['ok', t('reqGranted')], declined: ['bad', t('reqDeclined')] };
    return `<p class="muted" style="margin:0 2px 8px">${t('archiveNote')}</p>
      <div class="card">${CATS.map(row).join('')}</div>
      ${ask ? `<button class="btn gold" id="rq-new" style="width:100%;margin:10px 0 6px">${t('askRecord')}</button><button class="btn ghost" id="rq-rcpt" style="width:100%;margin:0 0 10px">${t('askReceipt')}</button>` : `<p class="muted" style="margin:10px 2px">${t('signInToAsk')}</p>`}
      ${mine.length ? `<h3 style="margin:16px 2px 8px">${t('myRequests')}</h3><div class="card">${mine.map(r => `<div class="row" style="display:block"><div style="display:flex;justify-content:space-between;gap:8px"><div class="m"><b>${esc(r.title)}</b><small>${fmtDate(r.created_at)}${r.status === 'open' ? ` · ${age(r.created_at)} ${t('daysAgo')}` : ''}</small></div><span class="tag ${st[r.status][0]}">${st[r.status][1]}</span></div>${r.answer_note ? `<p style="margin:6px 0 0">${esc(r.answer_note)}</p>` : ''}</div>`).join('')}</div>` : ''}`;
  }
  function privacyView() {
    const blk = (h, p) => `<div class="card pad" style="margin-bottom:10px"><h3 style="margin:0 0 6px">${t(h)}</h3><p style="margin:0">${t(p)}</p></div>`;
    return `${blk('prvUseH', 'prvUse')}${blk('prvSeeH', 'prvSee')}${blk('prvKeepH', 'prvKeep')}${blk('prvNoH', 'prvNo')}${blk('prvOfficialH', 'prvOfficial')}
      ${canAsk() ? `<button class="btn ghost" id="rq-fix" style="width:100%">${t('prvFix')}</button>` : ''}`;
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

  /* ---- Home: slim brand card, my standing, next activity, quick tiles (replaces the balance hero) ---- */
  const LL = (en, ceb) => getLang() === 'ceb' ? ceb : en;
  const cachedMe = () => { try { const c = JSON.parse(localStorage.getItem('alpha-me-cache') || 'null'); return c && c.token === tok() ? c.data : null; } catch { return null; } };
  const greet = () => { const h = +new Date().toLocaleString('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Manila' }) % 24; return h < 12 ? LL('Good morning', 'Maayong buntag') : h < 18 ? LL('Good afternoon', 'Maayong hapon') : LL('Good evening', 'Maayong gabii'); };
  function standingHTML(d) {
    if (!d) return `<div class="hm-card hm-guest"><b>${LL('Sign in to see your standing', 'Mag-sign in aron makita ang imong kahimtang')}</b><span>${LL('Use your Student ID to view dues, QR and statements.', 'Gamita ang imong Student ID aron makita ang utang, QR ug statement.')}</span><button class="btn gold sm" data-go="me">${LL('Sign in', 'Mag-sign in')}</button></div>`;
    const live = (d.balances || []).filter(b => !b.waived), due = live.reduce((x, b) => x + +b.due, 0), paid = live.reduce((x, b) => x + +b.paid, 0), owed = live.reduce((x, b) => x + +b.owed, 0);
    const pct = due ? Math.min(100, Math.round(paid / due * 100)) : 100, tag = owed <= 0 ? LL('All clear', 'Tarong na') : pct >= 70 ? LL('Almost done', 'Hapit na') : LL('Payment due', 'Naay utang');
    return `<div class="hm-card"><small>${LL('My standing', 'Akong kahimtang')}</small><div class="hm-st"><div class="hm-big">${owed > 0 ? peso(owed) : '✓'} <span>${owed > 0 ? LL('still due', 'nahabilin') : LL('nothing due', 'walay utang')}</span></div><span class="hm-pill ${owed > 0 ? '' : 'ok'}">${tag}</span></div>
      <div class="hm-bar" role="img" aria-label="${pct}%"><i style="width:${pct}%"></i></div><div class="hm-meta"><span>${LL('Paid', 'Bayad')} ${peso(paid)} ${LL('of', 'sa')} ${peso(due)}</span><span>${pct}%</span></div>
      <button class="btn gold" id="hm-stmt" style="width:100%;margin-top:12px">${LL('My statement', 'Akong statement')}</button></div>`;
  }
  function nextHTML() {
    const today = todayYMD(), nx = (data.coa || []).filter(i => i.status === 'approved' && (i.ends_on || i.starts_on) >= today).sort((x, y) => x.starts_on < y.starts_on ? -1 : 1)[0];
    if (!nx) return '';
    const [y, mo, dd] = nx.starts_on.split('-').map(Number), diff = Math.round((Date.UTC(y, mo - 1, dd) - Date.parse(today + 'T00:00:00Z')) / 864e5);
    const when = nx.starts_on <= today ? LL('Today', 'Karon') : diff === 1 ? LL('Tomorrow', 'Ugma') : LL(`in ${diff} days`, `sa ${diff} ka adlaw`), mon = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][mo - 1];
    return `<button type="button" class="hm-next" data-go="bulletin"><span class="hm-dt"><b>${nx.starts_on <= today ? new Date().getDate() : dd}</b><small>${mon}</small></span><span class="hm-nt"><b>${esc(nx.title)}</b><small>${esc([nx.time_note, nx.venue].filter(Boolean).join(' · ') || catLabel(nx.category))}</small></span><em>${when}</em></button>`;
  }
  function homeHTML() {
    const me = cachedMe(), first = me?.name ? String(me.name).trim().split(/\s+/)[0] : '';
    return `<div class="hm"><div class="hm-hd" style="background-image:linear-gradient(180deg,rgba(8,48,28,.55),rgba(8,48,28,.9)),url(assets/ship-bg.png)"><div class="hm-row"><span class="hm-cr"><img src="assets/wolf-crest.png" alt="SAILS crest"></span><div><b>SAILS ’28</b><small>PIT-COMED · BATCH 28</small></div></div>
      <div class="hm-gr">${first ? `${greet()}, ${esc(first)}` : LL('Welcome to SAILS ’28', 'Maayong pag-abot sa SAILS ’28')}</div><div class="hm-mo">${LL('Unity and strength towards a common goal', 'Panag-uban ug kusog padulong sa komon nga tumong')}</div></div>
      <div id="hm-standing">${standingHTML(me)}</div>${nextHTML()}
      <div class="hm-g"><button type="button" class="hm-q hl" id="hm-req"><i>📄</i><span>${LL('Request fund records', 'Pangayo og rekord sa pondo')}<small>${LL('Fund transparency', 'Transparency sa pondo')}</small></span></button>
        <button type="button" class="hm-q" data-go="me"><i>🪪</i><span>${LL('My status', 'Akong status')}</span></button>
        <button type="button" class="hm-q" data-go="docs"><i>🗂️</i><span>${t('pubDocs')}</span></button>
        <button type="button" class="hm-q" data-go="bulletin"><i>📅</i><span>${t('bulletin')}</span></button></div></div>`;
  }
  async function refreshStanding() {
    const tk = tok(); if (!tk) return;
    try { const { data: d, error } = await sb.rpc('v2_self_check', { p_token: tk }); if (error || !d) return; const box = m.querySelector('#hm-standing'); if (box && tab === shownTab) { box.innerHTML = standingHTML(d); wireHome(); } } catch { /* offline: the cached card stays */ }
  }
  let shownTab = '';
  function wireHome() {
    m.querySelectorAll('.hm [data-go]').forEach(b => b.onclick = () => { tab = b.dataset.go; lastIn[groupOf(tab)[0]] = tab; paint(); window.scrollTo({ top: 0 }); });
    m.querySelector('#hm-req')?.addEventListener('click', () => { if (!canAsk()) { tab = 'me'; paint(); return; } askRecord(LL('Fund transparency report', 'Report sa pondo'), LL('e.g. Where the Foundation Week fund went', 'pananglitan: Asa gigamit ang pondo sa Foundation Week')); });
    m.querySelector('#hm-stmt')?.addEventListener('click', () => { const tk = tok(); if (tk) statement(tk); });
  }

  /* ---- Navigation: five bottom buttons; Records, Class and More open a small switcher for their pages ---- */
  const GROUPS = [['home', LL('Home', 'Panid'), ['home'], '<path d="M3 11.5 12 4l9 7.5M5.5 10v9.5h13V10M10 19.5v-5h4v5"/>'],
    ['records', LL('Records', 'Rekord'), ['archive', 'docs'], '<path d="M7 3h8l4 4v14H7zM15 3v4h4M10 12h6M10 16h6"/>'],
    ['class', LL('Class', 'Klase'), ['officers', 'learn', 'bulletin'], '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 5.2a3 3 0 0 1 0 5.6M18 14.3c1.8.7 3 2.4 3 4.7"/>'],
    ['me', t('me'), ['me'], '<rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="9" cy="11" r="2"/><path d="M6 16c.5-1.6 1.7-2.4 3-2.4s2.5.8 3 2.4M15 10h3M15 14h3"/>'],
    ['more', LL('More', 'Dugang'), ['faq', 'privacy'], '<circle cx="5.5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18.5" cy="12" r="1.4"/>']];
  const TABLABEL = { archive: t('archive'), docs: t('pubDocs'), officers: t('officers'), learn: t('learn'), bulletin: t('bulletin'), faq: t('faq'), privacy: t('privacy'), me: t('me') };
  const shown = g => g[2].filter(k => !(auth.kind === 'guest' && GUEST_HIDE.includes(k)));
  const groupOf = k => GROUPS.find(g => g[2].includes(k)) || GROUPS[0];
  const lastIn = {};
  function subNav() {
    const g = groupOf(tab), ks = shown(g); if (ks.length < 2) return '';
    return `<div class="seg" role="tablist">${ks.map(k => `<button role="tab" data-t="${k}" class="${tab === k ? 'on' : ''}" aria-selected="${tab === k}">${TABLABEL[k]}</button>`).join('')}</div>`;
  }
  function bottomNav() {
    const cur = groupOf(tab)[0];
    return `<nav class="bnav" aria-label="Main">${GROUPS.filter(g => shown(g).length).map(g => `<button type="button" data-g="${g[0]}" class="${cur === g[0] ? 'on' : ''}"${cur === g[0] ? ' aria-current="page"' : ''}><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${g[3]}</svg><span>${g[1]}</span></button>`).join('')}</nav>`;
  }
  function paint() {
    const { off: officers, tre } = data;
    const cur = tre.open ? (tre.entries || []).filter(e => e.period_id === tre.open.id) : [];
    const views = {
      home: () => '',
      archive: () => archiveView(),
      faq: () => faqView(),
      privacy: () => privacyView(),
      officers: () => `<div class="officers">${officers.map((o, i) => `<button class="ocard" data-o="${i}" aria-label="View ${esc(o.name)}’s profile"><div class="ph">${o.photo ? `<img src="${o.photo}" alt="${esc(o.name)}" style="object-position:${o.x}% ${o.y}%">` : esc(initials(o.name))}</div><div class="tx"><b>${esc(o.name)}</b><small>${esc(o.position)}</small></div></button>`).join('')}</div><p class="muted" style="text-align:center;font-size:.85rem">Tap an officer to see their leadership profile.</p>`,
      me: () => '',
      learn: () => '',
      docs: () => { const dl = data.docs || [], open = pdOpen;
        return `<p class="muted" style="margin:0 2px 8px">${t('pubDocsNote')}</p><div class="card">${dl.map(x => `<div class="row" data-dc="${x.id}" style="cursor:pointer;display:block"><div style="display:flex;justify-content:space-between;gap:8px"><div class="m"><b>${esc(x.title)}</b><small>${esc([x.ref_no, fmtDate(x.on_date)].filter(Boolean).join(' · '))}</small></div><span class="muted">${open === x.id ? '▾' : '›'}</span></div>
          ${open === x.id ? `<div style="margin-top:8px;white-space:pre-wrap">${esc(x.body || '')}</div>${x.link ? `<p style="margin:8px 0 0"><a href="${esc(x.link)}" target="_blank" rel="noopener noreferrer">${t('pubDocsOpen')}</a></p>` : ''}` : ''}</div>`).join('') || `<div class="empty"><b>${t('pubDocsNone')}</b></div>`}</div>`; },
      bulletin: () => `${calendarHTML(data.coa || [], cal)}<p style="margin:10px 2px"><a href="https://www.facebook.com/profile.php?id=61593577524416" target="_blank" rel="noopener">${t('fbLink')}</a></p>`,
    };
    m.innerHTML = `${tab === 'home' && (data.ann || []).length ? `<div class="notices">${data.ann.map(a => `<div class="notice ${a.pinned ? 'pin' : ''}"><b>${a.pinned ? '📌 ' : '📣 '}${esc(a.title)}</b>${a.body ? `<p>${esc(a.body)}</p>` : ''}</div>`).join('')}</div>` : ''}${tab === 'home' ? alertBar() + homeHTML() : ''}
      ${subNav()}<section id="sec">${tab === 'learn' || tab === 'me' || tab === 'home' ? '' : views[tab]()}</section>${bottomNav()}`;
    wireHome(); shownTab = tab; if (tok()) refreshStanding();
    if (tab === 'learn') import('./learn.js').then(l => { if (tab === 'learn' && m.querySelector('#sec')) l.renderLearn(m.querySelector('#sec')); });
    if (tab === 'me') renderMe(m.querySelector('#sec'));
    m.querySelector('#pon')?.addEventListener('click', async e => { e.target.disabled = true; try { await enablePush(); toast('Alerts are on'); } catch (x) { toast(x.message, true); } pstate = await pushState(); paint(); });
    m.querySelector('#poff')?.addEventListener('click', async () => { try { await disablePush(); } catch { /* ignore */ } pstate = await pushState(); paint(); });
    if (tab === 'bulletin') wireCalendar(m.querySelector('#sec'), cal, paint);
    m.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { tab = b.dataset.t; lastIn[groupOf(tab)[0]] = tab; paint(); window.scrollTo({ top: 0 }); });
    m.querySelectorAll('.bnav [data-g]').forEach(b => b.onclick = () => { const g = GROUPS.find(x => x[0] === b.dataset.g); tab = lastIn[g[0]] && shown(g).includes(lastIn[g[0]]) ? lastIn[g[0]] : shown(g)[0]; paint(); window.scrollTo({ top: 0 }); });
    m.querySelectorAll('[data-dc]').forEach(b => b.onclick = e => { if (e.target.closest('a')) return; pdOpen = pdOpen === b.dataset.dc ? null : b.dataset.dc; paint(); });
    m.querySelectorAll('[data-rq]').forEach(b => b.onclick = () => askRecord(b.dataset.rq));
    m.querySelector('#rq-new')?.addEventListener('click', () => askRecord());
    m.querySelector('#rq-rcpt')?.addEventListener('click', () => askRecord('', 'Receipt for the ₱… I paid on …', 'treasurer'));
    m.querySelector('#rq-fix')?.addEventListener('click', () => askRecord(t('prvFixTitle')));
    m.querySelectorAll('[data-o]').forEach(b => b.onclick = () => showOfficerProfile(officers[+b.dataset.o]));
  }
  async function load() {
    try {
      const opt = p => db(p).catch(() => []);
      const [o, tr, ann, docs, mine, faq, coa] = await Promise.all([db(sb.rpc('v2_public_officers')), db(sb.rpc('v2_public_treasury')), opt(sb.rpc('v2_public_announcements')), opt(sb.rpc('v2_public_documents')), opt(sb.rpc('v2_my_record_requests', { p_token: tok() })), opt(sb.rpc('v2_public_faq')), opt(sb.rpc('v2_public_coa'))]);   // docs stay empty until the v30 SQL is run
      const first = !data; data = { off: o, tre: tr, ann, docs, mine: Array.isArray(mine) ? mine : [], faq: Array.isArray(faq) ? faq : [], coa: Array.isArray(coa) ? coa : [] }; announceNew(ann); if (first) pstate = await pushState(); if (first || (tab !== 'learn' && tab !== 'me')) paint();
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

/* The lock: shown instead of the class page when "Require sign-in" is on and the visitor is not signed in. */
function lockScreen(root) {
  root.innerHTML = `<div class="top"><span class="crest-ring"><img src="assets/wolf-crest.png" alt=""></span><div class="t"><b>SAILS ’28</b><small>${t('lockSub')}</small></div>
    <button class="btn ghost sm" id="txt" aria-label="Display" title="Display">Aa</button><button class="btn ghost sm" id="lang" aria-label="Language">${getLang() === 'ceb' ? 'EN' : 'CEB'}</button></div>
    <main id="m" style="padding-bottom:40px;max-width:480px;margin:0 auto"></main>`;
  root.querySelector('#lang').onclick = () => { setLang(getLang() === 'ceb' ? 'en' : 'ceb'); lockScreen(root); };
  root.querySelector('#txt').onclick = () => { const n = getTheme() === 'dark' ? 'light' : 'dark'; setTheme(n); };
  renderMe(root.querySelector('#m'), { lock: true, onSignedIn: () => renderPublic(root) });
  return () => {};
}
