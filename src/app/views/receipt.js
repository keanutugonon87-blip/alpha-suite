import { sb, esc, peso, fmtDateTime, share } from '../core.js';
export async function renderReceipt(root, { code, legacy }) {
  root.innerHTML = `<div class="top"><span class="crest-ring"><img src="assets/wolf-crest.png" alt=""></span><div class="t"><b>Alpha ’28</b><small>Receipt verification</small></div><a class="btn ghost sm" style="text-decoration:none" href="#/">Home</a></div><main><p class="empty">Checking…</p></main>`;
  const m = root.querySelector('main');
  try {
    const { data, error } = legacy ? await sb.rpc('v2_verify_legacy_receipt', { p_txn: legacy }) : await sb.rpc('v2_verify_receipt', { p_code: code });
    if (error) throw error;
    m.innerHTML = data ? `<div class="card"><p><span class="tag ok">Verified</span></p><h2 style="margin:6px 0">${esc(data.receipt_no)}</h2>
      <div class="row"><span>Received from</span><b>${esc(data.payer)}</b></div><div class="row"><span>Amount</span><b>${peso(data.amount)}</b></div>
      <div class="row"><span>For</span><b>${esc(data.purpose || data.category)}</b></div><div class="row"><span>Date</span><b>${fmtDateTime(data.at)}</b></div>
      <div class="row"><span>Status</span><b>${esc(data.status)}</b></div><button class="btn ghost" id="sh" style="width:100%;margin:12px 0 6px">Share receipt</button></div>`
      : `<div class="card"><span class="tag bad">Not found</span><p>This receipt does not exist or was voided. Ask the Treasurer.</p></div>`;
    m.querySelector('#sh')?.addEventListener('click', () => share({ title: 'Official receipt ' + data.receipt_no, text: `Verified receipt ${data.receipt_no} · ${peso(data.amount)}`, url: location.href }));
  } catch (e) { m.innerHTML = `<div class="card"><b>Couldn't check this receipt.</b><p class="muted">${esc(e.message)}</p><button class="btn" onclick="location.reload()">Retry</button></div>`; }
}
