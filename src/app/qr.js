/* QR helpers: scan student QR, print student QR cards, printable receipts. */
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { sb, db, esc, peso, fmtDateTime, toast, modal, printHTML, blobToDataUrl } from './core.js';

export const qrDataUrl = (text, size = 200) => QRCode.toDataURL(text, { width: size, margin: 1, errorCorrectionLevel: 'M' });

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

/* QR with the Alpha crest in the middle (error-correction H keeps it scannable). */
const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
async function brandedQR(text, size, crestUrl) {
  const base = await loadImg(await QRCode.toDataURL(text, { width: size, margin: 1, errorCorrectionLevel: 'H' }));
  const c = document.createElement('canvas'); c.width = c.height = size; const x = c.getContext('2d');
  x.drawImage(base, 0, 0, size, size);
  const d = Math.round(size * 0.22), o = (size - d) / 2, r = d / 2 + 5;
  x.fillStyle = '#fff'; x.beginPath(); x.arc(size / 2, size / 2, r, 0, 7); x.fill();
  x.strokeStyle = '#d9a63c'; x.lineWidth = 3; x.stroke();
  x.save(); x.beginPath(); x.arc(size / 2, size / 2, d / 2, 0, 7); x.clip(); x.drawImage(await loadImg(crestUrl), o, o, d, d); x.restore();
  return c.toDataURL('image/png');
}
const CARD_CSS = `@page{margin:10mm}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}
.g{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.c{break-inside:avoid;border:2px solid #0c1f5c;border-radius:14px;overflow:hidden;text-align:center;background:linear-gradient(#fff,#f2f9fb);font-family:Atkinson Hyperlegible,Inter,sans-serif}
.h{background:linear-gradient(135deg,#0c1f5c,#1d4fd8);color:#fff;padding:8px 6px 7px;border-bottom:3px solid #d9a63c}
.h img{width:34px;height:34px;border-radius:50%;background:#fff;padding:2px;display:block;margin:0 auto 3px}
.h b{display:block;font:700 12px Georgia,serif;letter-spacing:.18em}.h small{display:block;font-size:8px;letter-spacing:.08em;color:#dff1f8}
.q{padding:9px 10px 4px}.q img{width:100%;display:block}
.n{padding:2px 8px 4px}.n b{display:block;font-size:12px;color:#0c1f5c;line-height:1.2}.n small{font-size:10px;color:#2a7fb0}
.f{font-size:7.5px;letter-spacing:.14em;color:#fff;background:#2a7fb0;padding:4px;text-transform:uppercase}`;
export async function showMemberCards() {
  const members = await db(sb.from('v2_members').select('id,full_name,student_no').eq('status', 'active').order('full_name'));
  const m = modal(`<h3>Student QR cards</h3><p class="muted" id="pg">Generating ${members.length} codes…</p><div id="g"></div>`);
  const crest = await blobToDataUrl(await (await fetch('assets/wolf-crest.png')).blob());
  const cards = [];
  for (const mem of members) {
    try { cards.push({ mem, img: await brandedQR(await db(sb.rpc('v2_member_token', { p_member: mem.id })), 320, crest) }); } catch (e) { toast(e.message, true); break; }
    m.querySelector('#pg').textContent = `Generating ${cards.length}/${members.length}…`;
  }
  const html = cards.map(c => `<div class="c"><div class="h"><img src="${crest}" alt=""><b>ALPHA</b><small>BSMT 1-ALPHA · BATCH 28 · PIT-COMED</small></div>
    <div class="q"><img src="${c.img}" alt="QR"></div><div class="n"><b>${esc(c.mem.full_name)}</b><small>${esc(c.mem.student_no)}</small></div><div class="f">Scan · Pay · Verify</div></div>`).join('');
  m.querySelector('#pg').textContent = `${cards.length} cards ready. Each code is private to that student — keep the printout safe.`;
  m.querySelector('#g').innerHTML = `<button class="btn gold" id="pr" style="width:100%;margin-bottom:12px">Print / save as PDF</button><style>${CARD_CSS}.g{grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}</style><div class="g">${html}</div>`;
  m.querySelector('#pr').onclick = () => printHTML('Student QR cards', `<style>${CARD_CSS}</style><div class="g">${html}</div>`);
}

export async function showReceipt(entryId) {
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
