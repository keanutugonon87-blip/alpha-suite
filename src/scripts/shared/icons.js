/* Alpha Suite — shared SVG icon set (icons.js)
   Deduplicated union of the icon sets from Alpha Watch and Alpha Treasury.
   Both apps' inline ICON objects were byte-identical for shared keys, so a
   single source of truth replaces two copies. Values are raw SVG strings
   (no build step needed) — import and drop straight into template HTML.

   Shared keys (13): cash, check, checklist, clock, crown, home, key, list, plus, search, send, trash, users
   Alpha Watch-only (8): camera, clipboard, download, edit, flame, medal, pen, wolf
   Alpha Treasury-only (7): chest, down, image, paperclip, shield, up, x */
export const ICONS = {
  camera: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8a2 2 0 012-2h1.2l.9-1.5A2 2 0 0110 3.5h4a2 2 0 011.9 1L16.8 6H18a2 2 0 012 2v9a2 2 0 01-2 2H6a2 2 0 01-2-2z"/><circle cx="12" cy="13" r="3.4"/></svg>`,
  cash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 9v.01M18 15v.01"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`,
  checklist: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h.01M8 12h.01M8 16h.01"/><path d="M11 8h5M11 12h5M11 16h5"/></svg>`,
  chest: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="9" width="18" height="11" rx="2"/><path d="M3 13h18"/><path d="M7 9V7a5 5 0 0110 0v2"/><circle cx="12" cy="14.5" r="1.4" fill="currentColor" stroke="none"/></svg>`,
  clipboard: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3a1 1 0 011-1h4a1 1 0 011 1v1"/><path d="M9 11l2 2 4-4"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>`,
  crown: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18h18M4 18l-1-9 5 4 4-7 4 7 5-4-1 9"/></svg>`,
  down: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M6 13l6 6 6-6"/></svg>`,
  download: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0l-4.5-4.5M12 15l4.5-4.5"/><path d="M4 18v1.5A1.5 1.5 0 005.5 21h13a1.5 1.5 0 001.5-1.5V18"/></svg>`,
  edit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>`,
  flame: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2c1.5 3 4.5 4.5 4.5 8.5a4.5 4.5 0 01-9 0c0-1 .3-1.8.8-2.6.3.9 1 1.6 1.7 1.6-.3-2 .3-4.4 2-7.5z"/><path d="M9.5 16.5a2.5 2.5 0 005 0c0-1.2-.8-2-1.5-3-.5 1-1.7 1.6-2 2.2-.3.3-1.5.9-1.5.8z"/></svg>`,
  home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>`,
  image: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.7"/><path d="M21 15l-5-5-9 9"/></svg>`,
  key: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4.5"/><path d="M11.2 11.8L20 3M15.5 7.5L18 10M18.5 4.5L21 7"/></svg>`,
  list: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/></svg>`,
  medal: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="14.5" r="6"/><path d="M9.5 9.5L7 3h3l2 4.5L14 3h3l-2.5 6.5"/><path d="M12 11.5l1.2 2.4 2.6.4-1.9 1.9.5 2.6-2.4-1.3-2.4 1.3.5-2.6L8 14.3l2.6-.4z"/></svg>`,
  paperclip: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.4 11.1l-9 9a5 5 0 01-7-7l9-9a3.5 3.5 0 015 5l-9 9a2 2 0 01-3-3l8-8"/></svg>`,
  pen: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
  search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>`,
  send: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></svg>`,
  shield: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v6c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6l7-3z"/><path d="M9.5 12l1.8 1.8L15 10"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m-9 0v14a1 1 0 001 1h8a1 1 0 001-1V6"/></svg>`,
  up: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg>`,
  users: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M2.5 20c0-4 3-6.5 6.5-6.5s6.5 2.5 6.5 6.5"/><circle cx="17.5" cy="9" r="2.6"/><path d="M15.5 13.3c2.6.3 4.7 2.5 4.7 6.2"/></svg>`,
  wolf: `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M50 8 L62 30 C68 34 72 40 71 48 L82 46 C78 54 70 58 64 58 L58 90 L44 90 L40 60 C30 60 20 54 16 44 L28 46 C27 38 32 32 38 29 L38 16 L44 24 L50 8Z" fill="var(--gold,#f0b429)"/>
    <circle cx="52" cy="34" r="2.4" fill="var(--navy-950,#0a0a33)"/>
  </svg>`,
  x: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>`,
};
