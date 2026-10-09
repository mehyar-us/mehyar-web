// GET /api/assessment/booking-status?booking_id=... — booking state for the
// audit crew's funnel (polling) and buyer-facing pages. No PII beyond the
// business name; the buyer is identified by booking_id + audit_id.
import { json } from "../_shared/assessmentStore.js";

export async function onRequestGet({ request, env }) {
  try {
    if (!env?.LEADS_DB) return json({ ok: false, error: "service_unavailable" }, 503);
    const bookingId = new URL(request.url).searchParams.get("booking_id") || "";
    if (!bookingId) return json({ ok: false, error: "missing_booking_id" }, 400);
    const b = await env.LEADS_DB.prepare(
      "SELECT id, audit_id, business_name, slot_start, slot_end, timezone, status, decided_at, created_at FROM assessment_bookings WHERE id = ?"
    ).bind(bookingId).first();
    if (!b) return json({ ok: false, error: "not_found" }, 404);
    return json({ ok: true, booking: b });
  } catch (e) {
    console.error("[booking-status]", e?.message);
    return json({ ok: false, error: "status_failed" }, 500);
  }
}
