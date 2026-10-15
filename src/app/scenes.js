/* Maritime scene banners — one illustration per landing-page tab. Pure inline SVG, themed to the nautical palette. */
const WAVES = 'q25 -9 50 0' + ' t50 0'.repeat(79);
const wave = (y, fill, cls, op = 1) => `<g class="wv ${cls}" opacity="${op}"><path d="M-1800 ${y} ${WAVES} V160 H-1800z" fill="${fill}"/></g>`;
const gull = (x, y, s = 1) => `<path class="gull" transform="translate(${x} ${y}) scale(${s})" d="M0 0 q5 -6 10 0 q5 -6 10 0" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>`;
const cloud = (x, y, s = 1, o = .9) => `<g class="cl" opacity="${o}" transform="translate(${x} ${y}) scale(${s})"><ellipse cx="0" cy="0" rx="22" ry="7" fill="#fff"/><ellipse cx="-12" cy="-5" rx="11" ry="7" fill="#fff"/><ellipse cx="8" cy="-7" rx="13" ry="8" fill="#fff"/></g>`;
const sky = (a, b) => `<defs><linearGradient id="sk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect x="-2000" width="4400" height="160" fill="url(#sk)"/>`;

const sides = {
  sky: `${cloud(-330, 30, 1.1)}${cloud(-120, 52, .7, .8)}${gull(-210, 36)}${gull(-186, 28, .7)}${cloud(500, 36, 1)}${cloud(700, 58, .8, .8)}${gull(590, 30)}${gull(612, 22, .7)}${cloud(-620, 40, .9)}${cloud(920, 30, 1.1)}`,
  night: `<g fill="#fff" class="tw">${[[-640,24],[-560,60],[-470,30],[-390,70],[-300,20],[-220,52],[-140,34],[470,28],[540,64],[620,22],[700,56],[790,30],[880,64],[960,24],[-720,52],[-830,30]].map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i % 3 ? 1 : 1.6}"/>`).join('')}</g>`,
  bridge: `<g stroke="#d9a63c" stroke-width="3" fill="#bfe3f4" opacity=".95"><rect x="-340" y="16" width="330" height="70" rx="8" fill="#8fc7e6"/><rect x="410" y="16" width="330" height="70" rx="8" fill="#8fc7e6"/></g>`,
};

const SCENES = {
  /* Fund — a busy harbor: cargo ship, crane, buoy */
  fund: ['The Harbor', 'Every peso, safe in port', `${sky('#bfe3f4', '#eaf7fc')}${cloud(70, 28, 1)}${cloud(280, 40, .8, .8)}${gull(150, 30)}${gull(176, 22, .7)}
    <rect x="-2000" y="96" width="4400" height="64" fill="#7fc0dc"/>
    <g fill="#0c1f5c"><rect x="262" y="40" width="5" height="62"/><rect x="226" y="40" width="70" height="5"/><rect x="226" y="40" width="3" height="26" fill="#d9a63c"/><path d="M262 40 L296 40 L296 46 Z" opacity=".5"/><rect x="236" y="62" width="16" height="12" fill="#d9a63c"/></g>
    <g class="shipbob"><path d="M92 92 h130 l-14 22 H106z" fill="#0c1f5c"/><rect x="108" y="76" width="40" height="16" fill="#fff" stroke="#0c1f5c"/><rect x="152" y="70" width="30" height="22" fill="#2a7fb0"/><rect x="186" y="82" width="26" height="10" fill="#d9a63c"/><rect x="164" y="56" width="5" height="16" fill="#0c1f5c"/></g>
    <g class="buoy"><path d="M336 112 l8 -22 l8 22z" fill="#c8362c"/><rect x="341" y="84" width="6" height="8" fill="#fff"/></g>
    ${wave(104, '#5aa9cc', 'a', .75)}${wave(120, '#2a7fb0', 'b', .9)}${wave(136, '#0c1f5c', 'c', .85)}${sides.sky}`],
  /* Violations — lighthouse on a rock (a beacon of discipline) */
  standing: ['The Lighthouse', 'Keeping the crew on course', `${sky('#9fd0ea', '#e4f4fb')}${cloud(300, 26, 1)}${cloud(60, 44, .7, .8)}${gull(110, 34)}
    <path class="beam" d="M214 54 L400 24 L400 84z" fill="#ffe9a6" opacity=".55"/>
    <path d="M150 128 q30 -28 60 -28 q40 0 70 28z" fill="#5b6b7a"/>
    <path d="M196 100 l8 -62 h32 l8 62z" fill="#fff" stroke="#0c1f5c" stroke-width="1.5"/><path d="M200 78 h44 l-2 14 h-40z M205 52 h34 l-1.5 12 h-31z" fill="#c8362c"/>
    <rect x="203" y="30" width="38" height="10" fill="#0c1f5c"/><rect x="210" y="38" width="24" height="14" fill="#ffe08a" stroke="#0c1f5c"/><path d="M206 30 l16 -14 l16 14z" fill="#c8362c"/>
    ${wave(112, '#5aa9cc', 'a', .8)}${wave(126, '#2a7fb0', 'b', .95)}${wave(142, '#0c1f5c', 'c', .9)}${sides.sky}`],
  /* My Status — ship's bridge: helm wheel in front of a window */
  me: ['The Bridge', 'Know your standing, check your course', `<rect x="-2000" width="4400" height="160" fill="#0c1f5c"/><rect x="28" y="16" width="344" height="70" rx="8" fill="url(#bw)" stroke="#d9a63c" stroke-width="3"/>
    <defs><linearGradient id="bw" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bfe3f4"/><stop offset=".62" stop-color="#eaf7fc"/><stop offset=".62" stop-color="#2a7fb0"/><stop offset="1" stop-color="#0c3a7a"/></linearGradient></defs>
    <path d="M28 70 q50 -8 100 0 t100 0 t100 0 t44 0" fill="none" stroke="#fff" stroke-width="1.5" opacity=".7" class="wv a"/>
    <g stroke="#d9a63c" stroke-width="3"><path d="M142 16 V86 M258 16 V86"/></g>
    <rect x="-2000" y="94" width="4400" height="66" fill="#102a74"/><rect x="-2000" y="94" width="4400" height="6" fill="#d9a63c"/>
    <g transform="translate(346 112) scale(.7)"><g class="helm"><circle r="26" fill="none" stroke="#d9a63c" stroke-width="5"/><circle r="6" fill="#d9a63c"/><g stroke="#d9a63c" stroke-width="4" stroke-linecap="round"><path d="M0 -38 V38 M-38 0 H38 M-27 -27 L27 27 M27 -27 L-27 27"/></g></g></g>${sides.bridge}`],
  /* Officers — ship's deck: mast, flag, rail, rope */
  officers: ['The Deck', 'Meet the officers on watch', `${sky('#a9d8ee', '#eaf7fc')}${cloud(330, 30, .9)}${cloud(80, 22, .7, .8)}${gull(240, 32)}
    <rect x="-2000" y="104" width="4400" height="56" fill="#2a7fb0"/>${wave(100, '#5aa9cc', 'a', .8)}
    <path d="M-2000 160 V118 H2400 V160z" fill="#8a5a2b"/><path d="M-2000 118 H2400" stroke="#6b431c" stroke-width="3"/><g stroke="#6b431c" stroke-width="2" opacity=".6"><path d="M-2000 132 H2400 M-2000 146 H2400"/></g>
    <rect x="196" y="14" width="6" height="106" fill="#d9a63c"/><circle cx="199" cy="13" r="4" fill="#d9a63c"/>
    <g class="flagw"><path d="M202 20 H252 V44 H202z" fill="#fff" stroke="#0c1f5c"/><path d="M252 20 H284 L268 32 284 44 H252z" fill="#1d4fd8" stroke="#0c1f5c"/></g>
    <path d="M199 30 L96 118 M199 30 L304 118" stroke="#0c1f5c" stroke-width="1.5" opacity=".6"/><path d="M130 94 L268 94" stroke="#0c1f5c" stroke-width="1" opacity=".35"/>
    <g fill="none" stroke="#fff" stroke-width="4"><path d="M-2000 108 H2400" stroke="#d9a63c"/></g><g stroke="#d9a63c" stroke-width="3"><path d="M30 108 V120 M110 108 V120 M290 108 V120 M370 108 V120"/></g>
    <g class="ring"><circle cx="340" cy="92" r="11" fill="#fff" stroke="#c8362c" stroke-width="5"/></g>${sides.sky}`],
  /* Deck Watch — open sea at dusk with stars and the Southern Cross */
  learn: ['The Open Sea', 'Study the stars, learn the ropes', `${sky('#0c1f5c', '#2a5fa8')}
    <g fill="#fff" class="tw"><circle cx="40" cy="22" r="1.4"/><circle cx="90" cy="46" r="1"/><circle cx="150" cy="18" r="1.6"/><circle cx="330" cy="26" r="1.2"/><circle cx="370" cy="58" r="1"/><circle cx="290" cy="50" r="1.4"/><circle cx="60" cy="68" r="1"/></g>
    <g fill="#ffe9a6" class="tw2"><circle cx="220" cy="22" r="3"/><circle cx="240" cy="48" r="2.4"/><circle cx="208" cy="58" r="2"/><circle cx="196" cy="38" r="2.4"/></g><g stroke="#ffe9a6" stroke-width=".8" opacity=".55"><path d="M220 22 L208 58 M196 38 L240 48"/></g>
    <circle cx="340" cy="36" r="14" fill="#fff7d6"/><circle cx="346" cy="32" r="12" fill="#17398a"/>
    <rect x="-2000" y="100" width="4400" height="60" fill="#0f2c78"/><path class="moonp" d="M338 100 h8 l-2 60 h-4z" fill="#fff7d6" opacity=".22"/>
    <g class="shipbob" fill="#050f33"><path d="M60 100 h60 l-8 12 H68z"/><rect x="76" y="86" width="22" height="14"/><rect x="84" y="74" width="4" height="12"/></g>
    ${wave(108, '#17398a', 'a', .9)}${wave(124, '#0c2f78', 'b')}${wave(142, '#06194a', 'c')}${sides.night}`],
  /* Bulletin — sunrise over the horizon */
  bulletin: ['Sunrise', 'Fresh word from the officers', `${sky('#ffcf8a', '#fff1d6')}
    <g class="rays" transform="translate(200 104)" stroke="#fff" stroke-width="2" opacity=".55"><path d="M0 0 L-180 -90 M0 0 L-120 -100 M0 0 L-50 -104 M0 0 L50 -104 M0 0 L120 -100 M0 0 L180 -90"/></g>
    <circle class="sun" cx="200" cy="106" r="38" fill="#ffd36b"/><circle cx="200" cy="106" r="52" fill="#ffd36b" opacity=".3"/>
    ${cloud(60, 40, 1, .85)}${cloud(330, 56, .9, .8)}${gull(264, 40)}${gull(284, 32, .7)}
    <rect x="-2000" y="106" width="4400" height="54" fill="#2a7fb0"/><path d="M170 108 h60 M178 116 h44 M186 124 h28" stroke="#ffe9a6" stroke-width="3" stroke-linecap="round" opacity=".75"/>
    <path d="M40 106 l8 -16 l8 16z M54 106 l10 -20 l10 20z" fill="#0c1f5c" class="shipbob" transform="translate(280 0)"/>
    ${wave(112, '#5aa9cc', 'a', .6)}${wave(128, '#2a7fb0', 'b', .85)}${wave(144, '#0c1f5c', 'c', .8)}${sides.sky}`],
};

/* [skyTop, skyHorizon, horizon %, seaTop, seaBottom, dark?] — used to extend each scene sideways on wide screens */
const META = {
  fund: ['#9fd6ee', '#eaf7fc', 60, '#5aa9cc', '#0c1f5c', 0],
  standing: ['#7fb8de', '#e4f4fb', 70, '#5aa9cc', '#0c1f5c', 0],
  me: ['#0c1f5c', '#0c1f5c', 59, '#102a74', '#102a74', 1],
  officers: ['#9fd6ee', '#eaf7fc', 66, '#8a5a2b', '#6b431c', 0],
  learn: ['#06143f', '#2a5fa8', 62, '#0f2c78', '#06194a', 1],
  bulletin: ['#f9c36d', '#fff1d6', 66, '#2a7fb0', '#0c1f5c', 0],
};

/* A looping video per tab sits on top of the SVG scene (kept as the fallback). Static poster when motion is reduced or data saver is on. */
const reduceMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
const saveData = () => { try { return !!navigator.connection?.saveData; } catch { return false; } };
/* Scenery videos: Auto plays them except on mobile data (where the browser tells us), On always plays, Off shows stills only. */
const SC = 'alpha-scenes';
export const sceneMode = () => { try { const v = localStorage.getItem(SC); return v === 'on' || v === 'off' ? v : 'auto'; } catch { return 'auto'; } };
export const setSceneMode = v => { try { localStorage.setItem(SC, v); } catch { /* ignore */ } };
const cellular = () => { try { const c = navigator.connection; return !!c && (c.type === 'cellular' || /^(slow-2g|2g|3g)$/.test(c.effectiveType || '')); } catch { return false; } };
const stillOnly = () => sceneMode() === 'off' || (sceneMode() === 'auto' && cellular());
const portrait = () => { try { return matchMedia('(max-width:639px)').matches; } catch { return false; } };
const SCENE_KEYS = ['fund', 'standing', 'me', 'officers', 'learn', 'bulletin'];
const src = (k, ext) => `assets/scenes/${k}${portrait() ? '-m' : ''}.${ext}`;
const media = k => {
  if (saveData()) return '';
  if (reduceMotion() || stillOnly()) return `<img class="hvid" src="${src(k, 'jpg')}" alt="" decoding="async">`;
  return `<video class="hvid" src="${src(k, 'mp4')}" poster="${src(k, 'jpg')}" autoplay muted loop playsinline preload="auto" aria-hidden="true" disablepictureinpicture></video>`;
};
/* Warm the browser cache with every tab's still, so switching tabs never shows an empty or older frame. */
let warmed = false;
export function warmScenes() {
  if (warmed || saveData()) return; warmed = true;
  const go = () => SCENE_KEYS.forEach(k => { const i = new Image(); i.decoding = 'async'; i.src = src(k, 'jpg'); });
  (window.requestIdleCallback || (f => setTimeout(f, 1200)))(go);
}

/* The scenery that fills the bottom of the landing hero card; it changes with the selected tab. */
export function heroScene(tab) {
  const s = SCENES[tab] || SCENES.fund, m = META[SCENES[tab] ? tab : 'fund'];
  const bg = `linear-gradient(180deg,${m[0]} 0,${m[1]} ${m[2] - 2}%,${m[3]} ${m[2]}%,${m[4]} 100%)`;
  return {
    top: m[0], dark: !!m[5], name: s[0],
    html: `<div class="hscene${saveData() ? '' : ' hasvid'}" role="img" aria-label="${s[0]}" style="background:${bg}">${media(SCENES[tab] ? tab : 'fund')}<svg viewBox="0 0 400 160" preserveAspectRatio="xMidYMax meet" aria-hidden="true">${s[2]}</svg></div>`,
  };
}
