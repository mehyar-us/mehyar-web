// functions/api/_shared/assessmentBooking.js
//
// Post-payment follow-up booking: AI mayor -> HUMAN Mayor (R1).
// The $330 follow-up deep-dive is a personal call with Mayor himself —
// human-in-the-loop — so booking is a REQUEST/CONFIRMATION flow, never an
// auto-call and never an auto-booked calendar event.
//
// Flow:
//   1. Buyer picks a slot: GET /api/assessment/booking-availability
//      (declared office hours minus holds in assessment_bookings).
//   2. POST /api/assessment/book-followup { audit_id, access_token, slot_start }
//      verifies payment, creates the request (status=requested, slot held),
//      emails Mayor a one-click approve/decline link.
//   3. Mayor clicks approve -> status=confirmed. He gets a Google Calendar
//      template link (one click onto his calendar); the buyer is notified via
//      webhook callback to BOOKING_NOTIFY_URL (the audit crew's emailer owns
//      the buyer email — we store email_hash only) and can poll
//      GET /api/assessment/booking-status.
//   4. Decline -> hold released, buyer notified to pick another slot.
//   5. Requests older than 48h without a decision expire lazily.
//
// Confirmation mechanics — DECISION: manual approve (not auto-confirm).
// Rationale: it's his personal time, the scarcest resource; "human-in-the-loop"
// was his phrase; a $330 buyer promised a personal founder call must never eat
// an auto-booked conflict or a no-show. Tentative hold + one-click approval +
// 24h SLA keeps buyer UX acceptable. Auto-confirm inside office hours stays a
// future flip he can order.
// Calendar event creation: no server-side Google Calendar path exists in this
// runtime (hatch_gws_cli is agent-local only; the repo's /api/calendar/*
// proxies to a Zoho-backed upstream). createCalendarEvent() is the seam: today
// it returns a Google Calendar template link (+ .ics-ready fields); when the
// mehyarsoft admin API gains a Google path, wire it here.

import { sha256hex } from "./assessmentDiagnose.js";

export const BOOKING_TZ = "America/New_York";
export const BOOKING_SLOT_MINUTES = 45;
export const BOOKING_MIN_NOTICE_HOURS = 24;
export const BOOKING_REQUEST_TTL_HOURS = 48;
// Declared deep-dive office hours (0=Sun). Tune to Mayor's real availability.
export const BOOKING_OFFICE_HOURS = [
  { dow: 2, start: "10:00", end: "16:00" }, // Tue
  { dow: 4, start: "10:00", end: "16:00" }, // Thu
];
export const MAYOR_APPROVAL_EMAIL = "info@mehyar.us"; // forwards to Mayor

// Generate candidate slot starts (Date ms) for the next `days` days inside
// office hours, honoring min-notice. Pure — no I/O.
export function generateSlots({ days = 14, nowMs = Date.now() } = {}) {
  const slots = [];
  const earliest = nowMs + BOOKING_MIN_NOTICE_HOURS * 3600 * 1000;
  // Walk days in the booking timezone using Intl parts (DST-safe).
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: BOOKING_TZ, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
  });
  for (let d = 0; d < days; d++) {
    const dayMs = nowMs + d * 86400 * 1000;
    const parts = Object.fromEntries(fmt.formatToParts(new Date(dayMs)).map((p) => [p.type, p.value]));
    const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
    const oh = BOOKING_OFFICE_HOURS.find((h) => h.dow === dow);
    if (!oh) continue;
    const ymd = `${parts.year}-${parts.month}-${parts.day}`;
    for (const startMin of slotStarts(oh.start, oh.end, BOOKING_SLOT_MINUTES)) {
      const hh = String(Math.floor(startMin / 60)).padStart(2, "0");
      const mm = String(startMin % 60).padStart(2, "0");
      // Interpret the wall time in the booking TZ via offset lookup.
      const startMs = zonedTimeToMs(ymd, hh, mm);
      if (startMs >= earliest) slots.push(startMs);
    }
  }
  return slots.sort((a, b) => a - b);
}

