/* QR helpers: scan student QR, print student QR cards, printable receipts. */
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { sb, db, esc, peso, fmtDateTime, toast, modal, printHTML, blobToDataUrl, uuid, getProfile } from './core.js';

export const qrDataUrl = (text, size = 200) => QRCode.toDataURL(text, { width: size, margin: 1, errorCorrectionLevel: 'M' });

/* Student self-check: returns the raw A1.… code from the camera, a photo, or null. */
export function scanRaw(title = 'Scan your QR card') {
  return new Promise(resolve => {
    let stream = null, stop = false, done = false;
    const finish = v => { if (done) return; done = true; stop = true; stream && stream.getTracks().forEach(t => t.stop()); m.remove(); resolve(v); };
    const m = modal(`<h3>${esc(title)}</h3><video id="v" playsinline muted style="width:100%;border-radius:12px;background:#000;aspect-ratio:1"></video><p class="muted" id="st">Starting camera…</p><button class="btn ghost" id="cx" style="width:100%">Cancel</button>`, el => { el.querySelector('#cx').onclick = () => finish(null); });
    (async () => {
      const st = m.querySelector('#st'), v = m.querySelector('#v');
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        v.srcObject = stream; await v.play(); st.textContent = 'Point at your QR code';
        const c = document.createElement('canvas'), x = c.getContext('2d', { willReadFrequently: true });
        const bd = 'BarcodeDetector' in window ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null;
        while (!stop) {
          let raw = null;
          try { if (bd) raw = (await bd.detect(v))[0]?.rawValue; else { c.width = v.videoWidth; c.height = v.videoHeight; x.drawImage(v, 0, 0); const d = x.getImageData(0, 0, c.width, c.height); raw = jsQR(d.data, d.width, d.height)?.data; } } catch { /* next frame */ }
          if (raw && raw.startsWith('A1.')) return finish(raw);
          await new Promise(r => setTimeout(r, 250));
        }
      } catch (e) { st.textContent = 'Camera unavailable. Use a photo of your card or paste your code instead.'; }
    })();
  });
}
export async function readQRFromFile(file) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  const k = Math.min(1, 1400 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = img.width * k; c.height = img.height * k;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0, c.width, c.height);
  const d = x.getImageData(0, 0, c.width, c.height), r = jsQR(d.data, d.width, d.height);
  if (!r) throw new Error('Could not find a QR code in that photo. Try a clearer, closer shot.');
  return r.data;
}

/* Keeps the camera open and calls onRaw(code) for every Alpha QR it sees, until the host element leaves the page. Throws when there is no camera. */
export async function scanLoop(host, video, onRaw, onStream) {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
  try {
    video.srcObject = stream; await video.play(); onStream && onStream(stream);
    const c = document.createElement('canvas'), x = c.getContext('2d', { willReadFrequently: true });
    const bd = 'BarcodeDetector' in window ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null;
    while (host.isConnected) {
      let raw = null;
      try { if (bd) raw = (await bd.detect(video))[0]?.rawValue; else { c.width = video.videoWidth; c.height = video.videoHeight; x.drawImage(video, 0, 0); const d = x.getImageData(0, 0, c.width, c.height); raw = jsQR(d.data, d.width, d.height)?.data; } } catch { /* next frame */ }
      if (raw && raw.startsWith('A1.')) await onRaw(raw);
      await new Promise(r => setTimeout(r, 250));
    }
  } finally { stream.getTracks().forEach(t => t.stop()); }
}

