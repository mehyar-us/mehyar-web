// functions/api/pay/status.js
// GET /api/pay/status?token=... — READ-ONLY payment status check.
//
// Lets satellite products (e.g. Crayon Kid on crayonkid.mehyar.us) verify a
// purchase server-side before delivering personalized goods. The token is the
// payment's access_token (unguessable, per-purchase). Returns whether the
// payment is paid plus the product id, buyer email, and any checkout params
// (kid_name/theme for Crayon Kid) stored in metadata_json.
//
// This endpoint changes nothing about checkout/webhook/download — it only
// reads billing_payments.

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet({ request, env }) {
  const db = env.LEADS_DB;
  const url = new URL(request.url);
  const token = (url.searchParams.get("token") || "").trim();
  if (!token || token.length < 16) {
    return json({ ok: false, error: "invalid_token" }, 403);
  }
  if (!db || typeof db.prepare !== "function") {
    return json({ ok: false, error: "db_unavailable" }, 500);
  }
  const row = await db.prepare(
    "SELECT p.id, p.status, p.product_id, p.email, p.paid_at, p.metadata_json, b.fulfillment " +
    "FROM billing_payments p LEFT JOIN billing_products b ON b.id = p.product_id " +
    "WHERE p.access_token = ? LIMIT 1"
  ).bind(token).first();
  if (!row) {
    return json({ ok: false, error: "not_found" }, 404);
  }
  let meta = {};
  try {
    meta = JSON.parse(row.metadata_json || "{}") || {};
  } catch { /* keep empty */ }
  const out = {
    ok: true,
    paid: row.status === "paid",
    status: row.status,
    product_id: row.product_id,
    email: row.email,
    paid_at: row.paid_at || null,
    kid_name: typeof meta.kid_name === "string" ? meta.kid_name.slice(0, 60) : null,
    theme: typeof meta.theme === "string" ? meta.theme.slice(0, 60) : null,
  };
  // FloodLens: surface fulfillment readiness so the satellite success page
  // (floodlens.mehyar.us/success.html?token=) can poll and show the download
  // link the moment the report is ready.
  if (row.product_id === "floodlens-report" || row.product_id === "floodlens-3pack") {
    let order = null;
    try {
      order = await db
        .prepare("SELECT status FROM floodlens_orders WHERE payment_id = ?")
        .bind(String(row.id))
        .first();
    } catch { /* table missing pre-migration */ }
    out.order_status = order ? order.status : "pending";
    out.report_ready = order && order.status === "ready";
    out.download_url = out.report_ready
      ? `https://mehyar.us/api/floodlens/download?token=${encodeURIComponent(token)}`
      : null;
  }
  // PureTap: surface the report links and the generation status so
  // success.html can stop polling and show the download buttons.
  if (row.fulfillment === "puretap") {
    let order = null;
    try {
      order = await db.prepare(
        "SELECT status, ready_at FROM puretap_orders WHERE access_token = ?"
      ).bind(token).first();
    } catch { /* table missing pre-migration */ }
    const base = "https://puretap.mehyar.us";
    out.report_url = base + "/api/report?token=" + encodeURIComponent(token);
    out.pdf_url = base + "/api/report/pdf?token=" + encodeURIComponent(token);
    if (order) {
      out.status = order.status;
      out.paid = order.status === "ready" || order.status === "generating" || row.status === "paid";
      out.ready_at = order.ready_at || null;
    }
  }
  // PillGuard: surface the order status so the satellite success page
  // (pillguard.mehyar.us/success?token=) can stop polling and show the
  // "View my report" link the moment the report is ready.
  if (row.fulfillment === "pillguard") {
    let order = null;
    try {
      order = await db.prepare(
        "SELECT status FROM pillguard_orders WHERE access_token = ?"
      ).bind(token).first();
    } catch { /* table missing pre-migration */ }
    if (order) out.order_status = order.status;
  }
  return json(out);
}
