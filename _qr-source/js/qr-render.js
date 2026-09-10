// =====================================================================
// Renders a QR code into a <canvas> or returns a data URL, using the
// `qrcode` CDN library (loaded as a global `QRCode` via <script> tag —
// see pages for the CDN <script src>).
// This module never SIGNS anything — it only draws whatever string
// (a signed token, or a URL) it's given. Signing happens server-side
// in the qr-token Edge Function.
// =====================================================================

export async function renderQrToCanvas(canvas, text, size = 260) {
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line no-undef
    QRCode.toCanvas(canvas, text, { width: size, margin: 1 }, (err) => {
      if (err) reject(err);
      else resolve(canvas);
    });
  });
}

export async function qrToDataUrl(text, size = 260) {
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line no-undef
    QRCode.toDataURL(text, { width: size, margin: 1 }, (err, url) => {
      if (err) reject(err);
      else resolve(url);
    });
  });
}
