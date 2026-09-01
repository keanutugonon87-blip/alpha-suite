/* Alpha Watch — reports.js
   Ledger export: Excel (.xlsx, via the ExcelJS CDN global) and a print-ready
   HTML report. Both outputs share computeLedgerReportData() so they can
   never drift out of sync with each other. */
import { state, getViolationOffenseNumber, getViolationSanction } from './state.js';
import { roleLabel, formatDate, formatDateTime, todayISO, todayLongDate, ordinal, LOGO_PATH } from './constants.js';

// The xlsx export needs the logo as a base64 string (ExcelJS embeds images
// by buffer, not URL) — fetched once from the real asset file and cached,
// replacing the old inline `data:image/png;base64,...` constant.
let _logoBase64Cache = null;
async function fetchLogoBase64(){
  if(_logoBase64Cache) return _logoBase64Cache;
  const res = await fetch(LOGO_PATH);
  const blob = await res.blob();
  const dataUrl = await new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = ()=>resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  _logoBase64Cache = dataUrl.split(',')[1];
  return _logoBase64Cache;
}
import { showToast } from './router.js';

/* ===================== reports_calc ===================== */
export const XLSX_THEME = {
  navy:'FF0F0F4A',
  navyDark:'FF0A0A33',
  gold:'FFF0B429',
  goldLight:'FFFFF3D6',
  cream:'FFF7F4EC',
  ink:'FF14141F',
  inkSoft:'FF4A4A5E',
  line:'FFE4DFD0',
  pending:'FFD98C1F',
  pendingBg:'FFFDF1DE',
  resolved:'FF237A4F',
  resolvedBg:'FFE4F5EC',
  awaiting:'FF6D4BB5',
  awaitingBg:'FFEFE6FB',
  resolvereq:'FF0369A1',
  resolvereqBg:'FFE0F2FE',
  forwarded:'FF8A6100',
  forwardedBg:'FFFCECC2',
  white:'FFFFFFFF',
};
/* Same ordering/labels the app's Ledger tab uses, so the report reads as one workflow */
export const XLSX_STATUS_ORDER = ['awaiting_approval','resolve_requested','resolve_forwarded','pending','resolved'];
export function xlsxStatusMeta(status){
  switch(status){
    case 'resolved': return {label:'Resolved', bg:XLSX_THEME.resolvedBg, text:XLSX_THEME.resolved};
    case 'awaiting_approval': return {label:'Awaiting Approval', bg:XLSX_THEME.awaitingBg, text:XLSX_THEME.awaiting};
    case 'resolve_requested': return {label:'Resolve Requested', bg:XLSX_THEME.resolvereqBg, text:XLSX_THEME.resolvereq};
    case 'resolve_forwarded': return {label:'Awaiting VP Approval', bg:XLSX_THEME.forwardedBg, text:XLSX_THEME.forwarded};
    default: return {label:'Pending', bg:XLSX_THEME.pendingBg, text:XLSX_THEME.pending};
  }
}
export function xlsxFill(argb){ return {type:'pattern', pattern:'solid', fgColor:{argb}}; }
export function xlsxThinBorder(){
  const b = {style:'thin', color:{argb:XLSX_THEME.line}};
  return {top:b,left:b,bottom:b,right:b};
}
/* Shared data prep for both the Excel export and the print-ready report,
   so the two outputs can never silently drift out of sync with each other. */
