import { esc } from '../core.js';
import { getLang, setLang } from '../i18n.js';

/* First visit: what the system is, why it exists, how to get in, where to get help, and the rules of use.
   A student must read to the end and agree before the sign-in screen opens. The agreement is remembered on this phone
   and sent with the access request, so the officers can see when it was read. Change RULES_VERSION when the rules change and everyone reads them again. */
export const RULES_VERSION = 'v1';
const KEY = 'alpha-rules';
export const rulesAccepted = () => { try { return localStorage.getItem(KEY) === RULES_VERSION; } catch { return false; } };
const accept = () => { try { localStorage.setItem(KEY, RULES_VERSION); } catch { /* the next visit asks again */ } };
const FB = 'https://www.facebook.com/profile.php?id=61593577524416';

const L = (en, ceb) => getLang() === 'ceb' ? ceb : en;

function pages() {
  return [
    { icon: '⚓', h: L('What is SAILS ’28?', 'Unsa ang SAILS ’28?'),
      p: [L('SAILS ’28 is the SAILS Governance System of Batch 28 at PIT-COMED. It runs the organization’s funds and calendar in one place, so the officers and every student work from the same records.',
            'Ang SAILS ’28 mao ang SAILS Governance System sa Batch 28 sa PIT-COMED. Gidumala niini ang pondo ug kalendaryo sa organisasyon sa usa ka lugar, aron parehas ang rekord nga gigamit sa mga officer ug sa matag estudyante.'),
          L('Every student gets a personal dashboard. It shows only your own balance, payments, violations and requests, along with the class funds, announcements and the calendar.', 'Ang matag estudyante adunay personal nga dashboard. Ang imong balanse, bayad, paglapas ug hangyo ra ang makita, uban sa pondo sa klase, pahibalo ug kalendaryo.')] },
    { icon: '🔍', h: L('Why it exists', 'Ngano naa kini'),
      p: [L('The money belongs to the class, so every student has the right to know where it goes. Before, you had to ask around and hope the answer was right.',
            'Ang kuwarta iya sa klase, busa ang matag estudyante adunay katungod nga mahibaw-an kung asa kini gigamit. Kaniadto, mangutana pa ug mag-asa nga husto ang tubag.'),
          L('This system makes every collection and expense visible, keeps a record of who did what and when, and lets any student ask to see the funds. That is how we keep each other honest.',
            'Gihimo sa sistema nga makita ang matag koleksyon ug gasto, nagtipig og rekord kung kinsa ang naghimo ug kanus-a, ug mahimong mangayo ang bisan kinsa nga estudyante nga makita ang pondo. Mao kini ang paagi aron magtinud-anay kita.')] },
    { icon: '🪪', h: L('How you get access', 'Unsaon pag-access'),
      ol: [L('Your Class Mayor sends your name and Student ID to the SAILS officers.', 'Ipadala sa imong Class Mayor ang imong ngalan ug Student ID sa mga SAILS officer.'),
           L('The officers add you to the system and give you your personal QR card.', 'Ibutang ka sa mga officer sa sistema ug hatagan ka sa imong personal nga QR card.'),
           L('You scan your QR card here. That proves you are on the class list.', 'I-scan nimo ang imong QR card dinhi. Mao kini ang pamatuod nga naa ka sa listahan sa klase.'),
           L('The SAILS VP Internal and then the SAILS President approve you. You will see where your request is.', 'Aprobahan ka sa SAILS VP Internal ug dayon sa SAILS President. Makita nimo kung asa na ang imong hangyo.'),
           L('You choose a 6-digit PIN. After that you only need your Student ID and PIN.', 'Mopili ka og 6-ka-numero nga PIN. Human niana Student ID ug PIN na lang.')],
      p: [L('Tip: add this page to your phone’s home screen so it opens like an app, and turn on alerts to hear about your balance and announcements.', 'Tip: ibutang kini nga panid sa home screen sa imong telepono aron mo-abli sama sa app, ug i-on ang alerts aron makabalo sa imong balanse ug pahibalo.')] },
    { icon: '🙋', h: L('Where to get help', 'Asa mangayo og tabang'),
      p: [L('Setting up your account, a missing name, a wrong Student ID: ask your Class Mayor first. They will bring it to the SAILS VP Internal or the SAILS Secretary.',
            'Sa pag-set up sa account, nawala nga ngalan, sayop nga Student ID: pangutana una sa imong Class Mayor. Dad-on nila kini sa SAILS VP Internal o sa SAILS Secretary.'),
          L('Lost or damaged QR card: ask the SAILS Treasurer for a new one. Questions about the funds: use “Request fund records” on your dashboard.',
            'Nawala o nadaot nga QR card: pangayo og bag-o sa SAILS Treasurer. Pangutana bahin sa pondo: gamita ang “Request fund records” sa imong dashboard.')],
      link: [FB, L('Message the SAILS page on Facebook', 'Mag-message sa SAILS page sa Facebook')] },
  ];
}