export function scanMember() {
  return new Promise(resolve => {
    let stream = null, stop = false, done = false;
    const finish = v => { if (done) return; done = true; stop = true; stream && stream.getTracks().forEach(t => t.stop()); m.remove(); resolve(v); };
    const m = modal(`<h3>Scan student QR</h3><video id="v" playsinline muted style="width:100%;border-radius:12px;background:#000;aspect-ratio:1"></video>
      <p class="muted" id="st">Starting camera…</p><button class="btn ghost" id="cx" style="width:100%">Cancel</button>`, el => { el.querySelector('#cx').onclick = () => finish(null); });
    (async () => {
      const st = m.querySelector('#st'), v = m.querySelector('#v');
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        v.srcObject = stream; await v.play(); st.textContent = 'Point at the student’s QR code';
        const c = document.createElement('canvas'), x = c.getContext('2d', { willReadFrequently: true });
        const bd = 'BarcodeDetector' in window ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null;
        const read = async () => {
          if (bd) return (await bd.detect(v))[0]?.rawValue;
          c.width = v.videoWidth; c.height = v.videoHeight; x.drawImage(v, 0, 0);
          const d = x.getImageData(0, 0, c.width, c.height); return jsQR(d.data, d.width, d.height)?.data;
        };
        while (!stop) {
          const raw = await read().catch(() => null);
          if (raw && raw.startsWith('A1.')) {
            try { return finish(await db(sb.rpc('v2_resolve_token', { p_token: raw }))); }
            catch (e) { st.textContent = e.message; await new Promise(r => setTimeout(r, 1600)); st.textContent = 'Point at the student’s QR code'; }
          }
          await new Promise(r => setTimeout(r, 250));
        }
      } catch (e) { st.textContent = 'Camera unavailable (' + (e.message || e) + '). Pick the student manually instead.'; }
    })();
  });
}

