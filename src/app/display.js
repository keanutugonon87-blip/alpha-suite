/* How the app looks on this phone: text size and light/dark. Remembered per device, never sent anywhere. */
const get = k => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const put = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* ignore */ } };

export const getTheme = () => (['light', 'dark'].includes(get('alpha-theme')) ? get('alpha-theme') : 'auto');
export const getTextSize = () => (+get('alpha-text') || 100);

export function applyDisplay() {
  const root = document.documentElement, th = getTheme();
  const dark = th === 'dark' || (th === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.style.colorScheme = dark ? 'dark' : 'light';
  const sz = getTextSize(); root.style.fontSize = sz === 100 ? '' : sz + '%';
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#0b1426' : '#dff1f8');
}
export const setTheme = v => { put('alpha-theme', v === 'auto' ? '' : v); applyDisplay(); };
export const setTextSize = v => { put('alpha-text', v === 100 ? '' : String(v)); applyDisplay(); };
// "Auto" follows the phone, including when the phone switches at sunset
try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => getTheme() === 'auto' && applyDisplay()); } catch { /* old browser */ }
