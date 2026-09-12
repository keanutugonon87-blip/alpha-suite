// =====================================================================
// Admin bulk QR export: pulls every active student, issues (or reuses)
// their signed token via the Edge Function, and produces either a CSV
// (student_id, full_name, token) or a printable PDF sheet of QR codes
// laid out in a grid for cutting onto ID cards / handouts.
// ⭐ FIXED: Added retry logic with exponential backoff + parallel QR generation
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

// ⭐ FIXED: Issues tokens with exponential backoff retry logic
// Runs sequentially with a small delay to stay polite to the Edge Function,
// but includes retry logic for network failures.
export async function issueTokensForStudents(students, onProgress, maxRetries = 3) {
  const results = [];
  
  for (let i = 0; i < students.length; i++) {
    const student = students[i];
    let token;
    let lastError;
    
    // Retry loop with exponential backoff
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await callQrTokenFunction('issue', { student_id: student.id });
        token = result.token;
        break; // Success, exit retry loop
      } catch (e) {
        lastError = e;
        
        if (attempt < maxRetries) {
          // Exponential backoff: 500ms, 1s, 2s, 4s
          const delay = Math.pow(2, attempt) * 500;
          console.warn(`Token issue failed for ${student.student_id}, retrying in ${delay}ms...`, e);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }
    
    if (!token) {
      throw new Error(
        `Failed to issue token for ${student.full_name} after ${maxRetries + 1} attempts: ${lastError?.message}`
      );
    }
    
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

// ⭐ FIXED: Parallel QR generation before PDF to avoid serial bottleneck
// Printable PDF sheet: ONE student per full page (one QR code per page),
// all pages combined into a single PDF for easy individual handout/printing.
export async function buildBulkQrPdf(results) {
  // eslint-disable-next-line no-undef
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'letter' }); // 612x792pt

  const pageW = 612;
  const pageH = 792;
  const qrSize = 320;
  const qrX = (pageW - qrSize) / 2;
  const qrY = (pageH - qrSize) / 2 - 40;

  // ⭐ PERFORMANCE FIX: Pre-generate all QR codes in parallel instead of serial
  console.log('Generating QR codes in parallel...');
  const qrDataUrls = await Promise.all(
    results.map((r, idx) => {
      console.log(`Generating QR ${idx + 1}/${results.length}...`);
      return qrToDataUrl(r.token, 600);
    })
  );
  console.log('QR code generation complete.');

  // Now add pages to PDF using pre-generated QR codes
  for (let i = 0; i < results.length; i++) {
    const { student, token } = results[i];
    const qrDataUrl = qrDataUrls[i];

    if (i > 0) doc.addPage();

    // Header
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor('#5B6B72');
    doc.text('BSMT 1-Alpha · Alpha Treasury', pageW / 2, 60, { align: 'center' });

    // Border frame around the QR for a clean cut/scan target
    doc.setDrawColor('#D8D0BE');
    doc.rect(qrX - 12, qrY - 12, qrSize + 24, qrSize + 24);

    // Add pre-generated QR image
    doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize);

    // Name
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.setTextColor('#132A3A');
    doc.text(student.full_name, pageW / 2, qrY + qrSize + 48, { align: 'center', maxWidth: pageW - 80 });

    // Student ID
    doc.setFont('courier', 'normal');
    doc.setFontSize(13);
    doc.setTextColor('#5B6B72');
    doc.text(student.student_id, pageW / 2, qrY + qrSize + 70, { align: 'center' });

    if (student.year_section) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor('#8A8578');
      doc.text(student.year_section, pageW / 2, qrY + qrSize + 88, { align: 'center' });
    }

    // Footer page counter
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor('#B8B2A0');
    doc.text(`${i + 1} / ${results.length}`, pageW / 2, pageH - 36, { align: 'center' });
  }

  return doc;
}

export async function downloadBulkQrPdf(results) {
  const doc = await buildBulkQrPdf(results);
  doc.save('alpha-treasury-qr-sheet.pdf');
}