/* QR with a faint, see-through Alpha wolf in the middle (error-correction H keeps it scannable). */
const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
async function brandedQR(text, size, crestUrl) {
  const base = await loadImg(await QRCode.toDataURL(text, { width: size, margin: 1, errorCorrectionLevel: 'H' }));
  const c = document.createElement('canvas'); c.width = c.height = size; const x = c.getContext('2d');
  x.drawImage(base, 0, 0, size, size);
  const crest = await loadImg(crestUrl), h = Math.round(size * 0.26), w = h * crest.width / crest.height;
  x.globalAlpha = 0.42; x.drawImage(crest, (size - w) / 2, (size - h) / 2, w, h); x.globalAlpha = 1;
  return c.toDataURL('image/png');
}
/* "Dela Cruz, Ace" style key from a first-name-first name, ignoring Jr./Sr./III */
const PARTS = new Set(['dela', 'de', 'del', 'delos', 'dela', 'san', 'santa', 'van', 'von', 'la', 'le']);
export function surnameKey(full) {
  const w = full.replace(/,/g, ' ').trim().split(/\s+/).filter(x => !/^(jr|sr|ii|iii|iv)\.?$/i.test(x));
  let i = w.length - 1; while (i > 1 && PARTS.has(w[i - 1].toLowerCase())) i--;
  return (w.slice(i).join(' ') + ', ' + w.slice(0, i).join(' ')).toLowerCase();
}
const CARD_CSS = `@page{margin:10mm}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}
.g{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.c{break-inside:avoid;border:2px solid #0c1f5c;border-radius:14px;overflow:hidden;text-align:center;background:#fff;font-family:Atkinson Hyperlegible,Inter,sans-serif}
.h{background:#fff;padding:7px 10px 5px;border-bottom:3px solid #d9a63c}
.h img{width:100%;display:block;height:auto}
.h small{display:block;font-size:7.5px;letter-spacing:.14em;color:#2a7fb0;margin-top:1px}
.q{padding:9px 10px 4px;background:linear-gradient(#fff,#f2f9fb)}.q img{width:100%;display:block}
.n{padding:2px 8px 3px;background:#f2f9fb}.n b{display:block;font-size:12px;color:#0c1f5c;line-height:1.2}.n small{font-size:10px;color:#2a7fb0}
.k{padding:3px 8px 6px;background:#f2f9fb}.k span{display:block;font:700 6px Atkinson Hyperlegible,sans-serif;letter-spacing:.16em;color:#9a6f12}
.k code{display:block;font:5.6px/1.35 ui-monospace,Menlo,Consolas,monospace;color:#14233f;word-break:break-all}
.f{font-size:7.5px;letter-spacing:.14em;color:#fff;background:#0c1f5c;padding:4px;text-transform:uppercase}`;
export async function showMemberCards() {
  const members = (await db(sb.from('v2_members').select('id,full_name,student_no').eq('status', 'active'))).sort((a, b) => surnameKey(a.full_name).localeCompare(surnameKey(b.full_name)));
  const m = modal(`<h3>Student QR cards</h3><p class="muted" id="pg">Generating ${members.length} codes…</p><div id="g"></div>`);
  const toUrl = async u => blobToDataUrl(await (await fetch(u)).blob());
  const [crest, word] = await Promise.all([toUrl('assets/wolf-crest.png'), toUrl('assets/alpha-wordmark.jpg')]);
  const cards = [];
  for (const mem of members) {
    try { const code = await db(sb.rpc('v2_member_token', { p_member: mem.id })); cards.push({ mem, code, img: await brandedQR(code, 320, crest) }); } catch (e) { toast(e.message, true); break; }
    m.querySelector('#pg').textContent = `Generating ${cards.length}/${members.length}…`;
  }
  const html = cards.map(c => `<div class="c"><div class="h"><img src="${word}" alt="ALPHA"><small>BSMT 1-ALPHA · BATCH 28 · PIT-COMED</small></div>
    <div class="q"><img src="${c.img}" alt="QR"></div><div class="n"><b>${esc(c.mem.full_name)}</b><small>${esc(c.mem.student_no)}</small></div>
    <div class="k"><span>ALPHA CODE</span><code>${esc(c.code)}</code></div><div class="f">Scan · Pay · Verify</div></div>`).join('');
  m.querySelector('#pg').textContent = `${cards.length} cards ready, in alphabetical order by last name. Each code is private to that student — keep the printout safe.`;
  m.querySelector('#g').innerHTML = `<button class="btn gold" id="pr" style="width:100%;margin-bottom:12px">Print / save as PDF</button><style>${CARD_CSS}.g{grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}</style><div class="g">${html}</div>`;
  m.querySelector('#pr').onclick = () => printHTML('Student QR cards', `<style>${CARD_CSS}</style><div class="g">${html}</div>`, { plain: true });
}

