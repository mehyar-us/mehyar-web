// functions/api/pay/fc/session.js
// POST /api/pay/fc/session { audit_token }
// Creates a Stripe Financial Connections session for a PAID Billcut
// audit (status paid|monitor). The browser passes client_secret to
// Stripe.js collectFinancialConnectionsAccounts(); the bank login
// happens entirely on Stripe's hosted UI. Only the `transactions`
// permission is requested (data minimization).

import { stripeFC, getBillcutAudit, fcCorsHeaders, fcJson } from "../../_shared/fc.js";

export async function onRequestOptions({ request }) {
  return new Response(null, {
    status: 204,
    headers: {
      ...fcCorsHeaders(request),
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "86400",
    },
  });
}

export async function onRequestPost({ request, env }) {
  const cors = fcCorsHeaders(request);
  const J = (d, s = 200) => fcJson(d, s, cors);
  try {
    if (!env?.LEADS_DB) return J({ ok: false, error: "service_unavailable" }, 503);
    const db = env.LEADS_DB;
    const body = await request.json().catch(() => ({}));
    const found = await getBillcutAudit(db, body.audit_token);
    if (!found) return J({ ok: false, error: "audit_not_found" }, 404);
    const { audit, testMode } = found;
    if (audit.deleted_at) return J({ ok: false, error: "audit_deleted" }, 410);
    if (!["paid", "monitor"].includes(audit.status)) {
      return J({ ok: false, error: "audit_not_paid" }, 402);
    }

    // Reuse or create the Stripe customer that holds the FC accounts.
    let customerId = audit.fc_customer_id || null;
    if (!customerId) {
      const sp = new URLSearchParams();
      if (audit.email) sp.set("email", audit.email);
      sp.set("description", "Billcut audit " + audit.token.slice(0, 8));
      sp.set("metadata[billcut_audit]", audit.token);
      const cust = await stripeFC(env, testMode, "POST", "/v1/customers", sp);
      customerId = cust.id;
      await db.prepare("UPDATE billcut_audits SET fc_customer_id = ? WHERE token = ?")
        .bind(customerId, audit.token).run();
    }

    const sp = new URLSearchParams();
    sp.set("account_holder[type]", "customer");
    sp.set("account_holder[customer]", customerId);
    sp.append("permissions[]", "transactions");
    sp.append("filters[countries][]", "US");
    const sess = await stripeFC(env, testMode, "POST", "/v1/financial_connections/sessions", sp);

    const publishable = testMode ? env.STRIPE_TEST_PUBLISHABLE_KEY : env.STRIPE_PUBLISHABLE_KEY;
    if (!publishable) return J({ ok: false, error: "publishable_not_configured" }, 503);
    return J({ ok: true, client_secret: sess.client_secret, publishable_key: publishable, test: testMode });
  } catch (e) {
    console.error("pay/fc/session error", e && e.message);
    return J({ ok: false, error: "fc_session_failed", message: String((e && e.message) || e).slice(0, 200) }, 502);
  }
}
