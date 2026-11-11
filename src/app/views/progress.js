import { esc, fmtDate } from '../core.js';

/* Nameplate and Siglakas shirt progress reports: the Class Mayor sends them to the SAILS VP Internal.
   Shared by the Class Mayor's SAILS Report tab and the VP Internal's class screen. Run supabase/v61_class_treasurer_progress.sql once. */
export const ITEMS = { nameplate: 'Nameplate', siglakas: 'Siglakas shirt' };
export const STAGES = [['names', 'Collecting names and sizes'], ['payments', 'Collecting payments'], ['ordered', 'Order placed'], ['production', 'In production'], ['ready', 'Ready for pickup'], ['distributed', 'Distributed']];
export const isProgress = a => a.kind === 'nameplate' || a.kind === 'siglakas';
export const KIND = { funds: 'Class funds', activity: 'Activity', other: 'Other', ...ITEMS };
const peso = n => '₱' + Number(n).toLocaleString('en-PH');

export function progressBlock(a) {
  const at = STAGES.findIndex(s => s[0] === a.stage), pct = a.qty_total ? Math.min(100, Math.round((a.qty_paid || 0) / a.qty_total * 100)) : null;
  const money = a.target ? Math.min(100, Math.round((Number(a.amount) || 0) / Number(a.target) * 100)) : null;
  return `<div style="margin:8px 0 0">
    <div style="display:flex;gap:3px" aria-label="Stage ${at + 1} of ${STAGES.length}: ${esc(STAGES[at]?.[1] || '')}">${STAGES.map((s, i) => `<i style="flex:1;height:5px;border-radius:3px;background:${i <= at ? 'var(--gold, #d4a017)' : 'var(--line, #ddd)'}"></i>`).join('')}</div>
    <small class="muted" style="display:block;margin-top:4px">Stage ${at + 1} of ${STAGES.length}: ${esc(STAGES[at]?.[1] || '')}</small>
    ${pct !== null ? `<small style="display:block;margin-top:6px"><b>${a.qty_paid || 0}</b> of <b>${a.qty_total}</b> paid (${pct}%)${a.qty_total - (a.qty_paid || 0) > 0 ? ` · ${a.qty_total - (a.qty_paid || 0)} still to pay` : ' · everyone has paid'}</small>` : ''}
    ${a.amount != null ? `<small style="display:block;margin-top:2px">Collected <b>${peso(a.amount)}</b>${a.target ? ` of ${peso(a.target)} (${money}%)` : ''}</small>` : ''}
    ${a.eta ? `<small style="display:block;margin-top:2px">Expected ${fmtDate(a.eta + 'T00:00:00+08:00')}</small>` : ''}</div>`;
}