const RULES = () => [
  L('This account is only for you. Do not lend your QR card or PIN to anyone, even a friend.', 'Ang account kay para nimo ra. Ayaw pahulamon ang imong QR card o PIN bisan kang kinsa, bisan higala.'),
  L('What you see about your balance and records is private. Do not share or post other students’ information.', 'Pribado ang imong makita nga balanse ug rekord. Ayaw ipakaylap o i-post ang impormasyon sa uban nga estudyante.'),
  L('Use the system honestly. Ask for records when you need them, and do not send false or repeated requests.', 'Gamita ang sistema nga matinud-anon. Mangayo og rekord kung kinahanglan, ug ayaw magpadala og bakak o balik-balik nga hangyo.'),
  L('Your requests are logged with your name and the time. The SAILS Secretary, VP Internal and President can see this log.', 'Ang imong mga hangyo gitala uban sa imong ngalan ug oras. Makita kini sa SAILS Secretary, VP Internal ug President.'),
  L('The official record is what the officers have signed. If something looks wrong, tell your Class Mayor so it can be corrected.', 'Ang opisyal nga rekord mao ang gipirmahan sa mga officer. Kung adunay sayop, ipahibalo sa imong Class Mayor aron ma-ayo.'),
  L('The officers can remove access if the rules are broken.', 'Mahimong tangtangon sa mga officer ang access kung malapas ang mga lagda.'),
];

export function renderWelcome(root, onDone, extra = {}) {
  let i = 0, agreed = false;
  const draw = () => {
    const pg = pages(), total = pg.length + 1, last = i === pg.length, cur = pg[i];
    root.innerHTML = `<div class="top"><span class="crest-ring"><img src="assets/wolf-crest.png" alt=""></span><div class="t"><b>SAILS ’28</b><small>PIT-COMED · Batch 28</small></div>
      <button class="btn ghost sm" id="wl-lang" aria-label="Language">${getLang() === 'ceb' ? 'EN' : 'CEB'}</button></div>
      <main style="max-width:480px;margin:0 auto;padding:0 16px 40px"><div class="card pad" style="text-align:center;margin-top:16px">
        <div style="font-size:.8rem;color:var(--muted,#58708a);letter-spacing:.08em;text-transform:uppercase">${i === 0 ? L('Welcome, Batch 28', 'Maayong pag-abot, Batch 28') : `${i + 1} / ${total}`}</div>
        ${last ? `<div style="font-size:2rem;margin-top:6px">📜</div><h2 style="margin:4px 0 10px">${L('Rules of use', 'Mga lagda sa paggamit')}</h2>
          <ol style="text-align:left;padding-left:20px;margin:0 0 14px">${RULES().map(r => `<li style="margin-bottom:8px">${esc(r)}</li>`).join('')}</ol>
          <label style="display:flex;gap:10px;align-items:flex-start;text-align:left;cursor:pointer"><input type="checkbox" id="wl-ok" style="margin-top:4px;width:20px;height:20px" ${agreed ? 'checked' : ''}><span>${L('I have read the rules and I agree to follow them.', 'Nabasa nako ang mga lagda ug musugot ko nga motuman niini.')}</span></label>`
        : `<div style="font-size:2rem;margin-top:6px">${cur.icon}</div><h2 style="margin:4px 0 10px">${esc(cur.h)}</h2>
          ${cur.ol ? `<ol style="text-align:left;padding-left:20px;margin:0 0 12px">${cur.ol.map(x => `<li style="margin-bottom:8px">${esc(x)}</li>`).join('')}</ol>` : ''}
          ${(cur.p || []).map(x => `<p style="text-align:left;margin:0 0 10px">${esc(x)}</p>`).join('')}
          ${cur.link ? `<p style="text-align:left"><a href="${cur.link[0]}" target="_blank" rel="noopener">${esc(cur.link[1])}</a></p>` : ''}`}
        <div style="display:flex;justify-content:center;gap:6px;margin:14px 0">${Array.from({ length: total }, (_, k) => `<i style="width:8px;height:8px;border-radius:50%;background:${k === i ? 'var(--gold,#d9a63c)' : 'var(--line,#c8d4de)'}"></i>`).join('')}</div>
        <div style="display:flex;gap:8px">${i ? `<button class="btn ghost" id="wl-back">${L('Back', 'Balik')}</button>` : ''}<button class="btn gold" id="wl-next" style="flex:1" ${last && !agreed ? 'disabled' : ''}>${last ? L('Continue to scan my QR card', 'Padayon sa pag-scan sa akong QR card') : L('Next', 'Sunod')}</button></div>
        ${i === 0 ? `<p style="margin:14px 0 0"><a href="#" id="wl-have">${L('I already have an account. Sign in', 'Naa na koy account. Mag-sign in')}</a></p>` : ''}
        ${extra.guest && i === 0 ? `<p style="margin:6px 0 0;font-size:.9rem"><a href="#" id="wl-guest">${L('Parent or visitor with a guest code', 'Ginikanan o bisita nga naay guest code')}</a> · <a href="#/staff">${L('Officer sign in', 'Sign in sa officer')}</a></p>` : ''}
      </div></main>`;
    root.querySelector('#wl-lang').onclick = () => { setLang(getLang() === 'ceb' ? 'en' : 'ceb'); draw(); };
    root.querySelector('#wl-back')?.addEventListener('click', () => { i--; draw(); });
    root.querySelector('#wl-ok')?.addEventListener('change', e => { agreed = e.target.checked; root.querySelector('#wl-next').disabled = !agreed; });
    root.querySelector('#wl-next').onclick = () => { if (last) { if (!agreed) return; accept(); onDone('first'); } else { i++; draw(); window.scrollTo({ top: 0 }); } };
    root.querySelector('#wl-have')?.addEventListener('click', e => { e.preventDefault(); onDone('signin'); });
    root.querySelector('#wl-guest')?.addEventListener('click', e => { e.preventDefault(); onDone('signin'); });
  };
  draw();
}
