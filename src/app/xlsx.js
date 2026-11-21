/* Branded Excel export (loaded on demand so the app stays small).
   Each sheet gets: SAILS emblem banner, summary tiles, styled table, totals, print setup. */
const NAVY = 'FF0B6A22', SEA = 'FF1E7B45', FOAM = 'FFF4F9EE', BRASS = 'FFF2C200', SKY = 'FFE6F2DD', ZEBRA = 'FFF7FBF3', INK = 'FF14281A';   // SAILS emblem green and gold (the names are kept from the older navy theme)
const MONEY = '"₱"#,##0.00;[Red]-"₱"#,##0.00', INT = '#,##0';
const STATUS_FILL = { approved: ['FFE3F5EA', 'FF1E7B45'], paid: ['FFE3F5EA', 'FF1E7B45'], resolved: ['FFE3F5EA', 'FF1E7B45'], clear: ['FFE3F5EA', 'FF1E7B45'], pending: ['FFFFF1D6', 'FF9A6A00'], 'awaiting approval': ['FFFFF1D6', 'FF9A6A00'], outstanding: ['FFFBE4E1', 'FFB3342A'], owed: ['FFFBE4E1', 'FFB3342A'], voided: ['FFEDEFF2', 'FF6B7280'], rejected: ['FFEDEFF2', 'FF6B7280'] };

const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
async function crestAssets() {
  const img = await loadImg(new URL('assets/wolf-crest.png', location.href).href);
  const badge = document.createElement('canvas'); badge.width = badge.height = 160; const b = badge.getContext('2d');
  b.fillStyle = '#fff'; b.beginPath(); b.arc(80, 80, 79, 0, 7); b.fill();   // thin white ring so the emblem reads on the green banner
  b.drawImage(img, 5, 5, 150, 150);
  return { badge: badge.toDataURL('image/png').split(',')[1] };
}
const colLetter = n => { let s = ''; for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; };
const toDate = (v, type) => { if (!v) return null; const d = new Date(v); if (isNaN(d)) return null; return type === 'datetime' ? new Date(d.getTime() - d.getTimezoneOffset() * 6e4) : d; };
const rowH = (ws, r, h) => { ws.getRow(r).height = h; };

