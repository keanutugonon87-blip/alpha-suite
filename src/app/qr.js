/* QR helpers: scan student QR, print student QR cards, printable receipts. */
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { sb, db, esc, peso, fmtDateTime, toast, modal, printHTML } from './core.js';

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

export async function showMemberCards() {
  const members = await db(sb.from('v2_members').select('id,full_name,student_no').eq('status', 'active').order('full_name'));
  const m = modal(`<h3>Student QR cards</h3><p class="muted" id="pg">Generating ${members.length} codes…</p><div id="g"></div>`);
  const cards = [];
  for (const mem of members) {
    try { cards.push({ mem, img: await qrDataUrl(await db(sb.rpc('v2_member_token', { p_member: mem.id })), 220) }); } catch (e) { toast(e.message, true); break; }
  }
  m.querySelector('#pg').textContent = `${cards.length} cards ready. Each code is private to that student — keep the printout safe.`;
  m.querySelector('#g').innerHTML = '<button class="btn gold" id="pr" style="width:100%">Print / save as PDF</button>';
  m.querySelector('#pr').onclick = () => printHTML('Student QR cards', `<style>.g{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.c{border:1px solid #999;border-radius:8px;padding:8px;text-align:center;break-inside:avoid}.c img{width:100%}.c b{display:block;font-size:12px}.c small{font-size:10px;color:#555}</style>
    <div class="g">${cards.map(c => `<div class="c"><img src="${c.img}"><b>${esc(c.mem.full_name)}</b><small>${esc(c.mem.student_no)}</small></div>`).join('')}</div>`);
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
