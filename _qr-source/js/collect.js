// =====================================================================
// Treasurer "Collect" flow.
// Uses html5-qrcode (CDN, global `Html5Qrcode`) for the camera scanner.
// All verification and writing happens through the qr-token Edge
// Function — this file never trusts the client to compute amounts.
// =====================================================================
import { callQrTokenFunction } from './supabase-client.js';
import { getOutstandingDuesForStudent } from './dues.js';

let scannerInstance = null;

export async function startScanner(elementId, onDecoded, onError) {
  // eslint-disable-next-line no-undef
  scannerInstance = new Html5Qrcode(elementId);
  const config = { fps: 10, qrbox: { width: 240, height: 240 } };

  await scannerInstance.start(
    { facingMode: 'environment' },
    config,
    (decodedText) => {
      // Pause scanning while we process this result so we don't fire
      // repeatedly on the same code while the confirmation screen loads.
      stopScanner().finally(() => onDecoded(decodedText));
    },
    () => {
      /* per-frame decode failures are normal — ignore */
    }
  );

  return scannerInstance;
}

export async function stopScanner() {
  if (scannerInstance) {
    try {
      await scannerInstance.stop();
      await scannerInstance.clear();
    } catch {
      /* already stopped */
    }
    scannerInstance = null;
  }
}

// Verify a scanned token and, if valid, fetch the student's outstanding
// dues so the confirmation screen can pre-fill an amount.
export async function verifyScannedToken(token) {
  const result = await callQrTokenFunction('verify', { token });
  if (!result.valid) {
    return { valid: false, reason: humanizeReason(result.reason) };
  }
  const outstanding = await getOutstandingDuesForStudent(result.student.id);
  return { valid: true, student: result.student, outstanding };
}

function humanizeReason(reason) {
  const map = {
    malformed_token: 'This QR code isn\u2019t an Alpha Treasury token.',
    bad_signature: 'This token\u2019s signature doesn\u2019t match — it may be tampered or fake.',
    bad_payload: 'This token\u2019s data is corrupted.',
    student_not_found: 'No student record matches this token.',
    token_revoked: 'This QR code has been revoked.',
    token_superseded: 'This QR code is outdated — a newer one was issued for this student.',
    student_inactive: 'This student is not currently active.',
  };
  return map[reason] || 'This QR code could not be verified.';
}

// Submit the confirmed transaction. `token` must be the same one just
// verified (re-sent so the Edge Function re-checks it server-side —
// never trust the client-held "valid" flag alone).
export async function submitCollection({
  token,
  duesInstanceId,
  amount,
  paymentMode,
  gcashReference,
  purpose,
  remarks,
  transactionType,
}) {
  return callQrTokenFunction('collect', {
    token,
    dues_instance_id: duesInstanceId || null,
    amount,
    payment_mode: paymentMode,
    gcash_reference: gcashReference || null,
    purpose,
    remarks: remarks || null,
    transaction_type: transactionType,
  });
}
