/* Alpha Treasury — router.js
   The top-level render() dispatcher (screen -> HTML) and the toast helper.
   This has a circular import with screens.js (screens.js calls render() /
   showToast() from here; router.js calls the screen builders from there).
   That's safe in ES modules as long as neither side calls the other's
   export at module-evaluation time — here both sides only define
   functions at the top level, and the actual calls happen later at
   runtime once the whole module graph has finished loading. */
import { ICONS as ICON } from '../shared/icons.js';
import { state } from './state.js';
import { MAINTENANCE_MODE } from './constants.js';
import { setupHTML, attachSetupEvents, gateHTML, attachGateEvents, publicHTML, attachPublicEvents, appHTML, attachAppEvents, renderModal } from './screens.js';

export function render() {
  const root = document.getElementById('root');
  if (MAINTENANCE_MODE) {
    root.innerHTML = `<div class="loading">
      <div class="loading-crest" style="width:150px;height:150px;"><img src="assets/wolf-crest.png" alt="Alpha Suite crest" style="width:100%;height:100%;object-fit:contain;"/></div>
      <span style="font-family:'Cinzel',serif;font-weight:700;font-size:2rem;letter-spacing:.05em;">ALPHA TREASURY</span>
      <span style="font-size:1.15rem;letter-spacing:.5px;">Temporarily closed for maintenance.</span>
      <span style="opacity:.7;font-size:1rem;letter-spacing:.5px;">We'll be back soon — thanks for your patience.</span>
    </div>`;
    return;
  }
  if (state.screen === 'loading') {
    root.innerHTML = `<div class="loading">
      <div class="loading-crest"><img src="assets/wolf-crest.png" alt="Alpha Suite crest" style="width:100%;height:100%;object-fit:contain;"/></div>
      <div class="loading-ring"></div>
      <span>Loading ALPHA TREASURY…</span>
    </div>`;
    return;
  }
  if (state.screen === 'setup') { root.innerHTML = setupHTML(); attachSetupEvents(); return; }
  if (state.screen === 'gate') { root.innerHTML = gateHTML(); attachGateEvents(); return; }
  if (state.screen === 'public') { root.innerHTML = publicHTML(); attachPublicEvents(); return; }
  root.innerHTML = appHTML();
  attachAppEvents();
  if (state.modal) renderModal();
}

export function showToast(msg) { state.toast = msg; render(); setTimeout(() => { state.toast = null; renderToastOnly(); }, 2400); }
export function renderToastOnly() {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
}
