import { sb, db, watch, esc, toast, modal, skeleton, fmtDate } from '../core.js';

/* The Class Mayor Desk. He only receives: the meeting agenda, the minutes, and the letters and resolutions the SAILS Secretary has had approved.
   He can read each one and mark it received. The SAILS Secretary and VP Internal can see who has received what.
   Run supabase/v55_mayor_desk_receives.sql once for the council meetings and the received marks. */
const SHOWN = ['approved', 'classified', 'published'];
const KIND = { minutes: 'Minutes', resolution: 'Resolution', letter_in: 'Letter received', letter_out: 'Letter sent' };
const TABS = [['agenda', 'Agenda'], ['minutes', 'Minutes'], ['letters', 'Letters'], ['calendar', 'Calendar']];
const day = d => fmtDate(d + 'T00:00:00+08:00');

export async function mountMayorDesk(el, ctx) {
  let tab = 'agenda', items = [], cal = [], got = new Set(), setup = false, insp = null;
  const key = i => i.src + ':' + i.id;
  el.innerHTML = skeleton(4);

  async function load() {
    const today = new Date(Date.now() + 8 * 36e5).toISOString().slice(0, 10);
    const [mt, rc, ca, rv] = await Promise.all([
      sb.from('v2_council_meetings').select('id,title,held_on,held_at,venue,agenda,minutes,status,created_at,updated_at').neq('status', 'cancelled').order('held_on', { ascending: false }).limit(60).then(r => r.error ? (setup = true, []) : r.data || [], () => (setup = true, [])),
      sb.from('v2_office_records').select('id,kind,title,ref_no,on_date,party,body,flow,classification,approved_at,published_at,created_by_name,updated_at').in('kind', ['minutes', 'resolution', 'letter_in', 'letter_out']).in('flow', SHOWN).order('on_date', { ascending: false }).limit(80).then(r => (r.data || []).filter(x => x.classification !== 'confidential'), () => []),
      sb.from('v2_coa').select('id,title,starts_on,ends_on,time_note,venue,details,status').eq('status', 'approved').gte('starts_on', today).order('starts_on').limit(40).then(r => r.data || [], () => []),
      sb.from('v2_desk_receipts').select('src,src_id').then(r => r.data || [], () => []),
    ]);
    items = [];
    mt.forEach(m => {
      if (m.agenda && m.status === 'planned') items.push({ src: 'agenda', id: m.id, tab: 'agenda', kind: 'Agenda', title: m.title, when: m.held_on, sub: [day(m.held_on), m.held_at, m.venue].filter(Boolean).join(' · '), body: m.agenda, at: m.updated_at || m.created_at });
      if (m.minutes) items.push({ src: 'minutes', id: m.id, tab: 'minutes', kind: 'Minutes', title: m.title, when: m.held_on, sub: [day(m.held_on), m.venue].filter(Boolean).join(' · '), body: m.minutes, at: m.updated_at || m.created_at });
    });
    rc.forEach(r => items.push({ src: 'record', id: r.id, tab: r.kind === 'minutes' ? 'minutes' : 'letters', kind: KIND[r.kind] || 'Record', title: r.title, when: r.on_date, sub: [r.ref_no, r.on_date ? day(r.on_date) : '', r.party].filter(Boolean).join(' · '), body: r.body, at: r.approved_at || r.updated_at }));
    cal = ca;
    insp = await import('./inspection.js').then(m => m.inspectionAlerts(ctx.profile.user_id || ctx.user?.id), () => null);
    got = new Set(rv.map(x => x.src + ':' + x.src_id));
    paint();
  }

  const isNew = i => !got.has(key(i));
  const row = i => `<div class="row" data-o="${esc(key(i))}" style="cursor:pointer"><div class="m"><b>${esc(i.title)}</b><small>${esc(i.kind)}${i.sub ? ' · ' + esc(i.sub) : ''}</small></div>${isNew(i) ? '<span class="tag warn">new</span>' : '<span class="tag ok">received</span>'}<span class="muted">›</span></div>`;

  function paint() {
    if (setup) { el.innerHTML = '<div class="card"><p class="empty">Run the v55 SQL in Supabase to turn the Mayor Desk on.</p></div>'; return; }
    const fresh = items.filter(isNew).sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const count = t => items.filter(i => i.tab === t && isNew(i)).length;
    const list = items.filter(i => i.tab === tab).sort((a, b) => tab === 'agenda' ? String(a.when).localeCompare(String(b.when)) : String(b.when || b.at).localeCompare(String(a.when || a.at)));
    const empty = { agenda: 'No meeting agenda has been sent to you.', minutes: 'No minutes yet.', letters: 'No approved letters or resolutions yet.', calendar: 'No approved activities coming up.' }[tab];
    el.innerHTML = `<p class="muted" style="margin:0 2px 10px">You receive these from the SAILS Secretary and the President. Read them and mark them received.</p>
      <h3 style="margin:0 2px 8px">New for you</h3>
      ${insp && (insp.open || insp.unread) ? `<button type="button" class="weekrow" id="ip" style="margin-bottom:8px"><div><b>${insp.open ? 'Inspection is open' : 'Inspection ' + esc(insp.latest.kind)}</b><small>${esc(insp.open ? insp.open.note : insp.latest.note)}${insp.unread ? ' · ' + insp.unread + ' new' : ''}</small></div><span class="muted">›</span></button>` : ''}
      <div class="card">${fresh.length ? fresh.slice(0, 6).map(row).join('') : '<p class="caught">You are all caught up. Nothing new.</p>'}</div>
      <button type="button" class="weekrow" id="rp" style="margin-top:10px"><div><b>Weekly report to the SAILS VP Internal</b><small>Write and send it from Report up</small></div><span class="muted">›</span></button>
      <div class="subtabs" role="tablist" style="margin-top:14px">${TABS.map(([id, l]) => `<button type="button" role="tab" aria-selected="${id === tab}" data-t="${id}">${l}${count(id) ? ` <span class="badge">${count(id)}</span>` : ''}</button>`).join('')}</div>
      ${tab === 'calendar'
        ? `<div class="card">${cal.map(c => `<div class="row"><div class="m"><b>${esc(c.title)}</b><small>${day(c.starts_on)}${c.ends_on && c.ends_on !== c.starts_on ? ' – ' + day(c.ends_on) : ''}${c.time_note ? ' · ' + esc(c.time_note) : ''}${c.venue ? ' · ' + esc(c.venue) : ''}</small></div></div>`).join('') || `<p class="empty">${empty}</p>`}</div>`
        : `<div class="card">${list.map(row).join('') || `<p class="empty">${empty}</p>`}</div>`}`;
    el.querySelector('#ip')?.addEventListener('click', () => { location.hash = '#/staff/watch'; });
    el.querySelector('#rp').onclick = () => { location.hash = '#/staff/report'; };
    el.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { tab = b.dataset.t; paint(); });
    el.querySelectorAll('[data-o]').forEach(r => r.onclick = () => open(items.find(i => key(i) === r.dataset.o)));
  }

  function open(i) {
    if (!i) return;
    const done = !isNew(i);
    modal(`<h3>${esc(i.title)}</h3><p class="muted" style="margin:0 0 8px">${esc(i.kind)}${i.sub ? ' · ' + esc(i.sub) : ''}</p>
      <div class="card pad" style="white-space:pre-wrap;max-height:50vh;overflow:auto">${esc(i.body || 'No text.')}</div>
      <div style="display:flex;gap:8px;margin-top:14px">${done ? '' : '<button class="btn gold" style="flex:1" id="rc">Received</button>'}<button type="button" class="btn ghost" style="flex:1" id="cx">Close</button></div><div class="err" id="er"></div>`, (m, close) => {
      m.querySelector('#cx').onclick = close;
      const b = m.querySelector('#rc');
      if (b) b.onclick = async () => {
        try { await db(sb.from('v2_desk_receipts').insert({ src: i.src, src_id: i.id })); got.add(key(i)); toast('Marked received'); close(); paint(); }
        catch (e) { m.querySelector('#er').textContent = e.message; }
      };
    });
  }

  await load();
  watch(['v2_council_meetings', 'v2_office_records', 'v2_coa'], () => { if (document.contains(el) && !document.querySelector('.modal')) load().catch(() => {}); });
}
