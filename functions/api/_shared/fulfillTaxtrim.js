// TEMPORARY STUB — added 2026-09-20 by the PillGuard money-path build.
//
// functions/api/pay/webhook.js (commit b1a3cf2) statically imports this
// module, but the real fulfillment module was never committed, so main's
// webhook route cannot load until this file exists. This stub keeps the
// import resolving; it is a LOUD no-op — the TaxTrim product builder must
// replace it with the real fulfillTaxtrim.js (creates the taxtrim_orders
// row, unifies the token, generates the packet / activates the watch,
// emails the buyer with a one-click TaxTrim unsubscribe; idempotent per
// payment).
//
// If this stub is ever called, something is wrong (no taxtrim SKUs exist
// in billing_products yet): it records the attempt in webhook_debug and
// throws so the failure is visible instead of silently swallowing a
// customer's payment.

export async function fulfillTaxtrim({ db, env, waitUntil, sendEmail }, payment) {
  const detail = `STUB fulfillTaxtrim called for payment ${payment && payment.id} — real module not yet committed`;
  console.error(detail);
  try {
    await db.prepare(
      "INSERT INTO webhook_debug (created_at, payment_id, step, detail) VALUES (strftime('%Y-%m-%dT%H:%M:%fZ','now'), ?, 'taxtrim_stub_called', ?)"
    ).bind(payment && payment.id, detail.slice(0, 500)).run();
  } catch {}
  throw new Error("fulfillTaxtrim STUB: real TaxTrim fulfillment module not yet committed");
}

export default fulfillTaxtrim;
