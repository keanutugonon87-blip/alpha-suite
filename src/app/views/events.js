import { sb, db, esc, fmtDate, toast, modal, uuid, todayISO, safeWrite, confirmDialog } from '../core.js';
import { scanLoop } from '../qr.js';

/* Events and attendance.
   The Mayor or Vice Mayor (the President) sets an event: flag ceremony, inspection, or any event with log in and log out.
   The Marshals, Secretary and SAILS officers scan the students' QR cards; every scan is confirmed before it counts.
   When the event is over, the President reviews who never scanned and records them as absences (excused ones are unticked). */
const KINDS = { flag: 'Flag ceremony', inspection: 'Inspection', event: 'Event (log in / log out)' };
const needV21 = e => /relation|schema cache|does not exist/i.test(e.message || '') ? 'Run the v21 SQL in Supabase first (supabase/v21_events_attendance.sql).' : e.message;
const defStd = (k, stds) => (stds.find(s => (k === 'flag' ? /flag/i : k === 'inspection' ? /inspection/i : /log\s*in|event log/i).test(s.title)) || stds.find(s => !s.kind) || {}).id || '';

export async function mountEvents(host, ctx, members, standards, redraw) {
  const manage = ctx.can('mayor', 'vice_mayor'), canScan = ctx.can('mayor', 'vice_mayor', 'secretary', 'marshall', 'sails');
  const act = members.filter(x => x.status === 'active');
  let events, scans;
  try {
    [events, scans] = await Promise.all([
      db(sb.from('v2_events').select('*').order('event_date', { ascending: false }).order('created_at', { ascending: false })),
      db(sb.from('v2_event_scans').select('event_id,member_id,kind')),
    ]);
  } catch (e) { host.innerHTML = `<div class="card pad"><p class="empty">${esc(needV21(e))}</p></div>`; return; }
  const cnt = id => { const o = { in: new Set(), out: new Set() }; scans.filter(s => s.event_id === id).forEach(s => o[s.kind].add(s.member_id)); return o; };
  const stdTitle = id => standards.find(s => s.id === id)?.title || '';
  const card = ev => { const c = cnt(ev.id), open = ev.status === 'open';
    return `<div class="row stk vw"><div class="m"><b>${esc(ev.title)} <span class="tag ${open ? 'ok' : ''}">${open ? 'Open' : ev.finalized_at ? 'Absences recorded' : 'Closed'}</span></b>
      <small>${KINDS[ev.kind] || ev.kind} · ${fmtDate(ev.event_date)}${ev.created_by_name ? ` · set by ${esc(ev.created_by_name)}` : ''}<br>In ${c.in.size} of ${act.length}${ev.needs_out ? ` · Out ${c.out.size} of ${act.length}` : ''}</small></div>
      <div class="acts">${open && canScan ? `<button class="btn gold sm" data-sc="${ev.id}">📷 Scan attendance</button>` : ''}
      ${manage && !ev.finalized_at ? `<button class="btn ghost sm" data-rv="${ev.id}">Review absences</button>` : ''}
      ${manage ? `<button class="btn ghost sm" data-cl="${ev.id}">${open ? 'Close' : 'Reopen'}</button><button class="btn ghost sm" data-dl="${ev.id}">Delete</button>` : ''}</div></div>`; };
  host.innerHTML = `${manage ? '<div class="bar"><button class="btn gold" id="ne">+ New event</button></div>' : '<p class="swipe-hint">The Mayor or Vice Mayor sets the event. Open one below to scan attendance.</p>'}
    <div class="card">${events.map(card).join('') || '<p class="empty">No events yet.</p>'}</div>`;
  const ev = id => events.find(e => e.id === id);
  host.querySelector('#ne')?.addEventListener('click', () => newEvent());
  host.querySelectorAll('[data-sc]').forEach(b => b.onclick = () => scanEvent(ev(b.dataset.sc)));
  host.querySelectorAll('[data-rv]').forEach(b => b.onclick = () => review(ev(b.dataset.rv)));
  host.querySelectorAll('[data-cl]').forEach(b => b.onclick = async () => { const e = ev(b.dataset.cl);
    try { await db(sb.from('v2_events').update(e.status === 'open' ? { status: 'closed' } : { status: 'open', closed_at: null, finalized_at: null }).eq('id', e.id)); redraw(); } catch (x) { toast(needV21(x), true); } });
  host.querySelectorAll('[data-dl]').forEach(b => b.onclick = async () => { const e = ev(b.dataset.dl);
    if (!(await confirmDialog(`Delete “${e.title}” and its scans? Absences already recorded stay in the ledger.`))) return;
    try { await db(sb.from('v2_events').delete().eq('id', e.id)); toast('Deleted'); redraw(); } catch (x) { toast(needV21(x), true); } });

  function newEvent() {
    modal(`<h3>New event</h3><form id="nf">
      <label>Type</label><select name="k">${Object.entries(KINDS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
      <label>Name</label><input name="t" maxlength="80" required value="Flag ceremony">
      <label>Date</label><input name="d" type="date" value="${todayISO()}" required>
      <label class="ck" id="oc" hidden><input type="checkbox" name="o" checked><span>Students also log out</span></label>
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">Create and open</button><button type="button" class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div></form>`, (m, close) => {
      const f = m.querySelector('#nf'), k = f.elements.k, t = f.elements.t; let touched = false;
      t.oninput = () => { touched = true; };
      const sync = () => { m.querySelector('#oc').hidden = k.value !== 'event'; if (!touched) t.value = k.value === 'event' ? '' : KINDS[k.value]; };
      k.onchange = sync; sync(); m.querySelector('#cx').onclick = close;
      f.onsubmit = async e => { e.preventDefault(); const x = f.elements;
        try { await db(sb.from('v2_events').insert({ id: uuid(), title: x.t.value.trim(), kind: x.k.value, event_date: x.d.value, needs_out: x.k.value === 'event' && x.o.checked, standard_id: defStd(x.k.value, standards) || null }));
          toast('Event is open. Officers can scan now.'); close(); redraw(); } catch (er) { m.querySelector('#er').textContent = needV21(er); } };
    });
  }

  /* President: who never scanned? Record them as absences. */
  function review(e) {
    const c = cnt(e.id), need = x => !c.in.has(x.id) || (e.needs_out && !c.out.has(x.id));
    const why = x => !c.in.has(x.id) && e.needs_out && !c.out.has(x.id) ? 'No log in, no log out' : !c.in.has(x.id) ? (e.needs_out ? 'No log in' : 'Not scanned') : 'No log out';
    const pool = act.filter(need), cur = e.standard_id || defStd(e.kind, standards);
    const opts = standards;
    modal(`<h3>Review absences</h3><p class="muted" style="margin:0 0 8px">${esc(e.title)} · ${fmtDate(e.event_date)}${e.status === 'open' ? '<br><b>Still open.</b> Submitting closes the event.' : ''}</p>
      <label>Record absences under</label><select id="as">${opts.map(s => `<option value="${s.id}"${s.id === cur ? ' selected' : ''}>${esc(s.title)}${s.fine ? ` (₱${s.fine} fine)` : ''}</option>`).join('')}</select>
      <p class="muted" style="margin:8px 0">${pool.length} to record. Untick anyone who was excused.</p>
      <div class="rvl">${pool.map(x => `<label class="ck"><input type="checkbox" data-a="${x.id}" checked><span>${esc(x.full_name)}<small>${why(x)}</small></span></label>`).join('') || '<p class="muted">Everyone is accounted for.</p>'}</div>
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" id="go" style="flex:2">${pool.length ? 'Record absences and close' : 'Close event'}</button><button class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div>`, (m, close) => {
      m.querySelector('#cx').onclick = close;
      m.querySelector('#go').onclick = async () => { const sid = m.querySelector('#as').value, ids = [...m.querySelectorAll('[data-a]:checked')].map(x => x.dataset.a); let done = 0; m.querySelector('#go').disabled = true;
        if (ids.length && !sid) { m.querySelector('#er').textContent = 'Choose what to record these under.'; m.querySelector('#go').disabled = false; return; }
        try { for (const id of ids) { await safeWrite('v2_violations', { id: uuid(), member_id: id, standard_id: sid, occurred_on: e.event_date, reported_by: `${ctx.profile.role} ${ctx.profile.full_name} · ${e.title}`, status: 'pending' }); done++; }
          await db(sb.from('v2_events').update({ status: 'closed', finalized_at: new Date().toISOString() }).eq('id', e.id));
          toast(`${done} absence${done === 1 ? '' : 's'} recorded`); close(); redraw(); }
        catch (x) { m.querySelector('#er').textContent = `${done} saved before the error: ${x.message}`; m.querySelector('#go').disabled = false; } };
    });
  }

  /* Officers: scan, then confirm. */
  function scanEvent(e) {
    const mine = cnt(e.id), byId = Object.fromEntries(act.map(x => [x.id, x]));
    let dir = 'in', confirmEach = true, stage = 'scan', pending = null, busy = false, last = '', lastAt = 0, lastOk = false; const hist = [];
    const tm = () => new Date().toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' });
    const mo = modal(`<div class="scn full">
      <div class="scn-h"><b>${esc(e.title)}</b><span class="steps" id="stp"></span><button type="button" class="x" id="sx" aria-label="Close">✕</button></div>
      <div class="sb idle" id="sb" role="status" aria-live="polite">Starting camera…</div>
      <div id="g1">
        ${e.needs_out ? '<div class="seg" id="ph"><button data-ph="in" class="on">Log in</button><button data-ph="out">Log out</button></div>' : ''}
        <div class="vid" id="vd"><video id="sv" playsinline muted></video><button type="button" class="torch" id="tc" hidden aria-label="Flashlight">🔦</button><span class="pill" id="cn"></span></div>
        <label class="ck" style="margin:6px 0"><input type="checkbox" id="cf" checked><span>Confirm each scan</span></label>
        <div class="scn-b"><button type="button" class="btn ghost big" id="un" hidden>↩ Undo last</button><button type="button" class="btn ghost big" id="pkb">Can’t scan? Pick</button><button type="button" class="btn gold big" id="dn">Done</button></div>
        <div id="pkw" hidden></div></div>
      <div id="g2" hidden></div></div>`, (el, close) => {
      el.classList.add('scnm');
      const $ = q => el.querySelector(q);
      let ac = null;
      const beep = ok => { try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = ok ? 880 : 300; g.gain.value = 0.15; o.connect(g); g.connect(ac.destination); o.start(); o.stop(ac.currentTime + (ok ? 0.12 : 0.28)); } catch { /* no sound */ } };
      const say = (txt, kind = 'idle') => { const b = $('#sb'); b.className = 'sb ' + kind; b.textContent = txt;
        if (kind !== 'idle') { const v = $('#vd'); v.classList.remove('flash', 'ok', 'warn', 'bad'); void v.offsetWidth; v.classList.add('flash', kind); beep(kind === 'ok'); try { navigator.vibrate && navigator.vibrate(kind === 'ok' ? 60 : [80, 60, 80]); } catch { /* ignore */ } } };
      const showSteps = () => { $('#stp').innerHTML = [['scan', 'Scan'], ['conf', 'Confirm']].map(([k, l], i) => { const at = stage === 'scan' ? 0 : 1; return `<span class="${i === at ? 'on' : i < at ? 'done' : ''}"><i>${i < at ? '✓' : i + 1}</i>${l}</span>`; }).join(''); };
      const go = st => { stage = st; $('#g1').hidden = st !== 'scan'; $('#g2').hidden = st === 'scan'; showSteps(); if (st === 'scan') scanPane(); else confPane(); };
      const label = () => dir === 'in' ? 'log in' : 'log out';
      function scanPane() { $('#cn').textContent = `In ${mine.in.size} of ${act.length}${e.needs_out ? ` · Out ${mine.out.size}` : ''}`; $('#un').hidden = !hist.length; }
      /* write one scan; the database refuses a second scan of the same student in the same direction */
      async function record(mem, d) {
        const id = uuid();
        try { await db(sb.from('v2_event_scans').insert({ id, event_id: e.id, member_id: mem.id, kind: d })); }
        catch (x) { if (/duplicate|unique/i.test(x.message)) { mine[d].add(mem.id); say(`${mem.name} already ${d === 'in' ? 'logged in' : 'logged out'}.`, 'warn'); } else say(/closed/i.test(x.message) ? 'This event was closed by the President.' : needV21(x), 'bad'); return false; }
        mine[d].add(mem.id); hist.unshift({ label: `${d} ${mem.name}`, undo: async () => { await db(sb.from('v2_event_scans').delete().eq('id', id)); mine[d].delete(mem.id); } });
        say(`✓ ${d === 'in' ? 'Logged in' : 'Logged out'}: ${mem.name} · ${tm()}`, 'ok'); return true;
      }
      function confPane() {
        const g = $('#g2'), noIn = dir === 'out' && !mine.in.has(pending.id);
        g.innerHTML = `<div class="stg"><p class="who">${esc(pending.name)}</p><p class="muted">${e.needs_out ? `Confirm ${label()} for` : 'Confirm attendance for'} ${esc(e.title)}.</p>
          ${noIn ? '<p class="sb warn" style="margin:8px 0">No log in yet for this student.</p>' : ''}</div>
          <div class="scn-b stick"><button class="btn ghost big" id="bk">‹ Cancel</button><button class="btn gold big" id="ok" style="flex:2">✓ Confirm ${e.needs_out ? label() : 'present'}</button></div>`;
        $('#bk').onclick = () => { pending = null; say('Cancelled. Scan the next card.'); go('scan'); };
        $('#ok').onclick = async () => { $('#ok').disabled = true; const p = pending; pending = null; await record(p, dir); go('scan'); };
      }
      function got(s0) {
        if (!byId[s0.id]) return void say('That student is not on the active list.', 'bad');
        if (stage !== 'scan') return void say(`Finish ${pending ? pending.name : 'this step'} first.`, 'warn');
        if (mine[dir].has(s0.id)) return void say(`${s0.name} already ${dir === 'in' ? 'logged in' : 'logged out'}.`, 'warn');
        const p = { id: s0.id, name: s0.name };
        if (!confirmEach) { record(p, dir).then(scanPane); return true; }
        pending = p; say(`✓ Scanned: ${s0.name}. Confirm to record.`, 'ok'); go('conf'); return true;
      }
      function pickList() {
        const w = $('#pkw'); w.hidden = !w.hidden; if (w.hidden) return;
        w.innerHTML = `<select id="pk"><option value="">Choose a student…</option>${act.filter(x => !mine[dir].has(x.id)).map(x => `<option value="${x.id}">${esc(x.full_name)}</option>`).join('')}</select>`;
        w.querySelector('#pk').onchange = ev2 => { const mem = byId[ev2.target.value]; w.hidden = true; if (mem) got({ id: mem.id, name: mem.full_name }); };
      }
      const onRaw = async raw => {
        const now = Date.now(); if (busy || (raw === last && now - lastAt < (lastOk ? 3000 : 1200))) return; busy = true; last = raw; lastAt = now; lastOk = false;
        try { const s0 = await db(sb.rpc('v2_resolve_token', { p_token: raw })); lastOk = !!got(s0); } catch (x) { say(x.message, 'bad'); }
        busy = false;
      };
      el.addEventListener('scan', ev2 => onRaw(ev2.detail));       // lets a test or a hardware scanner feed codes without the camera
      el.querySelectorAll('[data-ph]').forEach(b => b.onclick = () => { dir = b.dataset.ph; el.querySelectorAll('[data-ph]').forEach(x => x.classList.toggle('on', x === b)); say(`${label()[0].toUpperCase() + label().slice(1)}: scan students.`); scanPane(); });
      $('#cf').onchange = ev2 => { confirmEach = ev2.target.checked; say(confirmEach ? 'Each scan will ask for confirmation.' : 'Scans are recorded straight away.'); };
      $('#un').onclick = async () => { const h = hist.shift(); if (!h) return; try { await h.undo(); say('Undone: ' + h.label, 'warn'); } catch (x) { toast(x.message, true); hist.unshift(h); } scanPane(); };
      $('#pkb').onclick = pickList; $('#sx').onclick = $('#dn').onclick = () => { close(); redraw(); }; say(`${e.title}: scan a student’s card.`); go('scan');
      scanLoop(el, $('#sv'), onRaw, stream => { const tr = stream.getVideoTracks()[0]; if (tr?.getCapabilities?.().torch) { const b = $('#tc'); b.hidden = false; let on = false; b.onclick = () => { on = !on; tr.applyConstraints({ advanced: [{ torch: on }] }).catch(() => {}); b.classList.toggle('on', on); }; } })
        .then(() => {}, er => say('Camera unavailable (' + (er.message || er) + '). Use “Can’t scan? Pick”.', 'bad'));
      $('#sv').addEventListener('playing', () => say('Camera ready. Point at a student’s QR card.'));
    });
    return mo;
  }
}
