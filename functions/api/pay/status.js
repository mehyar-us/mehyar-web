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

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
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
    "SELECT p.id, p.status, p.product_id, p.email, p.paid_at, p.metadata_json " +
    "FROM billing_payments p WHERE p.access_token = ? LIMIT 1"
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
  return json(out);
}
