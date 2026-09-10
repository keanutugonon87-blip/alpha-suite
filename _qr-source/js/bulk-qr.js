// =====================================================================
// Admin bulk QR export: pulls every active student, issues (or reuses)
// their signed token via the Edge Function, and produces either a CSV
// (student_id, full_name, token) or a printable PDF sheet of QR codes
// laid out in a grid for cutting onto ID cards / handouts.
// =====================================================================
import { supabase, callQrTokenFunction } from './supabase-client.js';
import { qrToDataUrl } from './qr-render.js';

export async function fetchActiveStudents() {
  const { data, error } = await supabase
    .from('students')
    .select('id, student_id, full_name, year_section, enrollment_status')
    .eq('enrollment_status', 'active')
    .order('full_name');
  if (error) throw error;
  return data;
}

// Issues a fresh token for every student passed in. Returns
// [{ student, token }]. Runs sequentially with a small delay to stay
// polite to the Edge Function — for a class of ~40-60 this is fast.
export async function issueTokensForStudents(students, onProgress) {
  const results = [];
  for (let i = 0; i < students.length; i++) {
    const student = students[i];
    const { token } = await callQrTokenFunction('issue', { student_id: student.id });
    results.push({ student, token });
    onProgress?.(i + 1, students.length);
  }
  return results;
}

export function buildCsv(results) {
  const header = 'student_id,full_name,year_section,token\n';
  const rows = results
    .map(
      (r) =>
        `"${r.student.student_id}","${r.student.full_name}","${r.student.year_section || ''}","${r.token}"`
    )
    .join('\n');
  return header + rows;
}

export function downloadCsv(csvText, filename = 'alpha-treasury-qr-tokens.csv') {
  const blob = new Blob([csvText], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Printable PDF sheet: a grid of QR codes, each labeled with name + ID,
// sized for cutting onto ID cards (roughly business-card sized cells).
export async function buildBulkQrPdf(results) {
  // eslint-disable-next-line no-undef
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'letter' }); // 612x792pt

  const cols = 3;
  const rows = 4;
  const marginX = 36;
  const marginY = 36;
  const cellW = (612 - marginX * 2) / cols;
  const cellH = (792 - marginY * 2) / rows;
  const qrSize = Math.min(cellW, cellH) * 0.55;

  let col = 0;
  let row = 0;

  for (let i = 0; i < results.length; i++) {
    const { student, token } = results[i];
    const x = marginX + col * cellW;
    const y = marginY + row * cellH;

    doc.setDrawColor('#D8D0BE');
    doc.rect(x + 4, y + 4, cellW - 8, cellH - 8);

    const qrDataUrl = await qrToDataUrl(token, 220);
    doc.addImage(qrDataUrl, 'PNG', x + (cellW - qrSize) / 2, y + 10, qrSize, qrSize);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor('#132A3A');
    doc.text(student.full_name, x + cellW / 2, y + qrSize + 24, { align: 'center', maxWidth: cellW - 12 });

    doc.setFont('courier', 'normal');
    doc.setFontSize(8);
    doc.setTextColor('#5B6B72');
    doc.text(student.student_id, x + cellW / 2, y + qrSize + 36, { align: 'center' });

    col++;
    if (col >= cols) {
      col = 0;
      row++;
      if (row >= rows && i < results.length - 1) {
        doc.addPage();
        row = 0;
      }
    }
  }

  return doc;
}

export async function downloadBulkQrPdf(results) {
  const doc = await buildBulkQrPdf(results);
  doc.save('alpha-treasury-qr-sheet.pdf');
}
