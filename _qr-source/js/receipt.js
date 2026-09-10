// =====================================================================
// Digital receipt: renders a one-page PDF for a confirmed transaction.
// Requires jsPDF loaded globally (see <script> tag in the pages) and
// the qr-render helper for the QR that links to the transaction's
// entry on the student dashboard.
// =====================================================================
import { qrToDataUrl } from './qr-render.js';

const DASHBOARD_BASE_URL = 'https://keanutugonon87-blip.github.io/alpha-suite/student-dashboard';

export async function buildReceiptPdf({ transaction, student, treasurerName }) {
  // eslint-disable-next-line no-undef
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: [320, 520] }); // slip-style receipt

  const navy = '#132A3A';
  const brass = '#B8862F';
  const ink = '#24333B';
  const inkSoft = '#5B6B72';

  let y = 36;

  doc.setTextColor(navy);
  doc.setFont('times', 'bold');
  doc.setFontSize(15);
  doc.text('BSMT 1-Alpha — Alpha Treasury', 160, y, { align: 'center' });
  y += 16;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(inkSoft);
  doc.text('Official Digital Receipt', 160, y, { align: 'center' });
  y += 18;

  doc.setDrawColor(brass);
  doc.setLineWidth(1);
  doc.line(24, y, 296, y);
  y += 20;

  doc.setFont('courier', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(ink);

  const row = (label, value) => {
    doc.setTextColor(inkSoft);
    doc.text(label, 24, y);
    doc.setTextColor(ink);
    doc.text(String(value ?? '—'), 296, y, { align: 'right' });
    y += 16;
  };

  row('Receipt No.', transaction.receipt_number);
  row('Date/Time', new Date(transaction.collected_at).toLocaleString('en-PH'));
  row('Student', student.full_name);
  row('Student ID', student.student_id);
  row('Section', student.year_section || '—');
  y += 4;
  doc.setDrawColor('#D8D0BE');
  doc.line(24, y, 296, y);
  y += 16;

  row('Purpose', transaction.purpose);
  row('Payment Mode', transaction.payment_mode.toUpperCase());
  if (transaction.payment_mode === 'gcash') {
    row('GCash Ref.', transaction.gcash_reference);
  }
  if (transaction.remarks) row('Remarks', transaction.remarks);

  y += 4;
  doc.setDrawColor('#D8D0BE');
  doc.line(24, y, 296, y);
  y += 20;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(navy);
  doc.text(`\u20B1 ${Number(transaction.amount).toFixed(2)}`, 160, y, { align: 'center' });
  y += 28;

  // QR linking back to the transaction on the student's dashboard.
  const qrUrl = `${DASHBOARD_BASE_URL}/${student.id}?txn=${transaction.id}`;
  const qrDataUrl = await qrToDataUrl(qrUrl, 200);
  const qrSize = 90;
  doc.addImage(qrDataUrl, 'PNG', 160 - qrSize / 2, y, qrSize, qrSize);
  y += qrSize + 12;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(inkSoft);
  doc.text('Scan to view this receipt on your dashboard', 160, y, { align: 'center' });
  y += 24;

  doc.setDrawColor(brass);
  doc.line(24, y, 296, y);
  y += 16;

  doc.setFont('times', 'italic');
  doc.setFontSize(10);
  doc.setTextColor(ink);
  doc.text(`Digitally signed by ${treasurerName}`, 160, y, { align: 'center' });
  y += 12;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(inkSoft);
  doc.text(new Date(transaction.collected_at).toLocaleString('en-PH'), 160, y, { align: 'center' });

  return doc;
}

export async function downloadReceiptPdf({ transaction, student, treasurerName }) {
  const doc = await buildReceiptPdf({ transaction, student, treasurerName });
  doc.save(`${transaction.receipt_number}.pdf`);
}
