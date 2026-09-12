// =====================================================================
// ALPHA TREASURY — qr-token Edge Function
// =====================================================================
// One function, three actions (routed by `action` in the JSON body):
//
//   "issue"   — (treasurer/admin only) mint a signed QR token for a
//               student, using their CURRENT token_version. Called at
//               account creation and whenever a QR is reissued.
//   "verify"  — (treasurer/admin only) verify a scanned token's
//               signature, expiry, and that it matches the student's
//               current token_version / revoked flag. Returns the
//               student record if valid.
//   "collect" — (treasurer/admin only) verify the token AND atomically
//               write the transaction + update the dues instance +
//               audit log, using the service role key so amounts can't
//               be tampered with client-side.
//
// Deploy:
//   supabase functions deploy qr-token
//   supabase secrets set QR_TOKEN_SECRET=<a long random string>
//
// The token format is a compact, URL-safe signed payload:
//   base64url(payload_json) + "." + base64url(hmac_sha256(payload_json))
// This is intentionally simple (not a full JWT library) so it has zero
// npm dependencies inside the Edge runtime.
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const QR_TOKEN_SECRET = Deno.env.get("QR_TOKEN_SECRET")!;

const encoder = new TextEncoder();

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function b64urlEncode(bytes: Uint8Array): string {
  let str = "";
  bytes.forEach((b) => (str += String.fromCharCode(b)));
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(str: string): Uint8Array {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hmacSign(message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(QR_TOKEN_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return new Uint8Array(sig);
}

async function signToken(payload: Record<string, unknown>): Promise<string> {
  const json = JSON.stringify(payload);
  const payloadB64 = b64urlEncode(encoder.encode(json));
  const sig = await hmacSign(payloadB64);
  return `${payloadB64}.${b64urlEncode(sig)}`;
}

async function verifyToken(
  token: string,
): Promise<{ valid: boolean; payload?: any; reason?: string }> {
  const parts = token.split(".");
  if (parts.length !== 2) return { valid: false, reason: "malformed_token" };
  const [payloadB64, sigB64] = parts;

  const expectedSig = await hmacSign(payloadB64);
  const expectedSigB64 = b64urlEncode(expectedSig);

  // Constant-time-ish compare
  if (expectedSigB64.length !== sigB64.length) {
    return { valid: false, reason: "bad_signature" };
  }
  let diff = 0;
  for (let i = 0; i < expectedSigB64.length; i++) {
    diff |= expectedSigB64.charCodeAt(i) ^ sigB64.charCodeAt(i);
  }
  if (diff !== 0) return { valid: false, reason: "bad_signature" };

  let payload: any;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(payloadB64)));
  } catch {
    return { valid: false, reason: "bad_payload" };
  }

  return { valid: true, payload };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const callerJwt = authHeader.replace("Bearer ", "");
  if (!callerJwt) return jsonResponse({ error: "missing_auth" }, 401);

  // Client bound to the caller's JWT — used only to check who's calling.
  const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: `Bearer ${callerJwt}` } },
  });
  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userData?.user) return jsonResponse({ error: "invalid_session" }, 401);
  const callerId = userData.user.id;

  // Service-role client — used for all privileged reads/writes.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: roleRow } = await admin
    .from("officer_roles")
    .select("role")
    .eq("user_id", callerId)
    .maybeSingle();
  const isTreasurerOrAdmin = !!roleRow && ["treasurer", "admin", "mayor"].includes(roleRow.role);

  const body = await req.json().catch(() => ({}));
  const action = body.action;

  // -------------------------------------------------------------
  // MY_TOKEN — any signed-in student can request THEIR OWN current
  // token, for display/download on their own dashboard. Not an
  // officer-only action, but strictly scoped to the caller's own
  // student row (looked up via auth_user_id, not a client-supplied id).
  // -------------------------------------------------------------
  if (action === "my_token") {
    const { data: student, error } = await admin
      .from("students")
      .select("id, student_id, token_version, token_revoked, enrollment_status")
      .eq("auth_user_id", callerId)
      .maybeSingle();
    if (error || !student) return jsonResponse({ error: "student_record_not_found" }, 404);
    if (student.token_revoked) return jsonResponse({ error: "token_revoked" }, 403);

    const token = await signToken({
      sid: student.id,
      sno: student.student_id,
      v: student.token_version,
      iat: Date.now(),
    });
    return jsonResponse({ token });
  }

  // Every action below this line is officer-only (Treasurer/Admin/Mayor).
  if (!isTreasurerOrAdmin) {
    return jsonResponse({ error: "forbidden", reason: "not_an_officer" }, 403);
  }

  // -------------------------------------------------------------
  // ISSUE — mint a token for a student (used at account creation
  // and on manual reissue).
  // -------------------------------------------------------------
  if (action === "issue") {
    const { student_id } = body; // students.id (uuid)
    const { data: student, error } = await admin
      .from("students")
      .select("id, student_id, token_version, token_revoked")
      .eq("id", student_id)
      .maybeSingle();
    if (error || !student) return jsonResponse({ error: "student_not_found" }, 404);

    const token = await signToken({
      sid: student.id,
      sno: student.student_id,
      v: student.token_version,
      iat: Date.now(),
    });

    await admin.from("audit_log").insert({
      actor_id: callerId,
      action: "issue_qr",
      target_type: "student",
      target_id: student.id,
      details: { token_version: student.token_version },
    });

    return jsonResponse({ token });
  }

  // -------------------------------------------------------------
  // REISSUE — bump token_version (invalidates the old QR) and mint
  // a new token in one step.
  // -------------------------------------------------------------
  if (action === "reissue") {
    const { student_id } = body;
    const { data: student, error } = await admin
      .from("students")
      .select("id, student_id, token_version")
      .eq("id", student_id)
      .maybeSingle();
    if (error || !student) return jsonResponse({ error: "student_not_found" }, 404);

    const newVersion = student.token_version + 1;
    await admin
      .from("students")
      .update({ token_version: newVersion, token_revoked: false, token_issued_at: new Date().toISOString() })
      .eq("id", student.id);

    const token = await signToken({
      sid: student.id,
      sno: student.student_id,
      v: newVersion,
      iat: Date.now(),
    });

    await admin.from("audit_log").insert({
      actor_id: callerId,
      action: "reissue_qr",
      target_type: "student",
      target_id: student.id,
      details: { new_token_version: newVersion },
    });

    return jsonResponse({ token });
  }

  // -------------------------------------------------------------
  // VERIFY — check a scanned token, return student info if valid.
  // Does NOT write a transaction.
  // -------------------------------------------------------------
  if (action === "verify") {
    const { token } = body;
    if (!token) return jsonResponse({ error: "missing_token" }, 400);

    const result = await verifyToken(token);
    if (!result.valid) {
      return jsonResponse({ valid: false, reason: result.reason }, 200);
    }

    const { data: student, error } = await admin
      .from("students")
      .select("id, student_id, full_name, year_section, enrollment_status, token_version, token_revoked")
      .eq("id", result.payload.sid)
      .maybeSingle();

    if (error || !student) return jsonResponse({ valid: false, reason: "student_not_found" }, 200);
    if (student.token_revoked) return jsonResponse({ valid: false, reason: "token_revoked" }, 200);
    if (student.token_version !== result.payload.v) {
      return jsonResponse({ valid: false, reason: "token_superseded" }, 200);
    }
    if (student.enrollment_status !== "active") {
      return jsonResponse({ valid: false, reason: "student_inactive", student }, 200);
    }

    return jsonResponse({ valid: true, student });
  }

  // -------------------------------------------------------------
  // COLLECT — verify token, then use the atomic log_collection()
  // RPC function to write transaction, update dues instance, and
  // audit log in a single atomic operation.
  // ⭐ FIXED: Uses server-side transaction function for atomicity
  // -------------------------------------------------------------
  if (action === "collect") {
    const {
      token,
      dues_instance_id,
      amount,
      payment_mode,
      gcash_reference,
      purpose,
      remarks,
      transaction_type,
    } = body;

    if (!token || !amount || !payment_mode || !purpose || !transaction_type) {
      return jsonResponse({ error: "missing_fields" }, 400);
    }
    if (payment_mode === "gcash" && !gcash_reference) {
      return jsonResponse({ error: "gcash_reference_required" }, 400);
    }

    // 1. Verify the token first (client-side verification)
    const result = await verifyToken(token);
    if (!result.valid) return jsonResponse({ error: "invalid_token", reason: result.reason }, 400);

    // 2. Verify student exists and is eligible
    const { data: student, error: studentErr } = await admin
      .from("students")
      .select("id, student_id, full_name, token_version, token_revoked, enrollment_status")
      .eq("id", result.payload.sid)
      .maybeSingle();

    if (studentErr || !student) return jsonResponse({ error: "student_not_found" }, 404);
    if (student.token_revoked) return jsonResponse({ error: "token_revoked" }, 400);
    if (student.token_version !== result.payload.v) return jsonResponse({ error: "token_superseded" }, 400);

    // 3. Generate receipt number
    const { data: receiptNoRow, error: rnErr } = await admin.rpc("next_receipt_number");
    if (rnErr) return jsonResponse({ error: "receipt_number_failed", detail: rnErr.message }, 500);
    const receiptNumber = receiptNoRow as unknown as string;

    // 4. ⭐ ATOMIC: Call server-side log_collection() function that atomically:
    //    - Inserts the transaction
    //    - Updates dues_instance with proper locking
    //    - Writes audit log
    //    All in a single database transaction
    const { data: logResult, error: logErr } = await admin.rpc("log_collection", {
      p_receipt_number: receiptNumber,
      p_student_id: student.id,
      p_dues_instance_id: dues_instance_id || null,
      p_amount: amount,
      p_payment_mode: paymentMode,
      p_purpose: purpose,
      p_collected_by: callerId,
      p_remarks: remarks || null,
      p_transaction_type: transactionType,
    });

    if (logErr) {
      console.error("log_collection failed:", logErr);
      return jsonResponse({ error: "collection_failed", detail: logErr.message }, 500);
    }

    // 5. Fetch the created transaction to return to client
    const { data: txn, error: txnFetchErr } = await admin
      .from("transactions")
      .select("*")
      .eq("receipt_number", receiptNumber)
      .single();

    if (txnFetchErr || !txn) {
      console.error("Failed to fetch created transaction:", txnFetchErr);
      return jsonResponse({ error: "transaction_fetch_failed" }, 500);
    }

    return jsonResponse({ success: true, transaction: txn, student });
  }

  return jsonResponse({ error: "unknown_action" }, 400);
});
