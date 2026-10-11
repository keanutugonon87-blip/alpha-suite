/* Web Push opt-in for notice alerts. The server side lives in the notify-announcement edge function. */
import { sb } from './core.js';
const KEY = 'BOQaHU0PjUlHp13Ic-tP7S-egVHyqnVW16eB3QBBvNrmQNntI3kbJCuK_K4TU7vxu_98Hs-jzcGwQwqRApgMJfQ';
const b64 = s => { const p = '='.repeat((4 - s.length % 4) % 4), r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(r, c => c.charCodeAt(0)); };
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const ios = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export async function pushState() {
  if (!('serviceWorker' in navigator) || !('Notification' in window) || (location.protocol !== 'https:' && location.hostname !== 'localhost')) return 'unsupported';
  if (!('PushManager' in window)) return ios() && !standalone() ? 'ios-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  try { const reg = await navigator.serviceWorker.getRegistration(); if (reg && await reg.pushManager.getSubscription()) return 'on'; } catch { /* treat as off */ }
  return 'off';
}
export async function enablePush(staff = false) {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications were not allowed. You can change this in your browser settings.');
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(KEY) });
  const j = sub.toJSON();
  const { error } = await sb.rpc(staff ? 'v2_push_subscribe_staff' : 'v2_push_subscribe', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
  if (error) throw error;
}
export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration(), sub = reg && await reg.pushManager.getSubscription();
  if (sub) { await sb.rpc('v2_push_unsubscribe', { p_endpoint: sub.endpoint }); await sub.unsubscribe(); }
}
