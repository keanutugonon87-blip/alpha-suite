/* Read-only table of who can do what. Keep it in step with the role checks in the SQL files. */
const ROLES = [['mayor', 'Mayor'], ['vice_mayor', 'Vice'], ['secretary', 'Sec'], ['treasurer', 'Treas'], ['auditor', 'Aud'], ['marshall', 'Marsh'], ['sails', 'SAILS'], ['pio', 'PIO']];
const ALL = ROLES.map(r => r[0]);
const SCREENS = [
  ['Today (own duties)', ALL],
  ['Treasury, Balances', ['mayor', 'vice_mayor', 'treasurer', 'auditor', 'secretary']],
  ['Watch', ALL],
  ['Students', ['mayor', 'vice_mayor', 'secretary', 'treasurer', 'auditor']],
  ['Officers', ALL],
  ['Notices', ['mayor', 'vice_mayor', 'secretary', 'pio']],
  ['Documents', ['mayor', 'vice_mayor', 'secretary']],
  ['Accounts', ['mayor', 'vice_mayor', 'auditor']],
  ['Duties, Roles', ['mayor', 'vice_mayor']],
  ['System', ['mayor', 'vice_mayor', 'treasurer']],
];
const ACTIONS = [
  ['Close a month, reopen a month', ['mayor']],
  ['Verify a month (cash count)', ['mayor', 'vice_mayor', 'treasurer', 'auditor']],
  ['Waive a charge', ['mayor', 'vice_mayor']],
  ['Undo a waiver', ['mayor']],
  ['Send payment reminders', ['mayor', 'vice_mayor', 'treasurer', 'auditor']],
  ['Reset a student PIN', ['mayor', 'treasurer']],
  ['Link or unlink an officer login', ['mayor']],
  ['Create or revoke guest codes', ['mayor']],
  ['Add, edit or delete duties', ['mayor']],
  ['See who finished their duties', ['mayor', 'vice_mayor']],
  ['Back up now, see system health', ['mayor', 'vice_mayor']],
  ['Add or edit documents', ['mayor', 'vice_mayor', 'secretary']],
  ['Delete a document', ['mayor', 'secretary']],
  ['Change settings', ['mayor']],
];
const grid = (title, rows) => `<div class="card pad" style="margin-bottom:12px;overflow-x:auto"><b>${title}</b>
  <table class="rolegrid"><thead><tr><th></th>${ROLES.map(r => `<th scope="col">${r[1]}</th>`).join('')}</tr></thead><tbody>
  ${rows.map(([n, who]) => `<tr><th scope="row">${n}</th>${ROLES.map(r => who.includes(r[0]) ? `<td aria-label="${r[1]}: yes"><span class="tag ok">✓</span></td>` : `<td aria-label="${r[1]}: no" class="muted">–</td>`).join('')}</tr>`).join('')}
  </tbody></table></div>`;
export async function mountRoles(el) {
  el.innerHTML = `<h2 style="margin:0 0 4px">Who can do what</h2><p class="muted" style="margin:0 0 12px">Each officer sees only the screens and buttons their role allows. The database enforces it too, so a hidden button cannot be bypassed.</p>${grid('Screens', SCREENS)}${grid('Actions', ACTIONS)}`;
}
