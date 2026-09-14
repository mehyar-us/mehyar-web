// functions/api/audit/full-report/webhook.js
// POST /api/audit/full-report/webhook — Stripe webhook.
// Verifies the signature, marks the $5 report PAID (status='paid' + paid_at),
// and triggers generation. Duplicate deliveries for the same session are
// ignored; a ready report is never downgraded or rebuilt by a re-fire.

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

import { mirrorPaymentToLedger } from "../../_shared/payFulfillment.js";

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

export async function onRequestPost({ request, env, waitUntil }) {
  try {
    if (!env?.LEADS_DB) return json({ ok: false }, 503);
    const rawBody = await request.text();
    const sig = request.headers.get("stripe-signature") || "";
    // Live secret first, test secret as fallback. The test secret lets us
    // run real end-to-end test charges (Stripe test mode) through this same
    // endpoint without touching production keys.
    const secrets = [env.STRIPE_WEBHOOK_SECRET, env.STRIPE_WEBHOOK_SECRET_TEST].filter(Boolean);
    let verified = false;
    for (const s of secrets) {
      if (await verifyStripeSignature(rawBody, sig, s)) { verified = true; break; }
    }
    if (!verified) {
      return json({ ok: false, error: "bad_signature" }, 400);
    }
    const event = JSON.parse(rawBody);
    if (event.type === "checkout.session.completed") {
      const sess = event.data && event.data.object ? event.data.object : {};
      const reportId = Number(sess.metadata && sess.metadata.report_id);
      if (reportId) {
        const row = await env.LEADS_DB.prepare(
          "SELECT id, status, stripe_session_id FROM audit_full_reports WHERE id = ?"
        ).bind(reportId).first();
        if (row) {
          // Duplicate delivery guard: same session already processed.
          const duplicate = row.stripe_session_id && row.stripe_session_id === sess.id && row.status !== "pending";
          if (!duplicate) {
            await env.LEADS_DB.prepare(
              "UPDATE audit_full_reports SET stripe_payment_intent=?, stripe_session_id=?, paid_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), status='paid', failure_reason=NULL, status_changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') " +
              "WHERE id=? AND status != 'ready'"
            ).bind(sess.payment_intent || null, sess.id || null, reportId).run();
          }
          // Trigger generation unless the report is already ready or building.
          // Runs in the background via waitUntil so Stripe gets an instant
          // 200 and multi-minute builds are never cut off mid-flight. The
          // retry endpoint + get.js stuck-recovery cover any failure here.
          if (row.status !== "ready" && row.status !== "generating" && typeof waitUntil === "function") {
            waitUntil((async () => {
              try {
                const genUrl = new URL(request.url);
                genUrl.pathname = "/api/audit/full-report/generate";
                const genResp = await fetch(genUrl.toString(), {
                  method: "POST",
                  headers: { "content-type": "application/json", authorization: "Bearer " + env.AUDIT_CRON_SECRET },
                  body: JSON.stringify({ report_id: reportId }),
                });
                const genData = await genResp.json().catch(() => ({}));
                if (!genResp.ok || !genData.ok) {
                  console.error("full-report auto-generate failed", genData && genData.error);
                  await env.LEADS_DB.prepare(
                    "UPDATE audit_full_reports SET failure_reason=? WHERE id=? AND status='paid'"
                  ).bind("generate_failed:" + String((genData && genData.error) || genResp.status).slice(0, 80), reportId).run();
                }
              } catch (e) {
                console.error("full-report auto-generate threw", e && e.message);
                try {
                  await env.LEADS_DB.prepare(
                    "UPDATE audit_full_reports SET failure_reason=? WHERE id=? AND status='paid'"
                  ).bind("generate_threw:" + String(e && e.message).slice(0, 80), reportId).run();
                } catch { /* best effort */ }
              }
            })());
          }
        }
      }
    }
    // Centralized-ledger mirror: sessions created by the shared
    // /api/pay/checkout carry metadata.payment_id. This endpoint's Stripe
    // destination is the one with proven delivery, so mirror the paid
    // marking (and digital fulfillment) into billing_payments here. The
    // dedicated /api/pay/webhook has duplicate guards, so if it ever does
    // receive the event too, double-processing is harmless.
    // mirrorPaymentToLedger never throws; the audit path above is unaffected.
    const sess = (event.data && event.data.object) ? event.data.object : {};
    await mirrorPaymentToLedger({ db: env.LEADS_DB, env }, sess);
    return json({ ok: true });
  } catch (e) {
    console.error("stripe webhook error", e && e.message);
    return json({ ok: false }, 500);
  }
}
