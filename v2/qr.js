/* Alpha Suite v2 — QR helpers: scanning member QR codes, member QR cards, printable receipts. */
import { sb, db, esc, peso, fmtDateTime, toast, modal } from './lib.js?v=1';

let qrLib = null;
async function qrcode() { return qrLib ||= (await import('https://cdn.jsdelivr.net/npm/qrcode@1.5.3/+esm')).default; }
export async function qrDataUrl(text, size = 200) { return (await qrcode()).toDataURL(text, { width: size, margin: 1, errorCorrectionLevel: 'M' }); }

/* Scan a member QR with the camera (BarcodeDetector, falling back to jsQR). Resolves with {id,name,student_no} or null. */
export function scanMember() {
  return new Promise(resolve => {
    let stream = null, stop = false, done = false;
    const finish = v => { if (done) return; done = true; stop = true; stream && stream.getTracks().forEach(t => t.stop()); m.remove(); resolve(v); };
    const m = modal(`<h3>Scan student QR</h3><video id="v" playsinline muted style="width:100%;border-radius:12px;background:#000;aspect-ratio:1"></video>
      <p class="muted" id="st">Starting camera…</p><button class="btn ghost" id="cx" style="width:100%">Cancel</button>`, el => {
      el.querySelector('#cx').onclick = () => finish(null);
    });
    m.addEventListener('click', e => { if (e.target === m) finish(null); });
    (async () => {
      const st = m.querySelector('#st'), v = m.querySelector('#v');
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        v.srcObject = stream; await v.play(); st.textContent = 'Point at the student’s QR code';
        let detect;
        if ('BarcodeDetector' in window) { const bd = new BarcodeDetector({ formats: ['qr_code'] }); detect = async () => (await bd.detect(v))[0]?.rawValue; }
        else {
          await new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js'; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
          const c = document.createElement('canvas'), x = c.getContext('2d', { willReadFrequently: true });
          detect = async () => { c.width = v.videoWidth; c.height = v.videoHeight; x.drawImage(v, 0, 0); const d = x.getImageData(0, 0, c.width, c.height); return window.jsQR(d.data, d.width, d.height)?.data; };
        }
        while (!stop) {
          const raw = await detect().catch(() => null);
          if (raw && raw.startsWith('A1.')) {
            try { const r = await db(sb.rpc('v2_resolve_token', { p_token: raw })); return finish(r); }
            catch (e) { st.textContent = e.message; await new Promise(r => setTimeout(r, 1500)); st.textContent = 'Point at the student’s QR code'; }
          }
          await new Promise(r => setTimeout(r, 250));
        }
      } catch (e) { st.textContent = 'Camera unavailable (' + (e.message || e) + '). Pick the student manually instead.'; }
    })();
  });
}

/* Printable QR cards for every active student (Mayor / Treasurer). */
export async function showMemberCards() {
  const members = await db(sb.from('v2_members').select('id,full_name,student_no').eq('status', 'active').order('full_name'));
  const m = modal(`<h3>Student QR cards</h3><p class="muted" id="pg">Generating ${members.length} codes…</p><div id="g"></div>`);
  const cards = [];
  for (const mem of members) {
    try { const tok = await db(sb.rpc('v2_member_token', { p_member: mem.id })); cards.push({ mem, img: await qrDataUrl(tok, 220) }); } catch (e) { toast(e.message, true); break; }
  }
  const html = `<style>body{font-family:sans-serif}.g{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.c{border:1px solid #999;border-radius:8px;padding:8px;text-align:center;break-inside:avoid}.c img{width:100%}.c b{display:block;font-size:12px}.c small{font-size:10px;color:#555}</style><div class="g">${cards.map(c => `<div class="c"><img src="${c.img}"><b>${esc(c.mem.full_name)}</b><small>${esc(c.mem.student_no)}</small></div>`).join('')}</div>`;
  m.querySelector('#pg').textContent = `${cards.length} cards ready. Each code is private to that student — keep the printout safe.`;
  m.querySelector('#g').innerHTML = '<button class="btn gold" id="pr" style="width:100%">Print / save as PDF</button>';
  m.querySelector('#pr').onclick = () => { const w = window.open('', '_blank'); if (!w) return toast('Allow pop-ups to print', true); w.document.write(`<title>Student QR cards</title>${html}`); w.document.close(); setTimeout(() => w.print(), 400); };
}

/* Receipt with a QR that opens the public verification page (no login, so it can never 404 behind a gate). */
export async function showReceipt(entryId) {
  const e = await db(sb.from('v2_entries').select('receipt_no,verify_code,amount,purpose,category,occurred_at,method,gcash_ref,member_id,payer_name,recorded_by_name').eq('id', entryId).single());
  let payer = e.payer_name;
  if (e.member_id) payer = (await db(sb.from('v2_members').select('full_name').eq('id', e.member_id).single())).full_name;
  const url = new URL(`receipt.html?c=${e.verify_code}`, location.href).href;
  const img = await qrDataUrl(url, 180);
  const body = `<div style="text-align:center"><img src="../assets/wolf-crest.png" width="56"><h3 style="margin:6px 0">OFFICIAL RECEIPT</h3><small>BSMT 1-Alpha · Class Fund</small></div>
    <div class="row"><span>Receipt no.</span><b>${esc(e.receipt_no)}</b></div><div class="row"><span>Received from</span><b>${esc(payer)}</b></div>
    <div class="row"><span>Amount</span><b>${peso(e.amount)}</b></div><div class="row"><span>For</span><b>${esc(e.purpose || e.category)}</b></div>
    <div class="row"><span>Date</span><b>${fmtDateTime(e.occurred_at)}</b></div><div class="row"><span>Method</span><b>${e.method === 'gcash' ? 'GCash ' + esc(e.gcash_ref || '') : 'Cash'}</b></div>
    <div class="row"><span>Received by</span><b>${esc(e.recorded_by_name || '—')}</b></div>
    <div style="text-align:center;margin-top:10px"><img src="${img}" width="150"><br><small>Scan to verify this receipt</small></div>`;
  modal(`<div id="rc">${body}</div><div style="display:flex;gap:8px;margin-top:12px"><button class="btn gold" id="pr" style="flex:1">Print / save PDF</button><button class="btn ghost" id="cl">Close</button></div>`, (m, close) => {
    m.querySelector('#cl').onclick = close;
    m.querySelector('#pr').onclick = () => { const w = window.open('', '_blank'); if (!w) return toast('Allow pop-ups to print', true);
      w.document.write(`<title>${esc(e.receipt_no)}</title><style>body{font-family:sans-serif;max-width:340px;margin:20px auto}.row{display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid #ddd}</style>${body}`); w.document.close(); setTimeout(() => w.print(), 400); };
  });
}
