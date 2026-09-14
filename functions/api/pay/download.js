// functions/api/pay/download.js
// GET /api/pay/download?token=... — token-gated digital delivery.
// Verifies the token against a PAID billing_payments row, then redirects
// to the product's file. Tokens are per-purchase and unguessable; the file
// itself also lives under an unguessable name.

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
  const payment = await db.prepare(
    "SELECT bp.digital_file, bp.name FROM billing_payments p " +
    "JOIN billing_products bp ON bp.id = p.product_id " +
    "WHERE p.access_token = ? AND p.status = 'paid' LIMIT 1"
  ).bind(token).first();
  if (!payment || !payment.digital_file) {
    return json({ ok: false, error: "not_found" }, 404);
  }
  const fileUrl = new URL(payment.digital_file, url.origin).toString();
  return Response.redirect(fileUrl, 302);
}
