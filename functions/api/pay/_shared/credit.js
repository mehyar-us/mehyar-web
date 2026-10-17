// $5 Full Report credit — the single source of the eligibility rule
// (rot294 ladder, 2026-10-16). A buyer who already PAID for the $5 Full
// Report (product audit-full-report) with this same email gets $5
// credited toward the $330 Audit My Business — once per buyer: a prior
// PAID $330 row carrying the credit marker blocks a second dip.
//
// Used by POST /api/pay/checkout (enforcement: converts the credit into
// a visible Stripe discount) and POST /api/pay/credit-status (display:
// the Step-3 pay point shows the arithmetic to eligible buyers only).
// The email must arrive normalized exactly as checkout normalizes it
// (sanitized + lowercased). A lookup failure returns 0 — the credit is
// best-effort and never blocks or misstates a charge.
export async function fullReportCreditCents(db, email) {
  try {
    const five = await db.prepare(
      "SELECT id FROM billing_payments WHERE product_id = 'audit-full-report' AND email = ? AND status = 'paid' LIMIT 1"
    ).bind(email).first();
    if (!five) return 0;
    const used = await db.prepare(
      "SELECT id FROM billing_payments WHERE product_id = 'audit-my-business' AND email = ? AND status = 'paid' AND json_extract(metadata_json, '$.credit_applied') IS NOT NULL LIMIT 1"
    ).bind(email).first();
    return used ? 0 : 500;
  } catch (e) {
    return 0;
  }
}
