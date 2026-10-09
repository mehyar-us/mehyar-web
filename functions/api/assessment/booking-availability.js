// functions/api/assessment/booking-availability.js
// GET /api/assessment/booking-availability?days=14 — open deep-dive slots.
//
// Slots come from declared office hours (assessmentBooking.js) minus active
// holds (requested/confirmed). Labeled honestly: "times Mayor holds for audit
// deep-dives" — NOT full-calendar freebusy (no server-side Google Calendar
// path in this runtime); the manual-approve step is the backstop for conflicts.

import { json } from "../_shared/assessmentStore.js";
import { generateSlots, filterSlots, BOOKING_TZ, BOOKING_SLOT_MINUTES } from "../_shared/assessmentBooking.js";

export async function onRequestGet({ request, env }) {
  try {
    if (!env?.LEADS_DB) return json({ ok: false, error: "service_unavailable" }, 503);
    const days = Math.max(1, Math.min(Number(new URL(request.url).searchParams.get("days") || 14), 30));
    let holds = [];
    try {
      const rows = await env.LEADS_DB.prepare(
        "SELECT slot_start, slot_end FROM assessment_bookings WHERE status IN ('requested','confirmed')"
      ).all();
      holds = rows.results || [];
    } catch { /* table not migrated yet → all slots open */ }
    const slots = filterSlots(generateSlots({ days }), holds);
    return json({
      ok: true,
      timezone: BOOKING_TZ,
      slot_minutes: BOOKING_SLOT_MINUTES,
      slots: slots.map((ms) => ({
        start: new Date(ms).toISOString(),
        end: new Date(ms + BOOKING_SLOT_MINUTES * 60000).toISOString(),
      })),
    }, 200);
  } catch (e) {
    console.error("[booking-availability]", e?.message);
    return json({ ok: false, error: "availability_failed" }, 500);
  }
}
