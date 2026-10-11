/* Public officer profile sheet: photo, position, term, bio, leadership roles, trainings and awards, optional birthday. */
import { modal, esc, initials } from './core.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const lines = s => String(s || '').split(/\r?\n/).map(x => x.replace(/^[\s•\-–*]+/, '').trim()).filter(Boolean);
const list = (title, items) => items.length ? `<section class="pf-sec"><h4>${title}</h4><ul>${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul></section>` : '';

export function showOfficerProfile(o) {
  const roles = lines(o.credentials), awards = lines(o.awards), bio = String(o.bio || '').trim();
  const bd = o.bday && o.bday.m ? `${MONTHS[o.bday.m - 1]} ${o.bday.d}` : '';
  const empty = !roles.length && !awards.length && !bio;
  return modal(`<button class="pf-x" id="pfx" aria-label="Close">×</button>
    <div class="pf-head"><div class="pf-ph">${o.photo ? `<img src="${o.photo}" alt="${esc(o.name)}" style="object-position:${o.x ?? 50}% ${o.y ?? 50}%">` : esc(initials(o.name))}</div>
      <h3>${esc(o.name)}</h3><p class="pf-pos">${esc(o.position)}</p>${o.term ? `<small class="pf-term">${esc(o.term)}</small>` : ''}</div>
    ${bio ? `<section class="pf-sec"><h4>In their words</h4><p class="pf-bio">${esc(bio)}</p></section>` : ''}
    ${list('Leadership roles', roles)}${list('Trainings and awards', awards)}
    ${empty ? '<p class="pf-empty">This officer hasn’t added their leadership credentials yet.</p>' : ''}
    ${bd ? `<p class="pf-bd">Birthday: ${bd}</p>` : ''}`, (m, close) => {
    m.querySelector('.sheet').classList.add('prof');
    m.querySelector('#pfx').onclick = close;
  });
}
