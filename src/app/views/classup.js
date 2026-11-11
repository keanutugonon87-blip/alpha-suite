import { sb, db, watch, esc, toast, modal, skeleton, fmtDate, fmtDateTime } from '../core.js';
import { KIND, isProgress, progressBlock, loadPhotos, photoStrip, wirePhotos, addPhoto } from './progress.js';

/* The SAILS VP Internal reads the Class Mayors' weekly reports and decides on their requests. Class Mayors report to him; he can also send them directives. */
export async function mountClassUp(el, ctx) {
  let reps = [], asks = [], tab = 'asks', photos = new Map();
  el.innerHTML = skeleton(4);
  async function load() {
    [reps, asks] = await Promise.all([
      sb.from('v2_class_reports').select('*').order('submitted_at', { ascending: false }).limit(40).then(x => x.error ? [] : x.data || [], () => []),
      sb.from('v2_class_asks').select('*').order('created_at', { ascending: false }).limit(60).then(x => x.error ? [] : x.data || [], () => []),
    ]);
    photos = await loadPhotos(asks.filter(isProgress).map(a => a.id));
    draw();
  }
  const wk = d => fmtDate(d + 'T00:00:00+08:00');
  function draw() {
    const open = asks.filter(a => a.status === 'open'), unread = reps.filter(r => !r.reviewed_at);
    const list = tab === 'asks'
      ? (asks.length ? asks.map(a => `<div class="row" style="display:block" data-a="${a.id}"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px"><div class="m"><b>${esc(a.title)}</b><small>${esc(a.from_name || 'Class Mayor')} · ${KIND[a.kind] || a.kind}${!isProgress(a) && a.amount != null ? ' · ₱' + Number(a.amount).toLocaleString('en-PH') : ''} · ${fmtDateTime(a.created_at)}</small></div><span class="tag ${a.status === 'open' ? 'warn' : a.status === 'approved' ? 'ok' : 'bad'}">${a.status === 'open' ? 'Waiting' : isProgress(a) ? (a.status === 'approved' ? 'Received' : 'Sent back') : a.status}</span></div>${isProgress(a) ? progressBlock(a) + photoStrip(photos.get(a.id)) + '<div class="acts" style="margin-top:6px"><button class="btn ghost sm" data-ph-add>Add photo</button></div>' : ''}${a.details ? `<p style="margin:6px 0 0">${esc(a.details)}</p>` : ''}${a.decision_note ? `<p class="muted" style="margin:6px 0 0">${esc(a.decision_note)}</p>` : ''}${a.status === 'open' ? `<div class="acts" style="margin-top:8px"><button class="btn gold sm" data-d="1">${isProgress(a) ? 'Received' : 'Approve'}</button><button class="btn ghost sm" data-d="0">${isProgress(a) ? 'Send back' : 'Decline'}</button></div>` : ''}</div>`).join('') : '<p class="empty">No requests.</p>')
      : (reps.length ? reps.map(r => { const s = r.summary || {}; return `<div class="row" style="display:block" data-r="${r.id}"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px"><div class="m"><b>${esc(r.mayor_name || 'Class Mayor')} · week of ${wk(r.week_start)}</b><small>${s.issued || 0} sent · ${s.confirmed || 0} finished · ${s.open || 0} open · ${(s.late || []).length} late</small></div><span class="tag ${r.reviewed_at ? 'ok' : 'warn'}">${r.reviewed_at ? 'Reviewed' : 'New'}</span></div>${(s.late || []).map(l => `<small class="muted" style="display:block">Late: ${esc(l.title)} · ${esc(l.who)}</small>`).join('')}${r.note ? `<p style="margin:6px 0 0">${esc(r.note)}</p>` : ''}${r.review_note ? `<p class="muted" style="margin:6px 0 0">You: ${esc(r.review_note)}</p>` : ''}${r.reviewed_at ? '' : '<div class="acts" style="margin-top:8px"><button class="btn gold sm" data-rv>Mark as read</button></div>'}</div>`; }).join('') : '<p class="empty">No reports yet.</p>');
    el.innerHTML = `<p class="muted" style="margin:0 2px 8px">Class Mayors report to you. To give a Class Mayor a task, use Directives.</p><div class="bar"><button class="btn ${tab === 'asks' ? 'gold' : 'ghost'} sm" data-t="asks">Requests (${open.length})</button><button class="btn ${tab === 'reps' ? 'gold' : 'ghost'} sm" data-t="reps">Weekly reports (${unread.length} new)</button></div><div class="card">${list}</div>`;
    el.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { tab = b.dataset.t; draw(); });
    const ask = (title, req, cb) => modal(`<h3>${title}</h3><form id="f"><label>Note${req ? ' (required)' : ' (optional)'}</label><textarea name="n" rows="3" maxlength="500"${req ? ' required' : ''}></textarea><div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">Save</button><button type="button" class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div></form>`, (m, close) => {
      m.querySelector('#cx').onclick = close;
      m.querySelector('#f').onsubmit = async e => { e.preventDefault(); try { await cb(new FormData(e.target).get('n')); close(); load(); } catch (x) { m.querySelector('#er').textContent = x.message; } };
    });
    wirePhotos(el, photos);
    el.querySelectorAll('[data-ph-add]').forEach(b => b.onclick = () => addPhoto(b.closest('[data-a]').dataset.a, load));
    el.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { const id = b.closest('[data-a]').dataset.a, yes = b.dataset.d === '1'; const pr = isProgress(asks.find(x => x.id === id) || {}); ask(yes ? (pr ? 'Mark the progress report as received' : 'Approve the request') : (pr ? 'Send the progress report back' : 'Decline the request'), !yes, async n => { await db(sb.rpc('v2_class_ask_decide', { p_id: id, p_approve: yes, p_note: n })); toast(yes ? (pr ? 'Marked as received' : 'Approved') : (pr ? 'Sent back' : 'Declined')); }); });
    el.querySelectorAll('[data-rv]').forEach(b => b.onclick = () => ask('Mark the report as read', false, async n => { await db(sb.rpc('v2_class_report_review', { p_id: b.closest('[data-r]').dataset.r, p_note: n })); toast('Marked as read'); }));
  }
  await load();
  return watch(['v2_class_reports', 'v2_class_asks', 'v2_class_ask_photos'], () => load().catch(() => {}));
}
