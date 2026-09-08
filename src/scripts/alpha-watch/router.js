/* Alpha Watch — router.js
   The top-level render() dispatcher (screen -> HTML) and the toast helper.
   Has a circular import with screens.js — safe in ES modules since neither
   side calls the other's export at module-evaluation time, only later at
   runtime once the whole module graph has finished loading. */
import { ICONS as ICON } from '../shared/icons.js';
import { state } from './state.js';
import { MAINTENANCE_MODE } from './constants.js';
import { setupHTML, attachSetupEvents, gateHTML, attachGateEvents, publicHTML, attachPublicEvents, appHTML, attachAppEvents, renderModal, runCountUps } from './screens.js';

export function render(){
  const root = document.getElementById('root');
  if(MAINTENANCE_MODE){
    root.innerHTML = `<div class="loading">
      <div class="loading-crest"><img src="assets/wolf-crest.png" alt="Alpha Suite crest" style="width:100%;height:100%;object-fit:contain;"/></div>
      <span style="font-family:'Cinzel',serif;font-weight:700;font-size:1.05rem;letter-spacing:.04em;">ALPHA WATCH</span>
      <span>Temporarily closed for maintenance.</span>
      <span style="opacity:.7;font-size:.85rem;">We'll be back soon — thanks for your patience.</span>
    </div>`;
    return;
  }
  if(state.screen==='loading'){
    root.innerHTML = `<div class="loading">
      <div class="loading-crest"><img src="assets/wolf-crest.png" alt="Alpha Suite crest" style="width:100%;height:100%;object-fit:contain;"/></div>
      <div class="loading-ring"></div>
      <span>Loading ALPHA WATCH…</span>
    </div>`;
    return;
  }
  if(state.screen==='load-error'){
    root.innerHTML = `<div class="loading">
      <div class="loading-crest"><img src="assets/wolf-crest.png" alt="Alpha Suite crest" style="width:100%;height:100%;object-fit:contain;"/></div>
      <span>Couldn't connect. Check your connection and try again.</span>
      <button class="btn-sm gold" id="retryLoadBtn" style="margin-top:14px;">${ICON.refresh||''}Retry</button>
    </div>`;
    const retryBtn = document.getElementById('retryLoadBtn');
    if(retryBtn) retryBtn.onclick = () => state.onRetryLoad && state.onRetryLoad();
    return;
  }
  if(state.screen==='setup'){ root.innerHTML = setupHTML(); attachSetupEvents(); return; }
  if(state.screen==='gate'){ root.innerHTML = gateHTML(); attachGateEvents(); return; }
  if(state.screen==='public'){ root.innerHTML = publicHTML(); attachPublicEvents(); return; }
  root.innerHTML = appHTML();
  attachAppEvents();
  if(state.modal) renderModal();
  runCountUps();
}

let toastTimer=null;
export function showToast(msg){
  state.toast=msg; render();
  if(toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>{ state.toast=null; render(); }, 2200);
}
