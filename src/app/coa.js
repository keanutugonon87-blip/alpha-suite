import { esc } from './core.js';
import { getLang } from './i18n.js';

/* Calendar of Activities: a month grid, the chosen day's activities, and what is coming up. Used on the student screen. */
const CAT = { activity: ['Activity', 'Kalihokan'], program: ['Program', 'Programa'], meeting: ['Meeting', 'Miting'], deadline: ['Deadline', 'Deadline'], holiday: ['Holiday', 'Pangilin'] };
const L = (en, ceb) => getLang() === 'ceb' ? ceb : en;
export const catLabel = c => (CAT[c] || CAT.activity)[getLang() === 'ceb' ? 1 : 0];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = n => String(n).padStart(2, '0');
export const todayYMD = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
const endOf = i => i.ends_on || i.starts_on;
const on = (items, d) => items.filter(i => i.starts_on <= d && d <= endOf(i));
const nice = d => { const [y, m, dd] = d.split('-').map(Number); return `${MONTHS[m - 1].slice(0, 3)} ${dd}, ${y}`; };
const span = i => i.ends_on && i.ends_on !== i.starts_on ? `${nice(i.starts_on)} – ${nice(i.ends_on)}` : nice(i.starts_on);

export function newCalState() { const t = todayYMD(); return { month: t.slice(0, 7), sel: t }; }

function card(i) {
  const gone = i.status === 'cancelled';
  return `<div class="cal-item cat-${esc(i.category)}${gone ? ' gone' : ''}"><div class="cal-item-h"><b>${esc(i.title)}</b><span class="tag ${gone ? 'bad' : 'ok'}">${gone ? L('Cancelled', 'Gikansel') : esc(catLabel(i.category))}</span></div>
    <small>${esc(span(i))}${i.time_note ? ' · ' + esc(i.time_note) : ''}${i.venue ? ' · ' + esc(i.venue) : ''}</small>${i.details ? `<p>${esc(i.details)}</p>` : ''}</div>`;
}

export function calendarHTML(items, st) {
  const [y, m] = st.month.split('-').map(Number), today = todayYMD();
  const first = new Date(Date.UTC(y, m - 1, 1)), lead = first.getUTCDay(), days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const wk = [L('Sun', 'Dom'), L('Mon', 'Lun'), L('Tue', 'Mar'), L('Wed', 'Mye'), L('Thu', 'Huw'), L('Fri', 'Biy'), L('Sat', 'Sab')];
  let cells = '';
  for (let i = 0; i < lead; i++) cells += '<span class="cal-c off"></span>';
  for (let d = 1; d <= days; d++) {
    const ymd = `${y}-${pad(m)}-${pad(d)}`, its = on(items, ymd);
    cells += `<button type="button" class="cal-c${ymd === today ? ' today' : ''}${ymd === st.sel ? ' sel' : ''}" data-cd="${ymd}" aria-label="${esc(nice(ymd))}${its.length ? ', ' + its.length : ''}"><span>${d}</span><i>${its.slice(0, 3).map(x => `<b class="dot cat-${esc(x.category)}${x.status === 'cancelled' ? ' gone' : ''}"></b>`).join('')}</i></button>`;
  }
  const dayItems = on(items, st.sel);
  const upcoming = items.filter(i => i.status === 'approved' && endOf(i) >= today && !(i.starts_on <= st.sel && st.sel <= endOf(i))).slice(0, 8);
  return `<div class="cal">
    <div class="cal-h"><button type="button" class="btn ghost sm" data-cm="-1" aria-label="${L('Previous month', 'Miaging bulan')}">‹</button><b>${MONTHS[m - 1]} ${y}</b><button type="button" class="btn ghost sm" data-cm="1" aria-label="${L('Next month', 'Sunod nga bulan')}">›</button><button type="button" class="btn ghost sm" data-cm="0">${L('Today', 'Karon')}</button></div>
    <div class="cal-w">${wk.map(w => `<span>${w}</span>`).join('')}</div><div class="cal-g">${cells}</div>
    <p class="muted" style="margin:12px 2px 6px"><b>${esc(nice(st.sel))}</b></p>
    ${dayItems.length ? dayItems.map(card).join('') : `<p class="empty">${L('Nothing planned this day.', 'Wala’y plano karong adlawa.')}</p>`}
    ${upcoming.length ? `<p class="muted" style="margin:14px 2px 6px"><b>${L('Coming up', 'Umaabot')}</b></p>${upcoming.map(card).join('')}` : ''}
    <p class="muted" style="margin:12px 2px 0;font-size:.82rem">${L('Approved by the SAILS President. This page updates by itself.', 'Gi-aprobahan sa SAILS President. Kini nga panid mo-update sa kaugalingon.')}</p></div>`;
}

export function wireCalendar(root, st, repaint) {
  root.querySelectorAll('[data-cm]').forEach(b => b.onclick = () => {
    const k = +b.dataset.cm, [y, m] = st.month.split('-').map(Number);
    if (k === 0) { const t = todayYMD(); st.month = t.slice(0, 7); st.sel = t; }
    else { const d = new Date(Date.UTC(y, m - 1 + k, 1)); st.month = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`; }
    repaint();
  });
  root.querySelectorAll('[data-cd]').forEach(b => b.onclick = () => { st.sel = b.dataset.cd; repaint(); });
}
