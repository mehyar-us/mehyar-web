// functions/api/assessment/book-followup.js (R1 rework)
// POST /api/assessment/book-followup — REQUEST the post-payment follow-up call.
//
// The $330 follow-up deep-dive is with MAYOR HIMSELF personally (human-in-the-
// loop). This endpoint does NOT auto-book anything: it verifies payment,
// creates a booking REQUEST (status=requested, slot held), and emails Mayor a
// one-click approve/decline link. Manual approve — his personal time.
//
// Body: { audit_id, access_token, slot_start }  (slot_start ISO; must be one of
//   GET /api/assessment/booking-availability slots)
// Response: { ok, booking_id, status:"requested", slot_start, slot_end,
//             message } — buyer-facing copy: "Requested — Mayor personally
//             confirms within 24 hours."
//
// Errors: 400 missing_fields | 404 audit_not_found | 403 bad_token |
//         402 not_paid | 409 slot_unavailable | 503 audit_engine_not_ready
//
// Audit-crew integration: after their Stripe webhook marks paid, their funnel
// shows the availability picker (our GET availability), then POSTs here.
// Buyer notifications (request received / confirmed / declined) are THEIR send
// via webhook callback to BOOKING_NOTIFY_URL (we store email_hash only).

import { json } from "../_shared/assessmentStore.js";
import { sendCfEmail } from "../_shared/cfEmail.js";
import {
  BOOKING_TZ, BOOKING_SLOT_MINUTES, MAYOR_APPROVAL_EMAIL,
  generateSlots, filterSlots, isoInSlots, mintManageToken,
  bookingEmailToMayor,
} from "../_shared/assessmentBooking.js";