export async function showReceipt(entryId) {
  // official receipts are released only by the SAILS Treasurer, and only after he has confirmed the collection
  const me = await getProfile().catch(() => null);
  if (!me || me.role !== 'treasurer') { modal(`<h3>Official receipt</h3><p>Official receipts and supporting documents are issued by the SAILS Treasurer after he counts and confirms the collection.</p><button class="btn ghost" id="cl" style="width:100%">Close</button>`, (m, close) => { m.querySelector('#cl').onclick = close; }); return; }
  const cf = await sb.from('v2_entries').select('confirmed_at').eq('id', entryId).single().then(r => r.error ? { confirmed_at: true } : r.data, () => ({ confirmed_at: true }));   // no column yet: the old rules apply
  if (!cf.confirmed_at) { modal(`<h3>Not confirmed yet</h3><p>Count and confirm this collection first. The official receipt can be issued after that.</p><button class="btn ghost" id="cl" style="width:100%">Close</button>`, (m, close) => { m.querySelector('#cl').onclick = close; }); return; }
  const e = await db(sb.from('v2_entries').select('receipt_no,verify_code,amount,purpose,category,occurred_at,method,gcash_ref,member_id,payer_name,recorded_by_name').eq('id', entryId).single());
  let payer = e.payer_name;
  if (e.member_id) payer = (await db(sb.from('v2_members').select('full_name').eq('id', e.member_id).single())).full_name;
  const img = await qrDataUrl(`${location.origin}${location.pathname}#/receipt/${e.verify_code}`, 180);
  const body = `<div style="text-align:center"><img src="assets/wolf-crest.png" width="56"><h3 style="margin:6px 0">OFFICIAL RECEIPT</h3><small>BSMT 1-Alpha · Class Fund</small></div>
    <div class="row"><span>Receipt no.</span><b>${esc(e.receipt_no)}</b></div><div class="row"><span>Received from</span><b>${esc(payer)}</b></div>
    <div class="row"><span>Amount</span><b>${peso(e.amount)}</b></div><div class="row"><span>For</span><b>${esc(e.purpose || e.category)}</b></div>
    <div class="row"><span>Date</span><b>${fmtDateTime(e.occurred_at)}</b></div><div class="row"><span>Method</span><b>${e.method === 'gcash' ? 'GCash ' + esc(e.gcash_ref || '') : 'Cash'}</b></div>
    <div class="row"><span>Received by</span><b>${esc(e.recorded_by_name || '—')}</b></div>
    <div style="text-align:center;margin-top:10px"><img src="${img}" width="150"><br><small>Scan to verify this receipt</small></div>`;
  modal(`<div>${body}</div><div style="display:flex;gap:8px;margin-top:12px"><button class="btn gold" id="pr" style="flex:1">Print / save PDF</button><button class="btn ghost" id="cl">Close</button></div>`, (m, close) => {
    m.querySelector('#cl').onclick = close;
    m.querySelector('#pr').onclick = () => printHTML(e.receipt_no, `<div style="max-width:340px;margin:auto">${body.replace('src="assets/', 'src="' + location.origin + location.pathname.replace(/[^/]*$/, '') + 'assets/')}</div>`);
  });
}

/* Secretary / officer tool: make QR cards from typed details — one student, or a pasted batch.
   Existing students (matched by Student ID) are reused; new ones are added to the roster.
   `guard` = true skips students who already signed up with a PIN, so a printout can't expose a live credential. */