export function computeLedgerReportData(){
  const rows = state.ledger.map(v=>{
    const st = state.roster.find(s=>s.id===v.studentId);
    const cat = state.standard.find(c=>c.id===v.categoryId);
    return {
      student: st ? st.name : 'Unknown',
      section: st ? (st.section||'—') : '—',
      checkpoint: cat ? cat.title : 'Unknown',
      date: v.date,
      time: v.time || '',
      sanction: getViolationSanction(v),
      offenseNumber: getViolationOffenseNumber(v),
      note: v.note || '',
      reportedBy: v.reportedBy || '—',
      approvedBy: v.approvedBy || '—',
      forwardedBy: v.forwardedBy || '—',
      resolvedBy: v.resolvedBy || '—',
      status: v.status || 'pending',
    };
  });

  const totalViolations = rows.length;
  const statusCounts = {};
  XLSX_STATUS_ORDER.forEach(s=>{ statusCounts[s] = 0; });
  rows.forEach(r=>{ statusCounts[r.status] = (statusCounts[r.status]||0)+1; });
  const pendingCount = statusCounts['pending']||0;
  const resolvedCount = statusCounts['resolved']||0;
  const studentsInvolved = new Set(rows.map(r=>r.student)).size;
  const byCheckpoint = {};
  rows.forEach(r=>{ byCheckpoint[r.checkpoint] = (byCheckpoint[r.checkpoint]||0)+1; });
  const topCheckpoints = Object.entries(byCheckpoint).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const bySection = {};
  rows.forEach(r=>{ bySection[r.section] = (bySection[r.section]||0)+1; });
  const sortedDates = rows.map(r=>r.date).filter(Boolean).sort();

  return { rows, totalViolations, statusCounts, pendingCount, resolvedCount, studentsInvolved, topCheckpoints, bySection, sortedDates };
}
export async function exportLedgerCSV(){
  if(state.ledger.length===0){ showToast('No violations to export yet'); return; }
  if(typeof ExcelJS==='undefined'){ showToast('Could not load the report engine — check your connection'); return; }
  showToast('Preparing report…');
  try{
    await buildAndDownloadLedgerReport();
    showToast('Report downloaded');
  }catch(err){
    console.error('Export failed:', err);
    showToast('Export failed: ' + (err && err.message ? err.message : 'unknown error'));
  }
}

