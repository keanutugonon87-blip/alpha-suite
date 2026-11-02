import { sb, db, esc, peso, fmtDate, skeleton, printHTML, letterhead, FUNDS, fundLabel } from '../core.js';
import { ymManila, net, signed, balanceAt } from '../money.js';

/* Monthly report pack: one printable page that gathers the month from every office.
   Each section loads on its own, so a section whose database update is not installed yet says so instead of breaking the pack. */
const label = k => new Date(k + '-15T12:00:00+08:00').toLocaleDateString('en-PH', { month: 'long', year: 'numeric', timeZone: 'Asia/Manila' });
const inMonth = (d, k) => !!d && ymManila(d) === k;
const KIND = { minutes: 'Minutes', resolution: 'Resolutions', letter_in: 'Letters received', letter_out: 'Letters sent' };

export async function mountPack(el, ctx) {
  const now = ymManila(new Date());
  const MK = 'alpha-pack-month';
  let k = (() => { try { return localStorage.getItem(MK) || now; } catch { return now; } })();
  const months = (() => { const out = []; const d = new Date(); for (let i = 0; i < 12; i++) { out.push(ymManila(new Date(d.getFullYear(), d.getMonth() - i, 15))); } return out; })();
  if (!months.includes(k)) k = now;
  el.innerHTML = skeleton(5);

  async function sections() {
    const S = [];
    const add = async (title, fn) => { try { const r = await fn(); S.push({ title, ...r }); } catch (e) { S.push({ title, rows: [], note: 'Not available yet: ' + (e && e.message ? e.message : 'the database update is missing') }); } };

    await add('Money', async () => {
      const [entries, periods, closes] = await Promise.all([
        db(sb.from('v2_entries').select('id,kind,amount,occurred_at,status,fund,category,source')),
        db(sb.from('v2_periods').select('opened_at,opening_balance')),
        sb.from('v2_month_close').select('*').then(r => r.data || [], () => []),
      ]);
      const ok = entries.filter(e => e.status === 'approved'), list = ok.filter(e => inMonth(e.occurred_at, k));
      const coll = list.filter(e => e.kind === 'collection'), exp = list.filter(e => e.kind === 'expense');
      const sum = a => a.reduce((s, e) => s + (+e.amount || 0), 0);
      const closing = balanceAt(entries, periods, k), opening = closing - net(list);
      const pend = entries.filter(e => e.status === 'pending' && inMonth(e.occurred_at, k)).length;
      const c = closes.find(x => x.month === k);
      const funds = FUNDS.map(f => { const l = list.filter(e => e.fund === f.k); return [f.label, peso(sum(l.filter(e => e.kind === 'collection'))), peso(sum(l.filter(e => e.kind === 'expense')))]; });
      const un = list.filter(e => !e.fund); if (un.length) funds.push(['Unassigned', peso(sum(un.filter(e => e.kind === 'collection'))), peso(sum(un.filter(e => e.kind === 'expense')))]);
      const cat = {}; exp.forEach(e => { const n = e.category || 'Other'; cat[n] = (cat[n] || 0) + (+e.amount || 0); });
      const top = Object.entries(cat).sort((a, b) => b[1] - a[1]).slice(0, 5);
      return { stats: [['Opening', peso(opening)], ['Collected', peso(sum(coll))], ['Spent', peso(sum(exp))], ['Closing', peso(closing)]],
        table: { head: ['Fund', 'Collected', 'Spent'], rows: funds },
        rows: [`${coll.length} collection${coll.length === 1 ? '' : 's'} and ${exp.length} expense${exp.length === 1 ? '' : 's'} approved.`, pend ? `${pend} entr${pend === 1 ? 'y is' : 'ies are'} still waiting for approval.` : 'No entries waiting for approval.',
          c ? `Month ${c.status === 'closed' ? 'closed' : c.status}${c.closed_by_name ? ' by ' + c.closed_by_name : ''}.` : 'The month is not closed yet.',
          ...(top.length ? ['Biggest spending: ' + top.map(([n, v]) => `${n} ${peso(v)}`).join(', ') + '.'] : [])] };
    });

    await add('Budget requests', async () => {
      const r = (await db(sb.from('v2_budget_requests').select('req_no,title,fund,total,status,created_at,activity_date'))).filter(x => inMonth(x.activity_date || x.created_at, k));
      return { rows: r.length ? [] : ['No budget requests this month.'], table: r.length ? { head: ['No.', 'Request', 'Fund', 'Total', 'Status'], rows: r.map(x => [x.req_no || '—', x.title, fundLabel(x.fund), peso(x.total), x.status]) } : null };
    });

    await add('Discipline', async () => {
      const v = (await db(sb.from('v2_violations').select('status,standard_id,occurred_on'))).filter(x => inMonth(x.occurred_on, k));
      const std = await db(sb.from('v2_standards').select('id,title')).catch(() => []);
      const by = {}; v.forEach(x => by[x.status] = (by[x.status] || 0) + 1);
      const ts = {}; v.forEach(x => { const n = std.find(s => s.id === x.standard_id)?.title || 'Other'; ts[n] = (ts[n] || 0) + 1; });
      const top = Object.entries(ts).sort((a, b) => b[1] - a[1]).slice(0, 5);
      return { stats: [['Reports', v.length], ['Awaiting approval', by.awaiting_approval || 0], ['Open', (by.pending || 0) + (by.resolve_requested || 0) + (by.resolve_forwarded || 0)], ['Resolved', by.resolved || 0]],
        rows: v.length ? ['Most common: ' + top.map(([n, c]) => `${n} (${c})`).join(', ') + '.'] : ['No violation reports this month.'] };
    });

    await add('Attendance and events', async () => {
      const ev = (await db(sb.from('v2_events').select('id,title,event_date,kind,status'))).filter(x => inMonth(x.event_date + 'T12:00:00+08:00', k));
      const scans = ev.length ? await db(sb.from('v2_event_scans').select('event_id,kind').in('event_id', ev.map(x => x.id)).limit(5000)) : [];
      const mem = (await db(sb.from('v2_members').select('id').eq('status', 'active'))).length;
      return { rows: ev.length ? [] : ['No events this month.'], table: ev.length ? { head: ['Date', 'Event', 'Present', 'Of'], rows: ev.sort((a, b) => a.event_date.localeCompare(b.event_date)).map(x => { const n = scans.filter(s => s.event_id === x.id && s.kind === 'in').length; return [fmtDate(x.event_date), x.title, n, mem + ' (' + (mem ? Math.round(n / mem * 100) : 0) + '%)']; }) } : null };
    });

    await add('Meetings and programs', async () => {
      const m = (await db(sb.from('v2_vp_meetings').select('title,kind,held_on,status,outcome'))).filter(x => inMonth(x.held_on + 'T12:00:00+08:00', k) && x.status !== 'cancelled' && x.status !== 'proposed' && x.status !== 'returned');
      return { rows: m.length ? [] : ['No meetings or programs this month.'], table: m.length ? { head: ['Date', 'Title', 'Type', 'Status'], rows: m.sort((a, b) => a.held_on.localeCompare(b.held_on)).map(x => [fmtDate(x.held_on), x.title, x.kind, x.status]) } : null };
    });

    await add('Records', async () => {
      const r = (await db(sb.from('v2_office_records').select('kind,on_date,flow,confidential'))).filter(x => ['minutes', 'resolution', 'letter_in', 'letter_out'].includes(x.kind) && inMonth(x.on_date + 'T12:00:00+08:00', k));
      const cnt = kd => r.filter(x => x.kind === kd).length;
      return { stats: Object.entries(KIND).map(([kd, n]) => [n, cnt(kd)]), rows: [`${r.filter(x => x.flow === 'published').length} posted for members to read, ${r.filter(x => x.confidential).length} confidential.`] };
    });
    return S;
  }

  const html = (S) => `${letterhead('Monthly Report · ' + label(k), 'BSMT 1-Alpha · Batch 28 · PIT-COMED')}<p>Prepared ${fmtDate(new Date().toISOString().slice(0, 10))} from the records in Alpha ’28.</p>` + S.map(s => `<h3>${esc(s.title)}</h3>`
    + (s.stats ? `<div class="sum">${s.stats.map(([a, b]) => `<div>${esc(a)}<b>${esc(String(b))}</b></div>`).join('')}</div>` : '')
    + (s.table ? `<table><tr>${s.table.head.map(h => `<th>${esc(h)}</th>`).join('')}</tr>${s.table.rows.map(r => `<tr>${r.map(c => `<td>${esc(String(c))}</td>`).join('')}</tr>`).join('')}</table>` : '')
    + (s.rows || []).map(x => `<p>${esc(x)}</p>`).join('') + (s.note ? `<p><i>${esc(s.note)}</i></p>` : '')).join('')
    + `<div style="display:flex;gap:30px;margin-top:40px"><div style="flex:1;border-top:1px solid #000;padding-top:4px">Prepared by<br><small>Secretary / Treasurer</small></div><div style="flex:1;border-top:1px solid #000;padding-top:4px">Verified by<br><small>Auditor</small></div><div style="flex:1;border-top:1px solid #000;padding-top:4px">Noted by<br><small>Mayor</small></div></div>`;

  async function draw() {
    el.innerHTML = skeleton(5);
    const S = await sections();
    const page = html(S);
    el.innerHTML = `<div class="bar"><select id="pm" aria-label="Month">${months.map(m => `<option value="${m}"${m === k ? ' selected' : ''}>${label(m)}</option>`).join('')}</select><button class="btn gold" id="pp">Print / save PDF</button></div>
      <p class="muted">One page from every office for the month. Each section comes from the live records, so check it before you print.</p>
      ${S.map(s => `<div class="card"><h3 style="margin:0 0 8px">${esc(s.title)}</h3>${s.stats ? `<div class="grid" style="margin-bottom:8px">${s.stats.map(([a, b]) => `<div class="stat"><small>${esc(a)}</small><b>${esc(String(b))}</b></div>`).join('')}</div>` : ''}
        ${s.table ? `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px"><tr>${s.table.head.map(h => `<th style="text-align:left;padding:4px 6px">${esc(h)}</th>`).join('')}</tr>${s.table.rows.map(r => `<tr>${r.map(c => `<td style="padding:4px 6px;border-top:1px solid var(--line,#ddd)">${esc(String(c))}</td>`).join('')}</tr>`).join('')}</table></div>` : ''}
        ${(s.rows || []).map(x => `<p class="muted" style="margin:6px 0">${esc(x)}</p>`).join('')}${s.note ? `<p class="muted"><i>${esc(s.note)}</i></p>` : ''}</div>`).join('')}`;
    el.querySelector('#pm').onchange = e => { k = e.target.value; try { localStorage.setItem(MK, k); } catch { /* ignore */ } draw(); };
    el.querySelector('#pp').onclick = () => printHTML('Monthly report ' + label(k), page);
  }
  await draw();
}