export function makeQRCodes({ guard = false } = {}) {
  const m = modal(`<h3>Make QR codes</h3>
    <div class="bar" style="margin-bottom:8px"><button class="btn gold sm" data-t="one">One student</button><button class="btn ghost sm" data-t="many">Batch</button></div>
    <div id="p1"><label>Student ID</label><input id="i1" placeholder="26-0000-000"><label>Full name</label><input id="n1"><label>Section / group</label><input id="s1"></div>
    <div id="pm" hidden><p class="muted" style="margin:0 0 6px">One student per line: <b>Student ID, Full name, Section</b> (commas or tabs — you can paste straight from Excel).</p>
      <textarea id="bt" rows="8" placeholder="26-0001-001, Juan Dela Cruz, Section A"></textarea></div>
    <button class="btn gold" id="go" style="width:100%;margin-top:12px">Make QR codes</button><div class="err" id="er"></div><div id="out"></div>`);
  let mode = 'one';
  m.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { mode = b.dataset.t;
    m.querySelector('#p1').hidden = mode !== 'one'; m.querySelector('#pm').hidden = mode !== 'many';
    m.querySelectorAll('[data-t]').forEach(x => x.className = 'btn sm ' + (x === b ? 'gold' : 'ghost')); });
  m.querySelector('#go').onclick = async () => {
    const er = m.querySelector('#er'); er.textContent = '';
    const raw = mode === 'one' ? [[m.querySelector('#i1').value, m.querySelector('#n1').value, m.querySelector('#s1').value]]
      : m.querySelector('#bt').value.split(/\r?\n/).map(l => l.split(/\t|,/).map(x => x.trim())).filter(r => r.some(Boolean));
    const seen = new Set(), list = [], bad = [];
    raw.forEach((r, i) => { const [no, name, sec] = [r[0] || '', r[1] || '', r.slice(2).join(', ')];
      if (!no || !name) return bad.push(`Line ${i + 1}: needs a Student ID and a name`);
      if (seen.has(no.toLowerCase())) return bad.push(`Line ${i + 1}: ${no} is listed twice`);
      seen.add(no.toLowerCase()); list.push({ no, name, sec }); });
    if (!list.length) { er.textContent = bad.join(' · ') || 'Enter at least one student.'; return; }
    if (list.length > 150) { er.textContent = 'Please keep a batch to 150 students or fewer.'; return; }
    const btn = m.querySelector('#go'); btn.disabled = true; const note = [...bad];
    try {
      const have = await db(sb.from('v2_members').select('id,full_name,student_no,section,status'));
      const byNo = new Map(have.map(h => [h.student_no.toLowerCase(), h]));
      const pins = guard ? new Set(await sb.rpc('v2_pin_members').then(r => (r.data || []).map(x => x.member_id), () => [])) : new Set();
      const toUrl = async u => blobToDataUrl(await (await fetch(u)).blob());
      const [crest, word] = await Promise.all([toUrl('assets/wolf-crest.png'), toUrl('assets/alpha-wordmark.jpg')]);
      const cards = []; let added = 0;
      for (const [i, r] of list.entries()) {
        btn.textContent = `Making ${i + 1}/${list.length}…`;
        let mem = byNo.get(r.no.toLowerCase());
        if (mem && guard && pins.has(mem.id)) { note.push(`${r.no} (${mem.full_name}) already signed up — ask the SAILS Treasurer or Mayor for a new card`); continue; }
        if (!mem) { mem = { id: uuid(), full_name: r.name, student_no: r.no, section: r.sec || null, status: 'active' };
          await db(sb.from('v2_members').insert(mem)); added++; }
        else if (mem.full_name.toLowerCase() !== r.name.toLowerCase()) note.push(`${r.no}: kept roster name "${mem.full_name}" (you typed "${r.name}")`);
        const code = await db(sb.rpc('v2_member_token', { p_member: mem.id }));
        cards.push({ mem, code, img: await brandedQR(code, 320, crest) });
      }
      cards.sort((a, b) => surnameKey(a.mem.full_name).localeCompare(surnameKey(b.mem.full_name)));
      const html = cards.map(c => `<div class="c"><div class="h"><img src="${word}" alt="ALPHA"><small>BSMT 1-ALPHA · BATCH 28 · PIT-COMED</small></div>
        <div class="q"><img src="${c.img}" alt="QR"></div><div class="n"><b>${esc(c.mem.full_name)}</b><small>${esc(c.mem.student_no)}${c.mem.section ? ' · ' + esc(c.mem.section) : ''}</small></div>
        <div class="k"><span>ALPHA CODE</span><code>${esc(c.code)}</code></div><div class="f">Scan · Pay · Verify</div></div>`).join('');
      m.querySelector('#out').innerHTML = `<p class="muted" style="margin-top:12px">${cards.length} card${cards.length === 1 ? '' : 's'} ready${added ? ` · ${added} new student${added === 1 ? '' : 's'} added to the roster` : ''}. Each code is private to that student — hand it over, don't post it.</p>
        ${note.length ? `<ul class="muted" style="font-size:.85em">${note.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        ${cards.length ? `<button class="btn gold" id="pr" style="width:100%;margin:8px 0">Print / save as PDF</button><style>${CARD_CSS}.g{grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}</style><div class="g">${html}</div>` : ''}`;
      m.querySelector('#pr')?.addEventListener('click', () => printHTML('Student QR cards', `<style>${CARD_CSS}</style><div class="g">${html}</div>`, { plain: true }));
    } catch (e) { er.textContent = /duplicate/i.test(e.message) ? 'A Student ID in your list clashes with one already on the roster.' : e.message; }
    btn.disabled = false; btn.textContent = 'Make QR codes';
  };
}
