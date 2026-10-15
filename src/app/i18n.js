/* Tiny English / Bisaya switch for the public page. */
const KEY = 'alpha-lang';
export const getLang = () => { try { return localStorage.getItem(KEY) === 'ceb' ? 'ceb' : 'en'; } catch { return 'en'; } };
export const setLang = l => { try { localStorage.setItem(KEY, l); } catch { /* ignore */ } };
const D = {
  signin: ['Officer sign in', 'Pag-sign in sa opisyal'],
  fund: ['Fund', 'Pondo'], viol: ['Violations', 'Paglapas'], me: ['My Status', 'Akong Status'], officers: ['Officers', 'Mga Opisyal'], learn: ['Deck Watch', 'Deck Watch'], bulletin: ['Bulletin', 'Balita'],
  balance: ['Total balance, all funds', 'Kinatibuk-ang balanse, tanang pondo'],
  good: ['everyone in good standing', 'tanan maayo ang kahimtang'],
  openv: ['with open violations', 'adunay wala pa masulbad nga paglapas'],
  past: ['Past collection periods', 'Naglabay nga koleksyon'],
  noentries: ['No entries yet', 'Wala pay entry'], noentriesd: ['Collections and expenses show up here as soon as they are approved.', 'Makita dinhi ang koleksyon ug gasto kung aprubahan na.'],
  outstanding: ['Outstanding', 'Wala pa masulbad'], resolved: ['Resolved', 'Nasulbad na'], all: ['All', 'Tanan'], total: ['total', 'tanan'],
  search: ['Search name or violation', 'Pangita og ngalan o paglapas'],
  nomatch: ['No matching records', 'Walay nakit-an'],
  share: ['Share', 'I-share'], copied: ['Link copied', 'Na-copy ang link'],
  progress: ['Collection progress', 'Pag-uswag sa koleksyon'], paid: ['paid', 'bayad na'],
  mytitle: ['Check my status', 'Tan-awa ang akong status'], mydesc: ['Sign in with your Student ID and PIN (or your QR card) to see only your own balance and violations. Nobody else can see this.', 'Sulod gamit ang imong Student ID ug PIN (o QR card) aron makita ang imong balanse ug paglapas. Ikaw ra ang makakita.'],
  scan: ['Scan my QR card', 'I-scan akong QR card'], photo: ['Use a photo of my card', 'Gamita ang litrato sa card'], paste: ['Paste my code', 'I-paste ang code'],
  owed: ['You owe', 'Utang nimo'], clear: ['All paid up', 'Bayad na tanan'], forget: ['Not me / forget', 'Dili ako / kalimti'],
  hello: ['Hello', 'Kumusta'], noviol: ['No violations on record. Keep it up.', 'Walay paglapas. Padayon!'],
  pin: ['Notice', 'Pahibalo'],
  alertOff: ['Get a phone alert for every new notice', 'Padad-an og alerto sa matag bag-ong pahibalo'], turnOn: ['Turn on', 'I-on'], turnOff: ['Turn off', 'I-off'], alertOn: ['Alerts are on for this device', 'Naka-on ang alerto sa kini nga device'],
  alertIos: ['On iPhone: tap Share, then Add to Home Screen, open Alpha from there, and turn alerts on.', 'Sa iPhone: i-tap ang Share, Add to Home Screen, ablihi ang Alpha gikan didto, ug i-on ang alerto.'],
  remOff: ['Remind me on this phone when I still owe a payment', 'Pahinumdoman ko sa phone kung naa pa koy utang'], remOn: ['Payment reminders are on for this phone', 'Naka-on ang pahinumdom sa bayronon sa kini nga phone'],
  stmt: ['My statement', 'Akong statement'], stmtTitle: ['Statement of account', 'Statement sa akong account'], stmtPaid: ['Payments made', 'Mga bayad na'], stmtOwe: ['Still owed', 'Utang pa'], stmtNone: ['No payments yet', 'Wala pay bayad'], stmtPrint: ['Print / save as PDF', 'I-print / i-save isip PDF'], stmtClose: ['Close', 'Sirhi'],
  offlineAsOf: ['Offline. Showing what was saved on', 'Offline. Gipakita ang na-save kaniadto'], howPay: ['How to pay', 'Unsaon pagbayad'],
  excused: ['excused', 'gipasaylo'], copy: ['Copy', 'Kopyaha'], studentId: ['Student ID', 'Student ID'], pin: ['PIN (6 digits)', 'PIN (6 ka numero)'], signin2: ['Sign in', 'Sulod'], firstTime: ['First time or forgot your PIN? Set it up', 'Una nimo o nalimtan ang PIN? I-set up'], useQr: ['Or use my QR card', 'O gamita ang akong QR card'],
  pinBad: ['Student ID or PIN is not right. First time? Set up your PIN below.', 'Sayop ang Student ID o PIN. Una nimo? I-set up ang imong PIN sa ubos.'], pinLocked: ['Too many wrong tries. Try again in {n} minutes, or ask the Treasurer to reset your PIN.', 'Daghan kaayo og sayop. Sulayi pag-usab human sa {n} minutos, o pangayo sa Treasurer og reset sa PIN.'],
  pinRevoked: ['Your QR card was replaced. Ask the Treasurer for your new card.', 'Gipulihan ang imong QR card. Pangayo sa Treasurer og bag-ong card.'], pinNotReady: ['PIN sign-in is not switched on yet. Use your QR card for now.', 'Wala pa maablihi ang PIN sign-in. QR card una ang gamita.'], noNet: ['No signal. Try again when you are online.', 'Walay signal. Sulayi pag-usab kung naay internet.'],
  setupTitle: ['Set up your PIN', 'I-set up ang imong PIN'], setupDesc: ['Scan your QR card once to prove it is you, then choose a 6-digit PIN. After that you only need your Student ID and PIN.', 'I-scan ang imong QR card kausa aron mapamatud-an nga ikaw ni, unya pili og 6-ka-numero nga PIN. Human niana Student ID ug PIN na lang.'],
  qrRead: ['QR card read', 'Nabasa na ang QR card'], qrNeeded: ['Scan or paste your QR card first.', 'I-scan o i-paste una ang imong QR card.'], pinNew: ['New PIN (6 digits)', 'Bag-ong PIN (6 ka numero)'], pinConfirm: ['Type it again', 'I-type pag-usab'], pinSave: ['Save PIN and sign in', 'I-save ang PIN ug sulod'],
  pinNoMatch: ['The two PINs are not the same.', 'Dili parehas ang duha ka PIN.'], pinMismatchId: ['That Student ID does not match this QR card.', 'Dili motugma ang Student ID niini nga QR card.'], pinWeak: ['Pick a PIN that is harder to guess (not 123456 or the same number six times).', 'Pili og PIN nga lisod tagaon (dili 123456 o parehas nga numero).'],
  pinFormat: ['The PIN must be exactly 6 digits.', 'Ang PIN kinahanglan eksakto 6 ka numero.'], pinSaved: ['PIN saved', 'Na-save na ang PIN'], back: ['Back', 'Balik'], pasteAsk: ['Paste the code under your QR (starts with A1.)', 'I-paste ang code ilalom sa imong QR (magsugod sa A1.)'],
  display: ['Display', 'Hitsura'], scenery: ['Scenery videos', 'Mga video sa background'], sceneOn: ['Always on', 'Kanunay'], sceneOff: ['Off', 'Sira'], sceneHint: ['Auto plays them except on mobile data, to save your load.', 'Auto: gapakita gawas kung mobile data, aron dili mauga ang load.'], textSize: ['Text size', 'Gidak-on sa letra'], theme: ['Theme', 'Tema'], themeAuto: ['Auto', 'Awtomatiko'], themeLight: ['Light', 'Hayag'], themeDark: ['Dark', 'Ngitngit'], done: ['Done', 'Human'], copied: ['Copied', 'Nakopya na'], excusedNote: ['Excused by the officers', 'Gipasaylo sa mga opisyal'], myPays: ['My payments', 'Akong mga bayad'], pendingTag: ['waiting for approval', 'naghulat og aprobar'],
  alertDenied: ['Alerts are blocked in your browser settings.', 'Gi-block ang alerto sa browser settings.'],
};
export const t = k => (D[k] || [k, k])[getLang() === 'ceb' ? 1 : 0];
