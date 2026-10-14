// functions/api/_shared/fc.js
// Stripe Financial Connections plumbing for Billcut (2026-10-14).
//
// Two callers:
//  - POST /api/pay/fc/session (browser, CORS *.mehyar.us): creates an FC
//    session for a PAID Billcut audit so Stripe.js can open the hosted
//    connect modal. Bank credentials are entered on Stripe's UI only.
//  - POST /api/pay/fc/data (Billcut worker, server-to-server, shared
//    secret header): syncs transactions for linked accounts or
//    disconnects them. Raw transactions pass through to the product
//    worker, which derives the audit and discards them.
//
// Data minimization: only the `transactions` permission is requested.
// Test vs live follows the audit's billing_payments row (test flag).

export async function stripeFC(env, testMode, method, path, params) {
  const key = testMode ? env.STRIPE_TEST_SECRET_KEY : env.STRIPE_SECRET_KEY;
  if (!key) throw new Error(testMode ? "stripe_test_not_configured" : "stripe_not_configured");
  const opts = { method, headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000) };
  if (params) {
    opts.headers["content-type"] = "application/x-www-form-urlencoded";
    opts.body = params.toString();
  }
  const res = await fetch("https://api.stripe.com" + path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data && data.error && data.error.message) || `stripe_${res.status}`;
    const e = new Error(msg);
    e.stripe = data && data.error;
    throw e;
  }
  return data;
}

export async function getBillcutAudit(db, token) {
  if (!token || typeof token !== "string" || token.length > 80) return null;
  const audit = await db.prepare("SELECT * FROM billcut_audits WHERE token = ?").bind(token).first();
  if (!audit) return null;
  let testMode = false;
  if (audit.payment_id) {
    const pay = await db.prepare("SELECT test FROM billing_payments WHERE id = ?").bind(audit.payment_id).first();
    if (pay) testMode = !!pay.test;
  }
  return { audit, testMode };
}

export function fcCorsHeaders(request) {
  const origin = (request.headers.get("Origin") || "").trim();
  if (/^https:\/\/([a-z0-9-]+\.)?mehyar\.us$/i.test(origin)) {
    return { "access-control-allow-origin": origin, vary: "Origin" };
  }
  return {};
}

export function fcJson(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...extra },
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Refresh + list transactions for one FC account. Returns normalized
// expense rows only: {date, amount_cents (positive = money out),
// description}. Credits and pending rows are dropped here so the caller
// never sees raw account data beyond what the audit needs.
export async function syncAccountTransactions(env, testMode, accountId) {
  const sp = new URLSearchParams();
  sp.append("features[]", "transactions");
  await stripeFC(env, testMode, "POST", `/v1/financial_connections/accounts/${accountId}/refresh`, sp);

  let txns = [];
  for (let attempt = 0; attempt < 6; attempt++) {
    txns = [];
    let startingAfter = null;
    for (let page = 0; page < 15; page++) {
      const q = new URLSearchParams({ limit: "100" });
      if (startingAfter) q.set("starting_after", startingAfter);
      const list = await stripeFC(env, testMode, "GET",
        `/v1/financial_connections/accounts/${accountId}/transactions?${q.toString()}`);
      const rows = list.data || [];
      for (const t of rows) {
        if (t.status && t.status !== "posted") continue;
        const amt = Number(t.amount) || 0;
        if (amt >= 0) continue; // credits/inflows are not charges
        const date = (t.transacted_at || t.posted_at || "").slice(0, 10);
        if (!date) continue;
        txns.push({
          date,
          amount_cents: Math.abs(Math.round(amt)),
          description: String(t.description || "Card charge").slice(0, 140),
        });
      }
      if (!list.has_more || !rows.length) break;
      startingAfter = rows[rows.length - 1].id;
    }
    if (txns.length) break;
    await sleep(2500); // refresh is async; first pulls can lag
  }
  return txns;
}

export async function getAccountSummary(env, testMode, accountId) {
  const a = await stripeFC(env, testMode, "GET", `/v1/financial_connections/accounts/${accountId}`);
  return {
    id: a.id,
    institution: (a.institution_name || "Bank").slice(0, 80),
    last4: a.last4 || "",
    subtype: a.subtype || "",
    status: a.status || "",
  };
}

export async function disconnectAccount(env, testMode, accountId) {
  try {
    await stripeFC(env, testMode, "POST", `/v1/financial_connections/accounts/${accountId}/disconnect`);
    return true;
  } catch { return false; }
}