export async function buildAndDownloadLedgerReport(){
  const {
    rows, totalViolations, statusCounts, pendingCount, resolvedCount,
    studentsInvolved, topCheckpoints, bySection, sortedDates
  } = computeLedgerReportData();

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ALPHA WATCH';
  workbook.created = new Date();

  // Wrap mergeCells so a redundant/overlapping merge (e.g. from odd data,
  // like two sections normalizing to the same label) never crashes the
  // whole export — it just skips that merge and logs a warning instead.
  function safeMerge(sheet, range){
    try{ sheet.mergeCells(range); }
    catch(err){ console.warn('Skipped merge (already merged/overlapping):', range, err.message); }
  }

  const logoBase64 = await fetchLogoBase64();
  const logoImageId = workbook.addImage({ base64: logoBase64, extension: 'png' });

  /* ===== Sheet 1: Summary / Cover ===== */
  const cover = workbook.addWorksheet('Summary', {
    views:[{showGridLines:false}],
    pageSetup:{orientation:'landscape', fitToPage:true, fitToWidth:1, fitToHeight:0}
  });
  cover.columns = [
    {width:9},{width:24},{width:22},{width:26},{width:22},{width:3}
  ];

  safeMerge(cover, 'B2:E2');
  cover.getRow(2).height = 46;
  for(let r=2;r<=11;r++) cover.getRow(r).height = cover.getRow(r).height || 20;

  /* Logo is confined to column A alone so it can never overlap the title text,
     regardless of how the source image's own DPI metadata gets interpreted. */
  cover.addImage(logoImageId, { tl:{col:0.15, row:1.08}, ext:{width:44, height:44} });

  const titleCell = cover.getCell('B2');
  titleCell.value = 'ALPHA WATCH';
  titleCell.font = {name:'Georgia', size:22, bold:true, color:{argb:XLSX_THEME.navy}};
  titleCell.alignment = {vertical:'middle', horizontal:'left'};

  safeMerge(cover, 'B3:E3');
  const subCell = cover.getCell('B3');
  subCell.value = 'BSMT 1-Alpha · Batch 28 — Discipline Ledger Report';
  subCell.font = {name:'Calibri', size:12, italic:true, color:{argb:XLSX_THEME.inkSoft}};

  safeMerge(cover, 'B5:C5'); cover.getCell('B5').value='Generated:'; cover.getCell('B5').font={bold:true, color:{argb:XLSX_THEME.inkSoft}};
  cover.getCell('D5').value = todayLongDate();
  safeMerge(cover, 'B6:C6'); cover.getCell('B6').value='Generated by:'; cover.getCell('B6').font={bold:true, color:{argb:XLSX_THEME.inkSoft}};
  cover.getCell('D6').value = (state.session && state.session.name) ? `${state.session.name} (${roleLabel(state.session.role)})` : '—';
  safeMerge(cover, 'B7:C7'); cover.getCell('B7').value='Report period:'; cover.getCell('B7').font={bold:true, color:{argb:XLSX_THEME.inkSoft}};
  cover.getCell('D7').value = sortedDates.length ? `${formatDate(sortedDates[0])} – ${formatDate(sortedDates[sortedDates.length-1])}` : '—';

  const statBoxes = [
    {label:'Total Violations', value:totalViolations, fill:XLSX_THEME.navy, text:XLSX_THEME.white},
    {label:'Active Pending', value:pendingCount, fill:XLSX_THEME.pendingBg, text:XLSX_THEME.pending},
    {label:'Resolved', value:resolvedCount, fill:XLSX_THEME.resolvedBg, text:XLSX_THEME.resolved},
    {label:'Students Involved', value:studentsInvolved, fill:XLSX_THEME.goldLight, text:XLSX_THEME.navyDark},
  ];
  const statCols = ['B','C','D','E'];
  const statRow = 9;
  cover.getRow(statRow).height = 26;
  cover.getRow(statRow+1).height = 30;
  statBoxes.forEach((box, i)=>{
    const col = statCols[i];
    const labelCell = cover.getCell(`${col}${statRow}`);
    labelCell.value = box.label;
    labelCell.font = {size:9, bold:true, color:{argb:box.fill===XLSX_THEME.navy?XLSX_THEME.white:box.text}};
    labelCell.fill = xlsxFill(box.fill);
    labelCell.alignment = {horizontal:'center', vertical:'middle'};
    labelCell.border = xlsxThinBorder();
    const valueCell = cover.getCell(`${col}${statRow+1}`);
    valueCell.value = box.value;
    valueCell.font = {size:18, bold:true, color:{argb:box.text}};
    valueCell.fill = xlsxFill(box.fill===XLSX_THEME.navy?XLSX_THEME.navyDark:box.fill);
    valueCell.alignment = {horizontal:'center', vertical:'middle'};
    valueCell.border = xlsxThinBorder();
  });

  /* ---- Status Breakdown: every workflow state, in the same order as the app's Ledger ---- */
  let curRow = statRow+3;
  safeMerge(cover, `B${curRow}:E${curRow}`);
  const tcS = cover.getCell(`B${curRow}`);
  tcS.value = 'Status Breakdown — Line of Authority';
  tcS.font = {bold:true, size:12, color:{argb:XLSX_THEME.navy}};
  curRow++;
  XLSX_STATUS_ORDER.forEach(status=>{
    const meta = xlsxStatusMeta(status);
    const count = statusCounts[status]||0;
    const swatch = cover.getCell(`B${curRow}`);
    swatch.value = '';
    swatch.fill = xlsxFill(meta.bg);
    swatch.border = xlsxThinBorder();
    safeMerge(cover, `C${curRow}:D${curRow}`);
    const labelC = cover.getCell(`C${curRow}`);
    labelC.value = meta.label;
    labelC.font = {color:{argb:XLSX_THEME.ink}};
    const countC = cover.getCell(`E${curRow}`);
    countC.value = count;
    countC.font = {bold:true, color:{argb:meta.text}};
    countC.alignment = {horizontal:'center'};
    curRow++;
  });

  curRow++;
  safeMerge(cover, `B${curRow}:E${curRow}`);
  const tc1 = cover.getCell(`B${curRow}`);
  tc1.value = 'Top Checkpoints';
  tc1.font = {bold:true, size:12, color:{argb:XLSX_THEME.navy}};
  curRow++;
  topCheckpoints.forEach(([title,count])=>{
    safeMerge(cover, `B${curRow}:D${curRow}`);
    cover.getCell(`B${curRow}`).value = title;
    cover.getCell(`B${curRow}`).font = {color:{argb:XLSX_THEME.ink}};
    cover.getCell(`E${curRow}`).value = count;
    cover.getCell(`E${curRow}`).font = {bold:true, color:{argb:XLSX_THEME.navy}};
    cover.getCell(`E${curRow}`).alignment = {horizontal:'center'};
    curRow++;
  });

  curRow++;
  safeMerge(cover, `B${curRow}:E${curRow}`);
  const tc2 = cover.getCell(`B${curRow}`);
  tc2.value = 'By Stewardship Section';
  tc2.font = {bold:true, size:12, color:{argb:XLSX_THEME.navy}};
  curRow++;
  Object.entries(bySection).sort((a,b)=>b[1]-a[1]).forEach(([section,count])=>{
    safeMerge(cover, `B${curRow}:D${curRow}`);
    cover.getCell(`B${curRow}`).value = section;
    cover.getCell(`B${curRow}`).font = {color:{argb:XLSX_THEME.ink}};
    cover.getCell(`E${curRow}`).value = count;
    cover.getCell(`E${curRow}`).font = {bold:true, color:{argb:XLSX_THEME.navy}};
    cover.getCell(`E${curRow}`).alignment = {horizontal:'center'};
    curRow++;
  });

  /* ===== Sheet 2: Violations (detailed ledger, grouped by workflow status) ===== */
  const sheet = workbook.addWorksheet('Violations', {
    views:[{state:'frozen', ySplit:5, showGridLines:false}],
    pageSetup:{orientation:'landscape', fitToPage:true, fitToWidth:1, fitToHeight:0}
  });
  sheet.columns = [
    {width:9}, {width:22}, {width:16}, {width:20}, {width:20}, {width:20}, {width:16}, {width:17}, {width:17}, {width:19}, {width:11}, {width:26}
  ];
  const LAST_COL = 11; // column K — Sanction
  const colLetters = ['A','B','C','D','E','F','G','H','I','J','K'];

  safeMerge(sheet, `B2:${colLetters[LAST_COL-1]}2`);
  sheet.addImage(logoImageId, { tl:{col:0.15, row:0.32}, ext:{width:30, height:30} });
  const headTitle = sheet.getCell('B2');
  headTitle.value = 'ALPHA WATCH — Discipline Ledger';
  headTitle.font = {name:'Georgia', size:15, bold:true, color:{argb:XLSX_THEME.navy}};
  headTitle.alignment = {vertical:'middle', indent:6};
  sheet.getRow(2).height = 30;

  safeMerge(sheet, `B3:${colLetters[LAST_COL-1]}3`);
  const headSub = sheet.getCell('B3');
  headSub.value = `BSMT 1-Alpha · Batch 28 — Generated ${todayLongDate()} — grouped by status per the Line of Authority`;
  headSub.font = {italic:true, size:10, color:{argb:XLSX_THEME.inkSoft}};
  headSub.alignment = {indent:6};

  const headerRowNum = 5;
  const headers = ['#','Student','Section','Checkpoint','Date & Time','Status','Reported By','Approved By','Forwarded By','Resolved By','Offense #','Sanction'];
  const headerRow = sheet.getRow(headerRowNum);
  headers.forEach((h,i)=>{
    const cell = headerRow.getCell(i+1);
    cell.value = h;
    cell.font = {bold:true, color:{argb:XLSX_THEME.white}};
    cell.fill = xlsxFill(XLSX_THEME.navy);
    cell.alignment = {vertical:'middle', horizontal: i===0?'center':'left'};
    cell.border = xlsxThinBorder();
  });
  headerRow.height = 22;

  /* Group rows into a colored band per workflow status (same order as the app's
     Ledger filter), each collapsible via Excel's row outline — most organized
     view for a report that spans the whole approval chain. */
  let r = headerRowNum + 1;
  let runningIdx = 0;
  XLSX_STATUS_ORDER.forEach(status=>{
    const groupRows = rows.filter(row=>row.status===status).sort((a,b)=> (b.date||'').localeCompare(a.date||''));
    if(groupRows.length===0) return;
    const meta = xlsxStatusMeta(status);

    safeMerge(sheet, `A${r}:${colLetters[LAST_COL-1]}${r}`);
    const bandCell = sheet.getCell(`A${r}`);
    bandCell.value = `  ${meta.label.toUpperCase()}  ·  ${groupRows.length} record${groupRows.length===1?'':'s'}`;
    bandCell.font = {bold:true, size:11, color:{argb:meta.text}};
    bandCell.fill = xlsxFill(meta.bg);
    bandCell.alignment = {vertical:'middle', indent:1};
    sheet.getRow(r).height = 20;
    r++;

    groupRows.forEach((row, i)=>{
      runningIdx++;
      const excelRow = sheet.getRow(r);
      excelRow.outlineLevel = 1;
      const values = [runningIdx, row.student, row.section, row.checkpoint, formatDateTime(row.date, row.time), meta.label, row.reportedBy, row.approvedBy, row.forwardedBy, row.resolvedBy, row.offenseNumber ? ordinal(row.offenseNumber) : '—', row.sanction];
      values.forEach((val,ci)=>{
        const cell = excelRow.getCell(ci+1);
        cell.value = val;
        cell.border = xlsxThinBorder();
        cell.alignment = {vertical:'middle', horizontal: ci===0?'center':'left', wrapText: ci===3 || ci===11};
        cell.fill = xlsxFill(i%2===0 ? XLSX_THEME.white : XLSX_THEME.cream);
        if(ci===0) cell.font = {color:{argb:XLSX_THEME.inkSoft}};
        if(ci===5){ cell.font = {bold:true, color:{argb:meta.text}}; cell.fill = xlsxFill(meta.bg); }
      });
      r++;
    });
  });
  sheet.properties.outlineLevelRow = 1;
  sheet.properties.showOutlineSymbols = true;

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const filename = `alpha-watch-violations-report-${todayISO()}.xlsx`;
  downloadBlob(blob, filename);
}

