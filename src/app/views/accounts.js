import { sb, db, watch, esc, toast, ROLE_LABEL, ROLES, fmtDateTime, confirmDialog } from '../core.js';
export async function mountAccounts(el, ctx) {
  const isMayor = ctx.can('mayor');
  let tab = 'people';
  async function draw() {
    const people = await db(sb.from('v2_profiles').select('*').order('created_at'));
    const audit = ctx.can('mayor','auditor','vice_mayor') ? await db(sb.from('v2_audit').select('at,actor_name,action,table_name,row_id').order('at',{ascending:false}).limit(80)) : [];
    const pend = people.filter(p => p.role === 'pending');
    el.innerHTML = `<div class="bar"><button class="btn ${tab==='people'?'':'ghost'}" data-k="people">Accounts${pend.length?` (${pend.length} pending)`:''}</button>
      ${audit.length||ctx.can('auditor')?`<button class="btn ${tab==='audit'?'':'ghost'}" data-k="audit">Audit log</button>`:''}</div>
      ${tab==='people' ? `<div class="card">${people.map(p => `<div class="row"><div class="m"><b>${esc(p.full_name)}</b><small>${esc(p.email)}</small></div>
        <div style="display:flex;gap:6px;align-items:center">${isMayor && p.user_id!==ctx.profile.user_id
          ? `<select data-u="${p.user_id}" style="width:auto"><option value="pending"${p.role==='pending'?' selected':''}>Pending</option>${ROLES.map(r=>`<option value="${r}"${p.role===r?' selected':''}>${ROLE_LABEL[r]}</option>`).join('')}</select>
             <button class="btn danger sm" data-del="${p.user_id}">Remove</button>`
          : `<span class="tag ${p.role==='pending'?'warn':'ok'}">${ROLE_LABEL[p.role]}</span>`}</div></div>`).join('')}</div>`
      : `<div class="card">${audit.map(a => `<div class="row"><div class="m"><b>${esc(a.action)} · ${esc(a.table_name.replace('v2_',''))}</b><small>${esc(a.actor_name||'system')} · ${fmtDateTime(a.at)}</small></div></div>`).join('') || '<p class="empty">Nothing logged yet.</p>'}</div>`}`;
    el.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { tab = b.dataset.k; draw(); });
    el.querySelectorAll('select[data-u]').forEach(s => s.onchange = async () => {
      try { await db(sb.from('v2_profiles').update({ role: s.value, updated_at: new Date().toISOString() }).eq('user_id', s.dataset.u)); toast('Role updated'); } catch (e) { toast(e.message, true); draw(); } });
    el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      if (!await confirmDialog('They will need your approval again before they can use the app.', { ok: 'Move to pending', danger: true, title: 'Remove this officer\'s access?' })) return;
      try { await db(sb.from('v2_profiles').update({ role: 'pending' }).eq('user_id', b.dataset.del)); toast('Moved back to pending'); } catch (e) { toast(e.message, true); } });
  }
  await draw();
  return watch(['v2_profiles'], () => draw().catch(()=>{}));
}
