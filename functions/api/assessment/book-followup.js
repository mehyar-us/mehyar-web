// functions/api/assessment/book-followup.js
// POST /api/assessment/book-followup — issue the post-payment follow-up call.
//
// Body: { audit_id, access_token }
// The $330 checkout belongs to the audit-tab crew: their Stripe webhook marks
// audit_business_reports.status='paid' and their intake issued the access_token.
// This endpoint VERIFIES payment (status paid|generating|ready + token match),
// then mints a follow-up call session for the SAME WebRTC experience as the
// assessment call and returns its booking URL.
//
// Response: { ok, session_id, booking_url, kind:"followup" }
// Errors: 404 audit_not_found | 403 bad_token | 402 not_paid |
//         503 audit_engine_not_ready (their table/migration not applied yet)
//
// Integration for the audit crew (one line in their Stripe fulfill webhook):
//   await fetch("https://mehyar.us/api/assessment/book-followup",
//     { method:"POST", headers:{"content-type":"application/json"},
//       body: JSON.stringify({ audit_id, access_token }) })
//   → email the returned booking_url to the buyer.
// See docs/assessment-call-handoff.md § "Post-payment follow-up booking".

import { json, saveSession } from "../_shared/assessmentStore.js";
import { newSession } from "../_shared/assessmentBrain.js";

const PAID_STATUSES = ["paid", "generating", "ready"];
// Proposed session-issuance interface for the WebRTC call UI (infra crew to
// confirm — flagged in docs/assessment-call-contract.md).
const CALL_URL_BASE = "https://mehyar.us/call";

export async function onRequestPost({ request, env }) {
  try {
    if (!env?.LEADS_DB) return json({ ok: false, error: "service_unavailable" }, 503);
    const body = await request.json().catch(() => ({}));
    const auditId = String(body.audit_id || "");
    const accessToken = String(body.access_token || "");
    if (!auditId || !accessToken) return json({ ok: false, error: "missing_fields" }, 400);

    // The audit engine's table lives in the audit-tab crew's migration 0039.
    // If it isn't there yet (pre-merge), fail loudly — never issue calls unpaid.
    let row;
    try {
      row = await env.LEADS_DB.prepare(
        "SELECT id, email_hash, url, business_name, status, access_token FROM audit_business_reports WHERE id = ?"
      ).bind(auditId).first();
    } catch {
      return json({ ok: false, error: "audit_engine_not_ready",
        detail: "audit_business_reports table not found — the audit engine migration has not applied." }, 503);
    }
    if (!row) return json({ ok: false, error: "audit_not_found" }, 404);
    if (row.access_token !== accessToken) return json({ ok: false, error: "bad_token" }, 403);
    if (!PAID_STATUSES.includes(row.status)) {
      return json({ ok: false, error: "not_paid", detail: `audit status is "${row.status}" — follow-up calls are issued after payment only.` }, 402);
    }

    // Idempotency: one follow-up session per paid audit.
    const existing = await env.LEADS_DB.prepare(
      "SELECT id FROM assessment_sessions WHERE kind = 'followup' AND followup_of = ? LIMIT 1"
    ).bind(auditId).first().catch(() => null);
    if (existing?.id) {
      return json({ ok: true, session_id: existing.id, kind: "followup",
        booking_url: `${CALL_URL_BASE}?session=${encodeURIComponent(existing.id)}&mode=followup`, reused: true });
    }

    const session = newSession();
    session.id = crypto.randomUUID();
    session.createdAt = new Date().toISOString();
    session.kind = "followup";
    session.followupOf = auditId;
    session.businessName = row.business_name || "";
    session.url = row.url || "";
    session.emailHash = row.email_hash || null; // hash-only join; raw email never crosses
    session.consentGiven = false; // consent is re-captured on the follow-up call itself
    session.stage = "consent";
    // Context for the avatar's opening: it has READ their audit.
    session.followupContext = {
      audit_id: auditId,
      business_name: row.business_name || "",
      url: row.url || "",
    };
    await saveSession(env, session);
    return json({
      ok: true,
      session_id: session.id,
      kind: "followup",
      booking_url: `${CALL_URL_BASE}?session=${encodeURIComponent(session.id)}&mode=followup`,
    });
  } catch (e) {
    console.error("[assessment/book-followup]", e?.message);
    return json({ ok: false, error: "booking_failed" }, 500);
  }
}
