// functions/api/audit/full-report/checkout.js
// POST /api/audit/full-report/checkout — create a $5 Stripe Checkout session
// for the full 25-page AI evaluation.
// Body: { email, url, business?, lead_id? }

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function sanitize(v, max) {
  return String(v || "")
    .replace(/[^ -~\u00A0-\uFFFF]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max || 200);
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env?.LEADS_DB) return json({ ok: false, error: "service_unavailable" }, 503);
    const body = await request.json().catch(() => ({}));
    const email = sanitize(body.email, 254).toLowerCase();
    const url = sanitize(body.url, 300);
    const business = sanitize(body.business, 160);
    const leadId = Number(body.lead_id) || null;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: "invalid_email" }, 400);
    if (!url) return json({ ok: false, error: "invalid_url" }, 400);

    // Stripe not yet configured — Mayor provides keys. Fail gracefully so the
    // UI can show "checkout opening soon".
    if (!env.STRIPE_SECRET_KEY) {
      return json({ ok: false, error: "stripe_not_configured", message: "Checkout is being connected — check back shortly." }, 503);
    }

    // Idempotency: reuse a recent pending row for the same email+url.
    const existing = await env.LEADS_DB.prepare(
      "SELECT id, status, stripe_session_id FROM audit_full_reports " +
      "WHERE email = ? AND url = ? AND created_at > datetime('now','-1 hour') " +
      "ORDER BY id DESC LIMIT 1"
    ).bind(email, url).first();
    if (existing && existing.status === "ready") {
      const tokRow = await env.LEADS_DB.prepare(
        "SELECT access_token FROM audit_full_reports WHERE id = ?"
      ).bind(existing.id).first();
      return json({ ok: true, already_ready: true, token: tokRow && tokRow.access_token });
    }

    let reportId = existing && existing.id ? existing.id : null;
    let accessToken = null;
    if (!reportId) {
      // Random 64-hex access token — the ONLY way to fetch this report.
      const tokBytes = new Uint8Array(32);
      crypto.getRandomValues(tokBytes);
      accessToken = [...tokBytes].map(b => b.toString(16).padStart(2, "0")).join("");
      const ins = await env.LEADS_DB.prepare(
        "INSERT INTO audit_full_reports (lead_id, email, url, business, amount_cents, currency, status, access_token) " +
        "VALUES (?, ?, ?, ?, 500, 'usd', 'pending', ?)"
      ).bind(leadId, email, url, business || null, accessToken).run();
      reportId = (ins && ins.meta && ins.meta.last_row_id) || null;
    } else {
      const tokRow = await env.LEADS_DB.prepare(
        "SELECT access_token FROM audit_full_reports WHERE id = ?"
      ).bind(reportId).first();
      accessToken = tokRow && tokRow.access_token;
    }

    // Create Stripe Checkout Session via REST (no SDK needed in Workers).
    const params = new URLSearchParams();
    params.set("payment_method_types[]", "card");
    params.set("mode", "payment");
    params.set("success_url", "https://mehyar.us/audit/report?token=" + accessToken + "&paid=1");
    params.set("cancel_url", "https://mehyar.us/audit");
    params.set("customer_email", email);
    params.set("line_items[0][price_data][currency]", "usd");
    params.set("line_items[0][price_data][product_data][name]", "Full AI Website Evaluation — 25-page report");
    params.set("line_items[0][price_data][product_data][description]", "Page-by-page grades, competitor gaps, 500% AI automation blueprint, 90-day plan.");
    params.set("line_items[0][price_data][unit_amount]", "500");
    params.set("line_items[0][quantity]", "1");
    params.set("metadata[report_id]", String(reportId));
    params.set("metadata[email]", email);
    params.set("metadata[url]", url);

    const sess = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        authorization: "Bearer " + env.STRIPE_SECRET_KEY,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
      signal: AbortSignal.timeout(15000),
    });
    const sessData = await sess.json().catch(() => ({}));
    if (!sess.ok || !sessData.id || !sessData.url) {
      console.error("stripe session failed", sessData && sessData.error && sessData.error.message);
      return json({ ok: false, error: "checkout_failed", message: "Couldn't start checkout — try again." }, 502);
    }

    await env.LEADS_DB.prepare(
      "UPDATE audit_full_reports SET stripe_session_id = ? WHERE id = ?"
    ).bind(sessData.id, reportId).run();

    return json({ ok: true, token: accessToken, checkout_url: sessData.url });
  } catch (e) {
    console.error("full-report checkout error", e && e.message);
    return json({ ok: false, error: "checkout_failed" }, 500);
  }
}
