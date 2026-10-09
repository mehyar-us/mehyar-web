// functions/api/_shared/assessmentBookingDecide.js
// Shared one-click approve/decline logic for Mayor's booking request emails.
// Used by booking-confirm.js and booking-decline.js (Pages Functions needs one
// file per route; the logic lives here).

import { sha256hex } from "./assessmentDiagnose.js";
import { createCalendarEvent, bookingWebhookPayload, BOOKING_TZ } from "./assessmentBooking.js";

export function decidePage(title, bodyHtml) {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>` +
    `<body style="font-family:system-ui,sans-serif;max-width:560px;margin:48px auto;padding:0 20px;color:#1a1a1a"><h1>${title}</h1>${bodyHtml}` +
    `<p style="margin-top:32px;font-size:13px;color:#666"><a href="https://mehyar.us/privacy-policy/">Privacy</a> · <a href="https://mehyar.us/terms/">Terms</a></p></body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } });
}

async function loadBooking(env, token) {
  if (!token || !String(token).startsWith("abt_")) return null;
  const h = await sha256hex("assessment-booking|" + token);
  return env.LEADS_DB.prepare("SELECT * FROM assessment_bookings WHERE manage_token_hash = ?").bind(h).first();
}

async function notifyWebhook(env, payload) {
  const url = env?.BOOKING_NOTIFY_URL;
  if (!url) return;
  try {
    await fetch(url, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(10000) });
  } catch (e) { console.error("[booking-decide] webhook failed", e?.message); }
}

// approve=true → confirm; false → decline. Idempotent; expired requests (>48h)
// can't be decided.
export async function decideBooking(env, token, approve) {
  const b = await loadBooking(env, token);
  if (!b) return decidePage("Not found", "<p>This booking link is invalid.</p>");
  if (b.status !== "requested") {
    return decidePage("Already decided", `<p>This request is already <strong>${b.status}</strong>. No further action needed.</p>`);
  }
  const ageHrs = (Date.now() - Date.parse(b.created_at)) / 3600000;
  const { BOOKING_REQUEST_TTL_HOURS } = await import("./assessmentBooking.js");
  if (ageHrs > BOOKING_REQUEST_TTL_HOURS) {
    const now = new Date().toISOString();
    await env.LEADS_DB.prepare("UPDATE assessment_bookings SET status='expired', updated_at=? WHERE id=?").bind(now, b.id).run();
    await notifyWebhook(env, bookingWebhookPayload({ ...b, status: "expired" }));
    return decidePage("Expired", "<p>This request expired (48h). The buyer has been notified to pick a new time.</p>");
  }
  const now = new Date().toISOString();
  const status = approve ? "confirmed" : "declined";
  await env.LEADS_DB.prepare(
    "UPDATE assessment_bookings SET status = ?, decided_at = ?, updated_at = ? WHERE id = ?"
  ).bind(status, now, now, b.id).run();

  if (approve) {
    const cal = createCalendarEvent({
      title: `Audit deep-dive call — ${b.business_name || "buyer"}`,
      startIso: b.slot_start, endIso: b.slot_end,
      description: `Paid $330 Audit My Business deep-dive with Mayor (booking ${b.id}).`,
      timezone: b.timezone || BOOKING_TZ,
    });
    await env.LEADS_DB.prepare("UPDATE assessment_bookings SET calendar_event_id = ? WHERE id = ?")
      .bind(cal.eventId || "template_link", b.id).run().catch(() => {});
    const when = new Date(b.slot_start).toLocaleString("en-US",
      { timeZone: b.timezone || BOOKING_TZ, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
    await notifyWebhook(env, bookingWebhookPayload({ ...b, status }, { templateUrl: cal.templateUrl }));
    return decidePage("Call confirmed",
      `<p><strong>Confirmed for ${when} ET.</strong> The buyer will be notified.</p>` +
      `<p><a href="${cal.templateUrl}" target="_blank" rel="noopener">Add to your Google Calendar (one click)</a> — no server-side Calendar API in this runtime yet; this is the human-in-the-loop step.</p>` +
      `<p style="color:#666">Booking ${b.id} · ${b.business_name || ""}</p>`);
  }
  await notifyWebhook(env, bookingWebhookPayload({ ...b, status }));
  return decidePage("Call declined",
    `<p>Declined — the slot is released and the buyer will be notified to pick another time.</p>`);
}
