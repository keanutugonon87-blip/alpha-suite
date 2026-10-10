/* Tiny English / Bisaya switch for the public page. */
const KEY = 'alpha-lang';
export const getLang = () => { try { return localStorage.getItem(KEY) === 'ceb' ? 'ceb' : 'en'; } catch { return 'en'; } };
export const setLang = l => { try { localStorage.setItem(KEY, l); } catch { /* ignore */ } };
const D = {
  signin: ['Officer sign in', 'Pag-sign in sa opisyal'],
  fund: ['Fund', 'Pondo'], viol: ['Violations', 'Paglapas'], me: ['My Status', 'Akong Status'], officers: ['Officers', 'Mga Opisyal'], learn: ['Deck Watch', 'Deck Watch'], bulletin: ['Bulletin', 'Balita'],
  balance: ['Class fund balance', 'Balanse sa pondo sa klase'],
  good: ['everyone in good standing', 'tanan maayo ang kahimtang'],
  openv: ['with open violations', 'adunay wala pa masulbad nga paglapas'],
  past: ['Past collection periods', 'Naglabay nga koleksyon'],
  noentries: ['No entries yet', 'Wala pay entry'], noentriesd: ['Collections and expenses show up here as soon as they are approved.', 'Makita dinhi ang koleksyon ug gasto kung aprubahan na.'],
  outstanding: ['Outstanding', 'Wala pa masulbad'], resolved: ['Resolved', 'Nasulbad na'], all: ['All', 'Tanan'], total: ['total', 'tanan'],
  search: ['Search name or violation', 'Pangita og ngalan o paglapas'],
  nomatch: ['No matching records', 'Walay nakit-an'],
  share: ['Share', 'I-share'], copied: ['Link copied', 'Na-copy ang link'],
  progress: ['Collection progress', 'Pag-uswag sa koleksyon'], paid: ['paid', 'bayad na'],
  mytitle: ['Check my status', 'Tan-awa ang akong status'], mydesc: ['Scan the QR on your Alpha card to see only your own balance and violations. Nobody else can see this.', 'I-scan ang QR sa imong Alpha card aron makita ang imong balanse ug paglapas. Ikaw ra ang makakita.'],
  scan: ['Scan my QR card', 'I-scan akong QR card'], photo: ['Use a photo of my card', 'Gamita ang litrato sa card'], paste: ['Paste my code', 'I-paste ang code'],
  owed: ['You owe', 'Utang nimo'], clear: ['All paid up', 'Bayad na tanan'], forget: ['Not me / forget', 'Dili ako / kalimti'],
  hello: ['Hello', 'Kumusta'], noviol: ['No violations on record. Keep it up.', 'Walay paglapas. Padayon!'],
  pin: ['Notice', 'Pahibalo'],
};
export const t = k => (D[k] || [k, k])[getLang() === 'ceb' ? 1 : 0];
