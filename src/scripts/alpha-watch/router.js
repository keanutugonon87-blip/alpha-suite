/* Alpha Watch — router.js
   The top-level render() dispatcher (screen -> HTML) and the toast helper.
   Has a circular import with screens.js — safe in ES modules since neither
   side calls the other's export at module-evaluation time, only later at
   runtime once the whole module graph has finished loading. */
import { ICONS as ICON } from '../shared/icons.js';
import { state } from './state.js';
import { setupHTML, attachSetupEvents, gateHTML, attachGateEvents, publicHTML, attachPublicEvents, appHTML, attachAppEvents, renderModal, runCountUps } from './screens.js';

export function render(){
  const root = document.getElementById('root');
  if(state.screen==='loading'){
    root.innerHTML = `<div class="loading">
      <div class="loading-crest">${ICON.wolf}</div>
      <div class="loading-ring"></div>
      <span>Loading ALPHA WATCH…</span>
    </div>`;
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
