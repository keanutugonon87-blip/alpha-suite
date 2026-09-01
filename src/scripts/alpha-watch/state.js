/* Alpha Watch — state.js
   The single mutable state object (imported by reference everywhere) plus
   the derived/business-logic getters that read from it. */
import { REPEAT_OFFENSE_FINE, offenseSanctionLabel, DEFAULT_STANDARD } from './constants.js';

export const state = {
  screen:'loading', // loading | setup | gate | app | public
  tab:'dashboard',
  session:null, // {name, role, username, accountId}
  roster:[],
  standard: DEFAULT_STANDARD,
  ledger:[],
  accounts:[],
  toast:null,
  modal:null,
  search:'',
  statusFilter:'all',
  publicSearch:'',
  _setupError:null,
  _loginError:null,
};

export const loginLockout = {attempts:0, until:0};

/* Returns every violation belonging to a student, oldest first, each
   annotated with its offenseNumber (null until the Secretary has approved
   it — an awaiting-approval submission doesn't count toward the tally yet). */
export function getStudentOffenseTimeline(studentId){
  const sorted = state.ledger
    .filter(v=>v.studentId===studentId)
    .slice()
    .sort((a,b)=> (a.date||'').localeCompare(b.date||'') || a.id.localeCompare(b.id));
  let n = 0;
  return sorted.map(v=>{
    const offenseNumber = v.status==='awaiting_approval' ? null : ++n;
    return {...v, offenseNumber};
  });
}
export function getViolationOffenseNumber(v){
  const match = getStudentOffenseTimeline(v.studentId).find(x=>x.id===v.id);
  return match ? match.offenseNumber : null;
}
export function getViolationSanction(v){
  return offenseSanctionLabel(getViolationOffenseNumber(v), v.waived);
}
/* Total fines owed by one student — every approved offense from the 2nd
   onward carries a fixed fine, counted whether or not it has since been
   resolved (an awaiting-approval submission never counts). */
export function getStudentTotalFines(studentId){
  return getStudentOffenseTimeline(studentId).filter(v=>v.offenseNumber && v.offenseNumber>=2 && !v.waived).length * REPEAT_OFFENSE_FINE;
}
/* Class-wide total of every student's fines, for officer dashboards. */
export function getClassTotalFines(){
  return state.roster.reduce((sum,s)=> sum + getStudentTotalFines(s.id), 0);
}