/* ===== Print-ready / PDF report =====
   Builds a standalone print document (own <html>) in a new tab and invokes
   the browser's print dialog, where "Save as PDF" produces a properly
   paginated PDF — no PDF library needed, and it always matches whatever
   the browser's print engine renders. Rows are grouped by status exactly
   like the Excel export, with @page rules and a repeating table header so
   long ledgers paginate cleanly instead of splitting a row mid-page. */

/* ===================== print_report ===================== */
export function hexFromArgb(argb){ return '#' + argb.slice(2); }
export function escapePrintHtml(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

export function printLedgerReport(){
  if(state.ledger.length===0){ showToast('No violations to print yet'); return; }
  const {
    rows, totalViolations, statusCounts, pendingCount, resolvedCount,
    studentsInvolved, topCheckpoints, bySection, sortedDates
  } = computeLedgerReportData();

  const navy = hexFromArgb(XLSX_THEME.navy);
  const gold = hexFromArgb(XLSX_THEME.gold);
  const ink = hexFromArgb(XLSX_THEME.ink);
  const inkSoft = hexFromArgb(XLSX_THEME.inkSoft);
  const line = hexFromArgb(XLSX_THEME.line);
  const cream = hexFromArgb(XLSX_THEME.cream);

  const navyDark = hexFromArgb(XLSX_THEME.navyDark);
  const statBoxes = [
    {label:'Total Violations', value:totalViolations, labelBg:navy, labelText:'#FFFFFF', valueBg:navyDark, valueText:'#FFFFFF'},
    {label:'Active Pending', value:pendingCount, labelBg:hexFromArgb(XLSX_THEME.pendingBg), labelText:hexFromArgb(XLSX_THEME.pending), valueBg:hexFromArgb(XLSX_THEME.pendingBg), valueText:hexFromArgb(XLSX_THEME.pending)},
    {label:'Resolved', value:resolvedCount, labelBg:hexFromArgb(XLSX_THEME.resolvedBg), labelText:hexFromArgb(XLSX_THEME.resolved), valueBg:hexFromArgb(XLSX_THEME.resolvedBg), valueText:hexFromArgb(XLSX_THEME.resolved)},
    {label:'Students Involved', value:studentsInvolved, labelBg:hexFromArgb(XLSX_THEME.goldLight), labelText:navy, valueBg:hexFromArgb(XLSX_THEME.goldLight), valueText:navy},
  ];

  const statusRows = XLSX_STATUS_ORDER.map(status=>{
    const meta = xlsxStatusMeta(status);
    return `<tr><td class="swatch" style="background:${hexFromArgb(meta.bg)};"></td><td>${escapePrintHtml(meta.label)}</td><td class="num">${statusCounts[status]||0}</td></tr>`;
  }).join('');

  const topCheckpointRows = topCheckpoints.map(([title,count])=>
    `<tr><td>${escapePrintHtml(title)}</td><td class="num">${count}</td></tr>`).join('');
  const bySectionRows = Object.entries(bySection).sort((a,b)=>b[1]-a[1]).map(([section,count])=>
    `<tr><td>${escapePrintHtml(section)}</td><td class="num">${count}</td></tr>`).join('');

  const headers = ['#','Student','Section','Checkpoint','Date & Time','Status','Reported By','Approved By','Forwarded By','Resolved By','Offense #','Sanction'];
  let bodyRows = '';
  let runningIdx = 0;
  XLSX_STATUS_ORDER.forEach(status=>{
    const groupRows = rows.filter(r=>r.status===status).sort((a,b)=> (b.date||'').localeCompare(a.date||''));
    if(groupRows.length===0) return;
    const meta = xlsxStatusMeta(status);
    bodyRows += `<tr class="band" style="background:${hexFromArgb(meta.bg)};color:${hexFromArgb(meta.text)};"><td colspan="${headers.length}">${escapePrintHtml(meta.label.toUpperCase())} · ${groupRows.length} record${groupRows.length===1?'':'s'}</td></tr>`;
    groupRows.forEach(row=>{
      runningIdx++;
      bodyRows += `<tr>
        <td class="num muted">${runningIdx}</td>
        <td>${escapePrintHtml(row.student)}</td>
        <td>${escapePrintHtml(row.section)}</td>
        <td>${escapePrintHtml(row.checkpoint)}</td>
        <td>${escapePrintHtml(formatDateTime(row.date, row.time))}</td>
        <td><span class="chip" style="background:${hexFromArgb(meta.bg)};color:${hexFromArgb(meta.text)};">${escapePrintHtml(meta.label)}</span></td>
        <td>${escapePrintHtml(row.reportedBy)}</td>
        <td>${escapePrintHtml(row.approvedBy)}</td>
        <td>${escapePrintHtml(row.forwardedBy)}</td>
        <td>${escapePrintHtml(row.resolvedBy)}</td>
        <td class="num">${row.offenseNumber ? escapePrintHtml(ordinal(row.offenseNumber)) : '—'}</td>
        <td>${escapePrintHtml(row.sanction)}</td>
      </tr>`;
    });
  });

  const generatedBy = (state.session && state.session.name) ? `${escapePrintHtml(state.session.name)} (${escapePrintHtml(roleLabel(state.session.role))})` : '—';
  const period = sortedDates.length ? `${formatDate(sortedDates[0])} – ${formatDate(sortedDates[sortedDates.length-1])}` : '—';

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Alpha Watch — Discipline Ledger — ${todayISO()}</title>
<style>
  @page { size: letter landscape; margin: 0.5in; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; color:${ink}; margin:0; padding:0; }
  .sheet { padding: 0 4px; }
  .head { display:table; width:100%; margin-bottom:4px; }
  .head .logo-cell { display:table-cell; width:52px; vertical-align:middle; }
  .head .title-cell { display:table-cell; vertical-align:middle; }
  .head img { width:44px; height:44px; }
  .head h1 { font-family: Georgia, serif; font-size:22px; color:${navy}; margin:0; }
  .head p { margin:2px 0 0; font-size:12px; color:${inkSoft}; font-style:italic; }
  .meta { display:table; width:100%; table-layout:fixed; margin:14px 0; font-size:12px; }
  .meta .meta-cell { display:table-cell; padding-right:20px; }
  .meta b { color:${inkSoft}; display:block; font-size:10px; text-transform:uppercase; letter-spacing:.04em; margin-bottom:2px; }
  .stat-row { display:table; width:100%; table-layout:fixed; border-spacing:8px 0; margin-bottom:18px; }
  .stat-box { display:table-cell; border-radius:8px; border:1px solid ${line}; overflow:hidden; }
  .stat-box .lbl { padding:6px 8px; font-size:10px; font-weight:700; text-align:center; }
  .stat-box .val { padding:8px; font-size:22px; font-weight:700; text-align:center; }
  .panels { display:table; width:100%; table-layout:fixed; border-spacing:24px 0; margin-bottom:20px; page-break-after: always; }
  .panel { display:table-cell; vertical-align:top; }
  .panel h2 { font-size:13px; color:${navy}; margin:0 0 8px; }
  .panel table { width:100%; border-collapse:collapse; font-size:12px; }
  .panel td { padding:4px 6px; border-bottom:1px solid ${line}; }
  .panel td.swatch { width:14px; padding:0; }
  .panel td.num { text-align:right; font-weight:700; color:${navy}; width:40px; }
  table.ledger { width:100%; border-collapse:collapse; font-size:10.5px; }
  table.ledger thead { display: table-header-group; }
  table.ledger th { background:${navy}; color:#fff; text-align:left; padding:6px 6px; font-size:10px; border:1px solid ${navy}; }
  table.ledger td { padding:5px 6px; border:1px solid ${line}; vertical-align:middle; }
  table.ledger td.num { text-align:center; }
  table.ledger td.muted { color:${inkSoft}; }
  table.ledger tr.band td { font-weight:700; font-size:11px; padding:5px 8px; border:none; }
  table.ledger tbody tr:not(.band) { page-break-inside: avoid; }
  table.ledger .chip { display:inline-block; padding:2px 8px; border-radius:999px; font-weight:700; font-size:9.5px; white-space:nowrap; }
  .footer-note { margin-top:10px; font-size:9.5px; color:${inkSoft}; }
  @media print {
    .no-print { display:none; }
  }
  .print-bar { position:sticky; top:0; background:#fff; padding:10px 4px; margin-bottom:6px; border-bottom:1px solid ${line}; display:flex; gap:8px; justify-content:flex-end; }
  .print-bar button { font-family:inherit; font-size:13px; font-weight:600; padding:8px 16px; border-radius:8px; border:1px solid ${line}; background:${navy}; color:#fff; cursor:pointer; }
  .print-bar button.secondary { background:#fff; color:${ink}; }
</style>
</head>
<body>
  <div class="print-bar no-print">
    <button class="secondary" onclick="window.close()">Close</button>
    <button onclick="window.print()">Print / Save as PDF</button>
  </div>
  <div class="sheet">
    <div class="head">
      <div class="logo-cell"><img src="${LOGO_PATH}" alt="Alpha logo"/></div>
      <div class="title-cell">
        <h1>ALPHA WATCH — Discipline Ledger</h1>
        <p>BSMT 1-Alpha · Batch 28 — grouped by status per the Line of Authority</p>
      </div>
    </div>
    <div class="meta">
      <div class="meta-cell"><b>Generated</b>${escapePrintHtml(todayLongDate())}</div>
      <div class="meta-cell"><b>Generated By</b>${generatedBy}</div>
      <div class="meta-cell"><b>Report Period</b>${escapePrintHtml(period)}</div>
    </div>
    <div class="stat-row">
      ${statBoxes.map(b=>`<div class="stat-box"><div class="lbl" style="background:${b.labelBg};color:${b.labelText};">${escapePrintHtml(b.label)}</div><div class="val" style="background:${b.valueBg};color:${b.valueText};">${b.value}</div></div>`).join('')}
    </div>
    <div class="panels">
      <div class="panel">
        <h2>Status Breakdown — Line of Authority</h2>
        <table>${statusRows}</table>
      </div>
      <div class="panel">
        <h2>Top Checkpoints</h2>
        <table>${topCheckpointRows || '<tr><td>—</td></tr>'}</table>
      </div>
      <div class="panel">
        <h2>By Stewardship Section</h2>
        <table>${bySectionRows || '<tr><td>—</td></tr>'}</table>
      </div>
    </div>
    <table class="ledger">
      <thead><tr>${headers.map(h=>`<th>${escapePrintHtml(h)}</th>`).join('')}</tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>
    <p class="footer-note">Generated by ALPHA WATCH on ${escapePrintHtml(todayLongDate())}. This report reflects the Ledger at the time of generation.</p>
  </div>
</body>
</html>`;

  const win = window.open('', '_blank');
  if(!win){ showToast('Please allow pop-ups to print the report'); return; }
  win.document.open();
  win.document.write(html);
  win.document.close();
  showToast('Opening printable report…');
}

/* Mobile-safe blob download: tries the standard anchor-click approach first,
   falls back to opening the file in a new tab (iOS Safari / in-app browsers
   often silently block a synthetic click if it happens after any await). */

/* ===================== downloadblob ===================== */
export function downloadBlob(blob, filename){
  // Older Edge/IE support (harmless no-op elsewhere)
  if(window.navigator && window.navigator.msSaveOrOpenBlob){
    window.navigator.msSaveOrOpenBlob(blob, filename);
    return;
  }
  const url = URL.createObjectURL(blob);
  try{
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    // Give the browser time to start the download/open before revoking
    setTimeout(()=>URL.revokeObjectURL(url), 4000);
  }
}
