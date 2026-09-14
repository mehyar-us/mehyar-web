// functions/api/audit/full-report/webhook.js
// POST /api/audit/full-report/webhook — Stripe webhook.
// Verifies the signature, marks the $5 report paid, and triggers generation.

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function verifyStripeSignature(rawBody, sigHeader, secret) {
  // Stripe-Signature: t=...,v1=...
  const parts = Object.fromEntries(
    String(sigHeader || "").split(",").map((kv) => { const i = kv.indexOf("="); return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()]; })
  );
  if (!parts.t || !parts.v1) return false;
  const signedPayload = parts.t + "." + rawBody;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  // Constant-time-ish compare (single v1 signature expected).
  if (hex.length !== parts.v1.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ parts.v1.charCodeAt(i);
  return diff === 0;
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env?.LEADS_DB) return json({ ok: false }, 503);
    const rawBody = await request.text();
    const sig = request.headers.get("stripe-signature") || "";
    if (!env.STRIPE_WEBHOOK_SECRET || !(await verifyStripeSignature(rawBody, sig, env.STRIPE_WEBHOOK_SECRET))) {
      return json({ ok: false, error: "bad_signature" }, 400);
    }
    const event = JSON.parse(rawBody);
    if (event.type === "checkout.session.completed") {
      const sess = event.data && event.data.object ? event.data.object : {};
      const reportId = Number(sess.metadata && sess.metadata.report_id);
      if (reportId) {
        await env.LEADS_DB.prepare(
          "UPDATE audit_full_reports SET stripe_payment_intent=?, paid_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?"
        ).bind(sess.payment_intent || null, reportId).run();
        // Trigger generation via an internal subrequest.
        try {
          const genUrl = new URL(request.url);
          genUrl.pathname = "/api/audit/full-report/generate";
          await fetch(genUrl.toString(), {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer " + env.AUDIT_CRON_SECRET },
            body: JSON.stringify({ report_id: reportId }),
            signal: AbortSignal.timeout(120000),
          });
        } catch (e) {
          console.error("full-report auto-generate failed", e && e.message);
        }
      }
    }
    return json({ ok: true });
  } catch (e) {
    console.error("stripe webhook error", e && e.message);
    return json({ ok: false }, 500);
  }
}