function buildSheet(wb, spec, imgs, meta) {
  const { name, title, subtitle, columns, rows, summary = [] } = spec;
  const ws = wb.addWorksheet((/^history$/i.test(name.trim()) ? name.trim() + ' log' : name).slice(0, 31), { views: [{ showGridLines: false }], properties: { tabColor: { argb: NAVY } } });
  const n = columns.length, last = colLetter(n - 1);
  const val = (r, c) => { const v = typeof c.get === 'function' ? c.get(r) : r[c.key]; return v == null ? '' : v; };
  const widths = columns.map(c => {
    const longest = Math.max(String(c.label).length + 2, ...rows.slice(0, 200).map(r => { const v = val(r, c); return c.type === 'money' ? 14 : c.type === 'date' ? 13 : c.type === 'datetime' ? 19 : String(v).length; }));
    return c.width || Math.min(44, Math.max(11, longest + 2));
  });
  ws.columns = widths.map(w => ({ width: w }));

  // banner
  ws.mergeCells(`A1:${last}1`); ws.mergeCells(`A2:${last}2`); ws.mergeCells(`A3:${last}3`);
  [1, 2, 3].forEach(r => { for (let c = 1; c <= n; c++) ws.getCell(r, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: r === 3 ? BRASS : NAVY } }; });
  const t = ws.getCell('A1'); t.value = '\u00A0'.repeat(13) + title; t.font = { name: 'Cambria', size: 20, bold: true, color: { argb: 'FFFFFFFF' } }; t.alignment = { vertical: 'middle', horizontal: 'left' };   // spaces, not indent: some viewers ignore indent on a merged cell and the badge then covers the title
  const s = ws.getCell('A2'); const sub = String(subtitle || '').replace(/^BSMT 1-Alpha\s*·?\s*/, '').replace(/Alpha Watch/g, 'Violation Watch');
  s.value = '\u00A0'.repeat(22) + (sub ? 'SAILS ’28 · ' + sub : 'SAILS ’28 · Seekers of Love Adventure Inspired by the Love of the Sea'); s.font = { name: 'Calibri', size: 11, color: { argb: 'FFDFF1F8' } }; s.alignment = { vertical: 'top', horizontal: 'left' };
  rowH(ws, 1, 40); rowH(ws, 2, 26); rowH(ws, 3, 5);
  ws.addImage(wb.addImage({ base64: imgs.badge, extension: 'png' }), { tl: { col: 0.12, row: 0.1 }, ext: { width: 62, height: 62 }, editAs: 'oneCell' });

  // summary tiles
  let r = 4;
  if (summary.length) {
    rowH(ws, r, 6); r++;
    const totalW = widths.reduce((a, w) => a + w, 0); let c0 = 1, run = 0, ci = 0;   // tiles get equal widths by column width, so a long label is not cut off
    summary.forEach(([label, value, fmt], i) => {
      while (ci < n && (i === summary.length - 1 || run + widths[ci] / 2 < (i + 1) / summary.length * totalW)) run += widths[ci++];
      const c1 = i === summary.length - 1 ? n : Math.min(n, Math.max(c0, ci));
      if (c1 > c0) { ws.mergeCells(r, c0, r, c1); ws.mergeCells(r + 1, c0, r + 1, c1); }
      const a = ws.getCell(r, c0), b = ws.getCell(r + 1, c0);
      a.value = label.toUpperCase(); a.font = { name: 'Calibri', size: 9, bold: true, color: { argb: SEA } };
      b.value = value; b.font = { name: 'Cambria', size: 16, bold: true, color: { argb: NAVY } }; if (fmt === 'money') b.numFmt = MONEY; else if (typeof value === 'number') b.numFmt = INT;
      for (let c = c0; c <= c1; c++) for (const rr of [r, r + 1]) { const cell = ws.getCell(rr, c); cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FOAM } };
        cell.border = { top: rr === r ? { style: 'medium', color: { argb: BRASS } } : undefined, left: c === c0 ? { style: 'thin', color: { argb: 'FFFFFFFF' } } : undefined }; }
      a.alignment = { horizontal: 'left', vertical: 'bottom', indent: 1 }; b.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
      c0 = c1 + 1;
    });
    rowH(ws, r, 18); rowH(ws, r + 1, 28); r += 2; rowH(ws, r, 8); r++;
  } else { rowH(ws, r, 10); r++; }

  // table header
  const hr = r;
  columns.forEach((c, i) => { const cell = ws.getCell(hr, i + 1); cell.value = c.label; cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }; cell.border = { bottom: { style: 'medium', color: { argb: BRASS } } };
    cell.alignment = { vertical: 'middle', horizontal: c.type === 'money' || c.type === 'int' ? 'right' : 'left', wrapText: true, indent: 1 }; });
  rowH(ws, hr, 26);

  // body
  rows.forEach((row, ri) => {
    const rr = hr + 1 + ri, zebra = ri % 2 === 1;
    columns.forEach((c, i) => {
      const cell = ws.getCell(rr, i + 1); let v = val(row, c);
      if (c.type === 'money') { v = v === '' ? null : +v; cell.numFmt = MONEY; }
      else if (c.type === 'int') { v = v === '' ? null : +v; cell.numFmt = INT; }
      else if (c.type === 'date') { v = toDate(v, 'date'); cell.numFmt = 'mmm d, yyyy'; }
      else if (c.type === 'datetime') { v = toDate(v, 'datetime'); cell.numFmt = 'mmm d, yyyy h:mm AM/PM'; }
      cell.value = v;
      cell.font = { name: 'Calibri', size: 11, color: { argb: INK } };
      cell.alignment = { vertical: 'middle', horizontal: c.type === 'money' || c.type === 'int' ? 'right' : c.type === 'status' ? 'center' : 'left', wrapText: c.wrap !== false && c.type !== 'money', indent: c.type === 'status' ? 0 : 1 };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFDCE8EE' } } };
      cell.fill = zebra ? { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } } : undefined;
      if (c.type === 'status') { const f = STATUS_FILL[String(v).toLowerCase()]; if (f) { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: f[0] } }; cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: f[1] } }; } }
    });
    const lines = Math.max(1, ...columns.map((c, i) => c.type === 'money' || c.type === 'int' || c.wrap === false ? 1 : String(val(row, c)).split('\n').reduce((a, ln) => a + Math.max(1, Math.ceil(ln.length / Math.max(6, widths[i] - 2))), 0)));
    rowH(ws, rr, lines > 1 ? 15 * lines + 6 : 20);   // tall enough for wrapped text, so nothing is cut off
  });
  const end = hr + rows.length;

  // totals
  let tr = end + 1;
  const sums = columns.map((c, i) => c.total ? i : -1).filter(i => i >= 0);
  if (sums.length && rows.length) {
    columns.forEach((c, i) => { const cell = ws.getCell(tr, i + 1);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SKY } }; cell.border = { top: { style: 'medium', color: { argb: NAVY } } };
      cell.font = { name: 'Calibri', size: 12, bold: true, color: { argb: NAVY } };
      if (i === 0) cell.value = 'TOTAL';
      if (c.total) { const L = colLetter(i); cell.value = { formula: `SUBTOTAL(109,${L}${hr + 1}:${L}${end})`, result: rows.reduce((a, r0) => a + (+val(r0, c) || 0), 0) }; cell.numFmt = c.type === 'money' ? MONEY : INT; cell.alignment = { horizontal: 'right' }; } });
    rowH(ws, tr, 24); tr++;
  }
  if (!rows.length) { ws.mergeCells(hr + 1, 1, hr + 1, n); const e = ws.getCell(hr + 1, 1); e.value = 'No records.'; e.font = { italic: true, color: { argb: 'FF6B7280' } }; e.alignment = { horizontal: 'center' }; rowH(ws, hr + 1, 28); tr = hr + 2; }

  // footer note
  tr++; ws.mergeCells(tr, 1, tr, n);
  const f = ws.getCell(tr, 1); f.value = `Prepared by ${meta.by} · ${meta.date} · SAILS ’28`; f.font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF6B7280' } };

  // filter, freeze, print
  ws.views = [{ showGridLines: false, state: 'frozen', ySplit: hr, topLeftCell: `A${hr + 1}` }];
  if (rows.length) ws.autoFilter = { from: { row: hr, column: 1 }, to: { row: end, column: n } };
  ws.pageSetup = { orientation: n > 6 ? 'landscape' : 'portrait', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true, printTitlesRow: `${hr}:${hr}`, margins: { left: .4, right: .4, top: .6, bottom: .7, header: .3, footer: .3 } };
  ws.headerFooter = { oddFooter: '&L&8SAILS ’28&C&8Page &P of &N&R&8&D' };
}

export async function exportXLSX({ filename, sheets, by = '', creator = 'SAILS ’28' }) {
  const [{ default: ExcelJS }, imgs] = await Promise.all([import('exceljs'), crestAssets()]);
  const wb = new ExcelJS.Workbook(); wb.creator = creator; wb.created = new Date(); wb.title = sheets[0].title;
  const meta = { by: by || 'SAILS ’28', date: new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' }) };
  sheets.forEach(sp => buildSheet(wb, sp, imgs, meta));
  const buf = await wb.xlsx.writeBuffer();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
