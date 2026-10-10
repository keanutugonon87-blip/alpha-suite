import { esc } from '../core.js';
import { TERMS, RULES, QUIZ, RANKS } from '../learn-data.js';

const KEY = 'alpha-deckwatch-v1';
const load = () => { try { return { correct: 0, answered: 0, streak: 0, best: 0, last: '', ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { correct: 0, answered: 0, streak: 0, best: 0, last: '' }; } };
const save = s => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode: progress lives for this visit only */ } };
const dayKey = d => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
const dayNo = () => Math.floor(Date.now() / 864e5);
const rankOf = n => { let i = 0; RANKS.forEach(([t], k) => { if (n >= t) i = k; }); return { i, name: RANKS[i][1], next: RANKS[i + 1] }; };
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export function renderLearn(host) {
  let st = load(), round = null;
  const [term, tdef] = TERMS[dayNo() % TERMS.length], [rule, rdef] = RULES[dayNo() % RULES.length];

  function touchStreak() {
    const today = dayKey(Date.now());
    if (st.last === today) return;
    st.streak = st.last === dayKey(Date.now() - 864e5) ? st.streak + 1 : 1; st.best = Math.max(st.best, st.streak); st.last = today; save(st);
  }
  function header() {
    const r = rankOf(st.correct), span = r.next ? r.next[0] - RANKS[r.i][0] : 1, into = r.next ? st.correct - RANKS[r.i][0] : 1;
    return `<div class="rank card pad"><div class="rank-top"><div><small>Your rank</small><h3>${esc(r.name)}</h3></div><div class="streak"><b>${st.streak}</b><small>day streak</small></div></div>
      <div class="prog"><i style="width:${Math.min(100, into / span * 100)}%"></i></div>
      <small class="muted">${r.next ? `${r.next[0] - st.correct} more correct answers to reach ${esc(r.next[1])}` : 'Highest rank reached. Fair winds, Master.'}</small></div>`;
  }
  function brief() {
    return `<div class="brief"><div class="card pad"><small>Term of the day</small><h3>${esc(term)}</h3><p>${esc(tdef)}</p></div>
      <div class="card pad"><small>Rule of the road</small><h3>${esc(rule)}</h3><p>${esc(rdef)}</p></div></div>`;
  }
  function home() {
    host.innerHTML = `${header()}${brief()}<div class="card pad quizcta"><h3>Quick quiz</h3><p class="muted">Five questions from the bridge: navigation, seamanship, safety and the Rules of the Road. Every correct answer moves you up the ranks.</p>
      <button class="btn gold" id="go">Start watch</button><small class="muted" style="display:block;margin-top:8px">${st.answered ? `${st.correct} correct of ${st.answered} answered so far` : 'Your progress is saved on this device.'}</small></div>`;
    host.querySelector('#go').onclick = start;
  }
  function start() { touchStreak(); round = { qs: shuffle(QUIZ).slice(0, 5), i: 0, right: 0, picked: null }; ask(); }
  function ask() {
    const q = round.qs[round.i], r = round.picked;
    const opts = q[1].map((o, k) => { const cls = r === null ? '' : k === q[2] ? ' right' : k === r ? ' wrong' : ' dim'; return `<button class="opt${cls}" data-k="${k}" ${r !== null ? 'disabled' : ''}><span class="lt">${'ABCD'[k]}</span>${esc(o)}</button>`; }).join('');
    host.innerHTML = `${header()}<div class="card pad quiz"><div class="qhead"><small>Question ${round.i + 1} of 5</small><div class="dots">${round.qs.map((_, k) => `<i class="${k < round.i ? 'done' : k === round.i ? 'now' : ''}"></i>`).join('')}</div></div>
      <h3 class="q">${esc(q[0])}</h3><div class="opts">${opts}</div>
      ${r !== null ? `<div class="why ${r === q[2] ? 'ok' : 'no'}" role="status"><b>${r === q[2] ? 'Correct.' : 'Not quite.'}</b> ${esc(q[3])}</div><button class="btn gold" id="nx" style="width:100%;margin-top:12px">${round.i === 4 ? 'See result' : 'Next question'}</button>` : ''}</div>`;
    host.querySelectorAll('.opt').forEach(b => b.onclick = () => {
      const k = +b.dataset.k; round.picked = k; st.answered++; if (k === q[2]) { round.right++; st.correct++; } save(st); ask();
    });
    host.querySelector('#nx')?.addEventListener('click', () => { round.i++; round.picked = null; round.i > 4 ? done() : ask(); });
  }
  function done() {
    const msg = round.right === 5 ? 'Perfect watch. Not a single miss.' : round.right >= 3 ? 'Solid watch. Review the ones you missed and go again.' : 'Rough seas today. The explanations are the study guide, so run it again.';
    host.innerHTML = `${header()}<div class="card pad" style="text-align:center"><h2>${round.right} of 5</h2><p>${msg}</p>
      <div class="bubbles" aria-hidden="true">${Array.from({ length: 8 }, (_, k) => `<i style="left:${8 + k * 12}%;animation-delay:${k * .12}s"></i>`).join('')}</div>
      <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap"><button class="btn gold" id="again">Another watch</button><button class="btn ghost" id="back">Back to the brief</button></div></div>`;
    host.querySelector('#again').onclick = start; host.querySelector('#back').onclick = home;
  }
  home();
}
