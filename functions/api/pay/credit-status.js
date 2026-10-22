// functions/api/pay/credit-status.js
// POST /api/pay/credit-status { email } — display-side companion to the
// $5 Full Report credit. The Step-3 pay point asks this whether the
// buyer standing there is eligible (the exact rule checkout enforces,
// via _shared/credit.js) and, if so, shows the arithmetic with figures
// taken from billing_products + the credit — never from the client.
// Informational only: checkout remains the enforcer. A non-eligible or
// failed lookup simply leaves the standard pay display unchanged.

import { fullReportCreditCents } from "./_shared/credit.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function onRequestPost({ request, env }) {
  if (!env?.LEADS_DB) {
    return Response.json({ ok: false, error: "service_unavailable" }, { status: 503 });
  }
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().toLowerCase().slice(0, 254);
  if (!EMAIL_RE.test(email)) {
    return Response.json({ ok: false, error: "invalid_email" }, { status: 400 });
  }
  const db = env.LEADS_DB;
  const product = await db.prepare(
    "SELECT price_cents FROM billing_products WHERE id = 'audit-my-business' AND active = 1"
  ).first();
  if (!product) {
    return Response.json({ ok: false, error: "invalid_product" }, { status: 400 });
  }
  const creditCents = await fullReportCreditCents(db, email);
  const listCents = product.price_cents;
  return Response.json({
    ok: true,
    eligible: creditCents > 0,
    credit_cents: creditCents,
    list_cents: listCents,
    due_cents: listCents - creditCents,
  });
}
