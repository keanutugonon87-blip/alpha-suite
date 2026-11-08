import { sb, db, watch, esc, toast, modal, skeleton, fmtDate, todayISO, ROLE_LABEL, confirmDialog } from '../core.js';

/* The SAILS council hub: plan a meeting with an agenda, take attendance, record the minutes, and turn each decision into a directive in one step. */
const ST = { planned: ['Planned', 'warn'], held: ['Held, minutes not closed', 'bad'], closed: ['Closed', 'ok'] };

export async function mountCouncil(el, ctx) {
  let ms = [], att = [], acts = [], owners = [], open = null, setup = false;
  const mayRun = ctx.mode === 'pres' || ctx.mode === 'acting';
  el.innerHTML = skeleton(3);
  const Q = (t, f) => (f ? f(sb.from(t).select('*')) : sb.from(t).select('*')).then(r => r.error ? (setup = true, []) : r.data || [], () => []);
  async function load() {
    [ms, att, acts] = await Promise.all([Q('v2_council_meetings', q => q.order('held_on', { ascending: false }).limit(40)), Q('v2_council_attendance'), Q('v2_council_actions', q => q.order('created_at'))]);
    if (mayRun && !owners.length) owners = await sb.from('v2_profiles').select('user_id,full_name,role').in('role', ['vp_internal', 'vp_external', 'general_marshal']).order('full_name').then(r => r.data || [], () => []);
    draw();
  }
  const day = d => fmtDate(d + 'T00:00:00+08:00');
  function draw() {
    if (setup) { el.innerHTML = '<div class="card"><p class="empty">Run the v50 SQL in Supabase to turn this on.</p></div>'; return; }
    if (open) return detail(ms.find(m => m.id === open));
    el.innerHTML = `<div class="bar"><span class="muted">Plan the meeting, take attendance, close the minutes. Each decision can become a directive.</span><span class="grow"></span>${mayRun ? '<button class="btn gold" id="nm">+ New meeting</button>' : ''}</div>
      ${ms.length ? `<div class="card">${ms.map(m => { const p = att.filter(a => a.meeting_id === m.id), pr = p.filter(a => a.present).length; return `<button type="button" class="row" data-m="${m.id}" style="display:block;width:100%;text-align:left;background:none;border:0;border-bottom:1px solid var(--line,#e3e8ee);cursor:pointer"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px"><div class="m"><b>${esc(m.title)}</b><small>${day(m.held_on)}${m.held_at ? ' · ' + esc(m.held_at) : ''}${m.venue ? ' · ' + esc(m.venue) : ''}${m.status !== 'planned' ? ' · ' + pr + '/' + p.length + ' present' : ''} · ${acts.filter(a => a.meeting_id === m.id).length} decision${acts.filter(a => a.meeting_id === m.id).length === 1 ? '' : 's'}</small></div><span class="tag ${ST[m.status][1]}">${ST[m.status][0]}</span></div></button>`; }).join('')}</div>` : '<p class="empty">No meetings yet.</p>'}`;
    el.querySelector('#nm')?.addEventListener('click', () => form(null));
    el.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { open = b.dataset.m; draw(); });
  }
  function form(m) {
    modal(`<h3>${m ? 'Edit meeting' : 'New council meeting'}</h3><form id="f"><label>Title</label><input name="t" required minlength="3" maxlength="140" value="${esc(m?.title || 'SAILS Council meeting')}">
      <label>Date</label><input name="d" type="date" required value="${m?.held_on || todayISO()}"><label>Time</label><input name="h" maxlength="30" placeholder="e.g. 3:00 PM" value="${esc(m?.held_at || '')}">
      <label>Venue</label><input name="v" maxlength="80" value="${esc(m?.venue || '')}"><label>Agenda (one item per line)</label><textarea name="a" rows="5" maxlength="3000">${esc(m?.agenda || '')}</textarea>
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">Save</button><button type="button" class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div></form>`, (mm, close) => {
      mm.querySelector('#cx').onclick = close;
      mm.querySelector('#f').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target);
        try { const id = await db(sb.rpc('v2_council_save', { p_id: m?.id || null, p_title: f.get('t'), p_held_on: f.get('d'), p_held_at: f.get('h'), p_venue: f.get('v'), p_agenda: f.get('a') })); toast('Saved'); close(); if (!m) open = id; await load(); }
        catch (x) { mm.querySelector('#er').textContent = x.message; } };
    });
  }
  function detail(m) {
    if (!m) { open = null; return draw(); }
    const p = att.filter(a => a.meeting_id === m.id).sort((a, b) => (a.person_name || '').localeCompare(b.person_name || '')), as = acts.filter(a => a.meeting_id === m.id), closed = m.status === 'closed';
    el.innerHTML = `<div class="bar"><button class="btn ghost sm" id="bk">‹ All meetings</button><span class="grow"></span><span class="tag ${ST[m.status][1]}">${ST[m.status][0]}</span></div>
      <div class="card" style="margin-bottom:12px"><h3 style="margin:0 0 4px">${esc(m.title)}</h3><small class="muted">${day(m.held_on)}${m.held_at ? ' · ' + esc(m.held_at) : ''}${m.venue ? ' · ' + esc(m.venue) : ''}</small>
        ${m.agenda ? `<ol style="margin:10px 0 0;padding-left:20px">${m.agenda.split('\n').filter(x => x.trim()).map(x => `<li>${esc(x)}</li>`).join('')}</ol>` : '<p class="muted" style="margin:8px 0 0">No agenda written.</p>'}
        ${mayRun && !closed ? '<div class="acts" style="margin-top:10px"><button class="btn ghost sm" id="ed">Edit</button>' + (m.status === 'planned' ? '<button class="btn ghost sm" id="rm">Remove</button>' : '') + '</div>' : ''}</div>
      <h4 style="margin:0 2px 6px">Attendance</h4><div class="card" style="margin-bottom:12px">${p.map(a => `<label class="row" style="cursor:${mayRun && !closed ? 'pointer' : 'default'}"><div class="m"><b>${esc(a.person_name)}</b><small>${esc(ROLE_LABEL[a.role] || a.role)}</small></div><input type="checkbox" data-p="${a.person_id}" ${a.present ? 'checked' : ''} ${mayRun && !closed ? '' : 'disabled'} style="width:auto"></label>`).join('') || '<p class="empty">No one to list yet.</p>'}
        ${mayRun && !closed ? '<div class="acts" style="margin-top:8px"><button class="btn gold sm" id="sa">Save attendance</button></div>' : ''}</div>
      <h4 style="margin:0 2px 6px">Decisions and who carries them out</h4><div class="card" style="margin-bottom:12px">${as.map(a => `<div class="row"><div class="m"><b>${esc(a.title)}</b><small>${esc(a.owner_name || '')}${a.due_on ? ' · due ' + day(a.due_on) : ''} · sent as a directive</small></div><span class="tag ok">Assigned</span></div>`).join('') || '<p class="empty">None yet.</p>'}
        ${mayRun ? '<div class="acts" style="margin-top:8px"><button class="btn gold sm" id="na">+ Decision</button></div>' : ''}</div>
      <h4 style="margin:0 2px 6px">Minutes</h4><div class="card">${closed ? `<p style="white-space:pre-wrap;margin:0">${esc(m.minutes)}</p>` : mayRun ? '<textarea id="mn" rows="6" maxlength="8000" placeholder="What was discussed and decided"></textarea><div class="acts" style="margin-top:8px"><button class="btn gold sm" id="cm">Close the meeting</button></div>' : '<p class="empty">Minutes are not closed yet.</p>'}</div>`;
    el.querySelector('#bk').onclick = () => { open = null; draw(); };
    el.querySelector('#ed')?.addEventListener('click', () => form(m));
    el.querySelector('#rm')?.addEventListener('click', async () => { if (!await confirmDialog('The meeting is removed.', { ok: 'Remove', danger: true, title: 'Remove this meeting?' })) return; try { await db(sb.rpc('v2_council_delete', { p_id: m.id })); open = null; toast('Removed'); load(); } catch (e) { toast(e.message, true); } });
    el.querySelector('#sa')?.addEventListener('click', async () => { try { await db(sb.rpc('v2_council_attend', { p_meeting: m.id, p_present: [...el.querySelectorAll('[data-p]:checked')].map(c => c.dataset.p) })); toast('Attendance saved'); load(); } catch (e) { toast(e.message, true); } });
    el.querySelector('#cm')?.addEventListener('click', async () => { try { await db(sb.rpc('v2_council_close', { p_id: m.id, p_minutes: el.querySelector('#mn').value })); toast('Meeting closed'); load(); } catch (e) { toast(e.message, true); } });
    el.querySelector('#na')?.addEventListener('click', () => modal(`<h3>Decision to carry out</h3><form id="f"><label>What was decided</label><input name="t" required minlength="3" maxlength="140">
      <label>Who carries it out</label><select name="o" required>${owners.map(o => `<option value="${o.user_id}">${esc(o.full_name)} · ${esc(ROLE_LABEL[o.role])}</option>`).join('')}</select><label>Due (optional)</label><input name="d" type="date" min="${todayISO()}"><label>Details (optional)</label><textarea name="x" rows="3" maxlength="800"></textarea>
      <p class="muted" style="font-size:.85rem;margin:8px 0 0">It is sent to them now as a directive. A Class Mayor is reached through the SAILS VP Internal.</p>
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">Send directive</button><button type="button" class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div></form>`, (mm, close) => {
      mm.querySelector('#cx').onclick = close;
      mm.querySelector('#f').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target);
        try { await db(sb.rpc('v2_council_action', { p_meeting: m.id, p_title: f.get('t'), p_owner: f.get('o'), p_due: f.get('d') || null, p_details: f.get('x') })); toast('Directive sent'); close(); load(); } catch (x) { mm.querySelector('#er').textContent = x.message; } };
    }));
  }
  await load();
  return watch(['v2_council_meetings', 'v2_council_attendance', 'v2_council_actions'], () => load().catch(() => {}));
}