const PAID_STATUSES = ["paid", "generating", "ready"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function activeHolds(env) {
  try {
    const rows = await env.LEADS_DB.prepare(
      "SELECT slot_start, slot_end FROM assessment_bookings WHERE status IN ('requested','confirmed')"
    ).all();
    return rows.results || [];
  } catch { return []; }
}

async function notifyWebhook(env, payload) {
  const url = env?.BOOKING_NOTIFY_URL;
  if (!url) return { ok: false, skipped: true };
  try {
    const r = await fetch(url, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(10000),
    });
    return { ok: r.ok };
  } catch (e) {
    console.error("[book-followup] webhook failed", e?.message);
    return { ok: false, error: e?.message };
  }
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env?.LEADS_DB) return json({ ok: false, error: "service_unavailable" }, 503);
    const body = await request.json().catch(() => ({}));
    const auditId = String(body.audit_id || "");
    const accessToken = String(body.access_token || "");
    const slotStart = String(body.slot_start || "");
    if (!auditId || !accessToken || !slotStart) return json({ ok: false, error: "missing_fields" }, 400);

    let row;
    try {
      row = await env.LEADS_DB.prepare(
        "SELECT id, email_hash, url, business_name, status, access_token FROM audit_business_reports WHERE id = ?"
      ).bind(auditId).first();
    } catch {
      return json({ ok: false, error: "audit_engine_not_ready" }, 503);
    }
    if (!row) return json({ ok: false, error: "audit_not_found" }, 404);
    if (row.access_token !== accessToken) return json({ ok: false, error: "bad_token" }, 403);
    if (!PAID_STATUSES.includes(row.status)) {
      return json({ ok: false, error: "not_paid",
        detail: `audit status is "${row.status}" — booking requests open after payment only.` }, 402);
    }

    // Idempotency first: one open request per audit. A buyer retrying their own
    // slot gets their existing request back, not a 409 from their own hold.
    const existing = await env.LEADS_DB.prepare(
      "SELECT id, status FROM assessment_bookings WHERE audit_id = ? AND status IN ('requested','confirmed') LIMIT 1"
    ).bind(auditId).first().catch(() => null);
    if (existing) {
      return json({ ok: true, booking_id: existing.id, status: existing.status, reused: true,
        message: "You already have a booking request for this audit." });
    }

    // Slot must be a real, still-free availability slot.
    const slots = filterSlots(generateSlots({}), await activeHolds(env));
    if (!isoInSlots(slotStart, slots)) {
      return json({ ok: false, error: "slot_unavailable",
        message: "That time was just taken or isn't offered. Please pick another open time." }, 409);
    }
    const startMs = Date.parse(slotStart);
    const endIso = new Date(startMs + BOOKING_SLOT_MINUTES * 60000).toISOString();

    // Best-effort call notes: findings from the free assessment call, if any.
    let findingsSummary = "";
    try {
      const s = await env.LEADS_DB.prepare(
        "SELECT findings_json FROM assessment_sessions WHERE email_hash = ? ORDER BY created_at DESC LIMIT 1"
      ).bind(row.email_hash).first();
      const f = JSON.parse(s?.findings_json || "[]");
      if (f.length) findingsSummary = f.map((x) => `${x.title} (${x.severity})`).join("; ");
    } catch {}

    const bookingId = crypto.randomUUID();
    const { token, tokenHash } = await mintManageToken();
    const now = new Date().toISOString();
    await env.LEADS_DB.prepare(
      `INSERT INTO assessment_bookings
         (id, audit_id, email_hash, business_name, slot_start, slot_end, timezone, status, manage_token_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'requested', ?, ?, ?)`
    ).bind(bookingId, auditId, row.email_hash, row.business_name || null,
      new Date(startMs).toISOString(), endIso, BOOKING_TZ, tokenHash, now, now).run();

    const base = "https://mehyar.us/api/assessment";
    const mail = bookingEmailToMayor({
      bookingId, businessName: row.business_name, slotStart: new Date(startMs).toISOString(), slotEnd: endIso,
      approveUrl: `${base}/booking-confirm?token=${encodeURIComponent(token)}`,
      declineUrl: `${base}/booking-decline?token=${encodeURIComponent(token)}`,
      findingsSummary,
    });
    const sent = await sendCfEmail(env, {
      from: "MehyarSoft <team@mehyar.us>", to: MAYOR_APPROVAL_EMAIL,
      subject: mail.subject, text: mail.text, replyTo: "info@mehyar.us",
    });
    if (!sent.ok) console.error("[book-followup] mayor approval email failed", sent.error);

    const wh = await notifyWebhook(env, {
      event: "booking.requested", booking_id: bookingId, audit_id: auditId,
      email_hash: row.email_hash, business_name: row.business_name,
      slot_start: new Date(startMs).toISOString(), slot_end: endIso, timezone: BOOKING_TZ,
    });

    // BOOKING_NOTIFY_URL fallback (never silently drop a buyer's booking):
    // persist every notification outcome on the row. A booking with
    // status='requested' AND buyer_notified_at IS NULL AND
    // webhook_notified_at IS NULL is surfaced for manual follow-up by
    // GET /api/admin/center/bookings. buyer_notified_at is set only when the
    // webhook path (the audit crew's buyer send) actually accepted the event.
    const stamp = new Date().toISOString();
    try {
      await env.LEADS_DB.prepare(
        `UPDATE assessment_bookings
            SET mayor_notified_at = ?, webhook_notified_at = ?, buyer_notified_at = ?,
                updated_at = ?
          WHERE id = ?`
      ).bind(
        sent.ok ? stamp : null,
        wh.ok ? stamp : null,
        wh.ok ? stamp : null, // buyer notifications ride the webhook path
        stamp, bookingId
      ).run();
    } catch (e) {
      console.error("[book-followup] notify-outcome persist failed", e?.message);
    }
    if (!wh.ok && !wh.skipped) {
      console.error("[book-followup] BOOKING_NOTIFY_URL delivery failed for", bookingId,
        "- booking persisted, flagged for manual follow-up");
    }

    return json({
      ok: true, booking_id: bookingId, status: "requested",
      slot_start: new Date(startMs).toISOString(), slot_end: endIso, timezone: BOOKING_TZ,
      message: "Request sent — Mayor personally confirms your deep-dive call within 24 hours.",
      mayor_notified: sent.ok,
    });
  } catch (e) {
    console.error("[assessment/book-followup]", e?.message);
    return json({ ok: false, error: "booking_failed" }, 500);
  }
}

export { notifyWebhook };