function slotStarts(startHm, endHm, durMin) {
  const [sh, sm] = startHm.split(":").map(Number);
  const [eh, em] = endHm.split(":").map(Number);
  const out = [];
  for (let m = sh * 60 + sm; m + durMin <= eh * 60 + em; m += durMin) out.push(m);
  return out;
}

// Wall-clock YMD+HM in BOOKING_TZ -> epoch ms. Resolves the TZ offset by
// probing (handles EST/EDT without a TZ database beyond Intl).
export function zonedTimeToMs(ymd, hh, mm) {
  const guess = Date.parse(`${ymd}T${hh}:${mm}:00Z`);
  const tzName = new Intl.DateTimeFormat("en-US", { timeZone: BOOKING_TZ, timeZoneName: "shortOffset" })
    .formatToParts(new Date(guess)).find((p) => p.type === "timeZoneName")?.value || "GMT";
  const m = tzName.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  let offMin = 0;
  if (m) offMin = (m[1] === "+" ? 1 : -1) * (Number(m[2]) * 60 + Number(m[3] || 0));
  return guess - offMin * 60000;
}

export function slotsOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

// Remove slots overlapping active holds. `holds`: [{slot_start, slot_end}] ISO.
export function filterSlots(slots, holds) {
  const hs = (holds || []).map((h) => [Date.parse(h.slot_start), Date.parse(h.slot_end)]);
  return slots.filter((s) => {
    const e = s + BOOKING_SLOT_MINUTES * 60000;
    return !hs.some(([a, b]) => slotsOverlap(s, e, a, b));
  });
}

export function isoInSlots(slotStartIso, slots) {
  const t = Date.parse(slotStartIso);
  return slots.some((s) => Math.abs(s - t) < 60000);
}

// Opaque manage token (approve/decline links). Only the hash is stored.
export async function mintManageToken() {
  const raw = "abt_" + [...crypto.getRandomValues(new Uint8Array(32))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  return { token: raw, tokenHash: await sha256hex("assessment-booking|" + raw) };
}

// ── Calendar seam ───────────────────────────────────────────────────────────
// Today: no server-side Google Calendar API in this runtime. Return everything
// a human (or a future API call) needs to place the event: a one-click Google
// Calendar template link + structured fields. When the mehyarsoft admin API
// gains a Google path, POST there here and return { eventId }.
export function createCalendarEvent({ title, startIso, endIso, description, timezone = BOOKING_TZ }) {
  const fmtCal = (iso) => new Date(iso).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: `${fmtCal(startIso)}/${fmtCal(endIso)}`,
    details: description || "",
    ctz: timezone,
  });
  return {
    ok: true,
    via: "template_link", // upgrade path: "google_api"
    templateUrl: `https://calendar.google.com/calendar/render?${params.toString()}`,
    event: { title, startIso, endIso, timezone, description: description || "" },
    eventId: null,
  };
}

export function bookingEmailToMayor({ bookingId, businessName, slotStart, slotEnd, approveUrl, declineUrl, findingsSummary }) {
  const when = new Date(slotStart).toLocaleString("en-US", { timeZone: BOOKING_TZ, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
  return {
    subject: `Approve deep-dive call: ${businessName || "buyer"} — ${when} ET`,
    text:
`A $330 audit buyer requested their personal deep-dive call with you.

Business: ${businessName || "(unknown)"}
When: ${when} ET (${BOOKING_SLOT_MINUTES} min)
Booking: ${bookingId}
${findingsSummary ? `Call notes: ${findingsSummary}\n` : ""}
One click:
  APPROVE: ${approveUrl}
  DECLINE: ${declineUrl}

Approving holds the slot and notifies the buyer. This is manual on purpose — it's your calendar.`,
  };
}

// Webhook payload for the audit crew's emailer (buyer notifications).
export function bookingWebhookPayload(booking, { templateUrl = null } = {}) {
  return {
    event: `booking.${booking.status}`,
    booking_id: booking.id,
    audit_id: booking.audit_id,
    email_hash: booking.email_hash,
    business_name: booking.business_name,
    slot_start: booking.slot_start,
    slot_end: booking.slot_end,
    timezone: booking.timezone,
    calendar_template_url: templateUrl,
  };
}
