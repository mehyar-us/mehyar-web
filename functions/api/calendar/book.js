import { callMehyarsoftAdmin } from "../_shared/upstreamAdmin.js";
import { sendCloudflareEmail } from "../_shared/cloudflareEmail.js";
import { verifyTurnstile } from "../_shared/turnstile.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type" } });
}

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get("origin");
  const allowed = new Set(["https://mehyar.us", "https://www.mehyar.us", "http://localhost:5173", "http://127.0.0.1:5173"]);
  if (origin && !allowed.has(origin) && !(env?.ENVIRONMENT !== "production" && origin.endsWith(".pages.dev"))) {
    return Response.json({ ok: false, error: "origin_not_allowed" }, { status: 403 });
  }
  if (!(request.headers.get("content-type") || "").includes("application/json")) {
    return Response.json({ ok: false, error: "json_required" }, { status: 415 });
  }
  const body = await request.json().catch(() => ({}));
  const name = clean(body.name, 120);
  const email = clean(body.email, 254).toLowerCase();
  const phone = clean(body.phone, 60);
  const company = clean(body.company || body.business_name, 160);
  const service = clean(body.service_interest || body.service, 160) || "Consulting call";
  const notes = clean(body.message || body.notes, 2500);
  const start = new Date(body.start);
  if (!name || !EMAIL_RE.test(email) || !Number.isFinite(start.getTime()) || body.consent_contact !== true) {
    return Response.json({ ok: false, error: "required_fields_missing" }, { status: 400 });
  }
  if (!(await verifyTurnstile(env, request, body.turnstile_token))) {
    return Response.json({ ok: false, error: "turnstile_failed" }, { status: 400 });
  }
  if (!env?.LEADS_DB) return Response.json({ ok: false, error: "database_unavailable" }, { status: 503 });

  const bookingId = clean(body.booking_id, 80) || crypto.randomUUID();
  const existing = await env.LEADS_DB.prepare("SELECT id, status, starts_at, ends_at, zoho_event_id FROM appointments WHERE id = ? LIMIT 1").bind(bookingId).first();
  if (existing?.status === "confirmed") return Response.json({ ok: true, idempotent: true, appointment: existing });

  const leadId = crypto.randomUUID();
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  await env.LEADS_DB.batch([
    env.LEADS_DB.prepare(`INSERT OR IGNORE INTO leads
      (id, source, form_type, status, name, email, phone, company, service_interest, timeline, message, consent_contact, consent_marketing, turnstile_passed, notification_status, calendar_intent)
      VALUES (?, 'booking_page', 'booking', 'new', ?, ?, ?, ?, ?, 'confirmed_slot_requested', ?, 1, ?, 1, 'pending', 'zoho_calendar_booking')`)
      .bind(leadId, name, email, phone || null, company || null, service, notes || null, body.consent_marketing === true ? 1 : 0),
    env.LEADS_DB.prepare(`INSERT OR IGNORE INTO appointments
      (id, lead_id, status, starts_at, ends_at, name, email, phone, company, service_interest, notes, provider_status)
      VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, 'creating')`)
      .bind(bookingId, leadId, start.toISOString(), end.toISOString(), name, email, phone || null, company || null, service, notes || null),
  ]);

  let upstreamPayload;
  try {
    const upstream = await callMehyarsoftAdmin(env, "/v1/admin/calendar/book", {
      method: "POST",
      body: JSON.stringify({ booking_id: bookingId, name, email, phone, company, service_interest: service, message: notes, start: start.toISOString() }),
    });
    upstreamPayload = await upstream.json().catch(() => ({}));
    if (!upstream.ok || !upstreamPayload?.ok) {
      await env.LEADS_DB.prepare("UPDATE appointments SET status = 'failed', provider_status = ?, provider_error = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(`zoho_${upstream.status}`, clean(upstreamPayload?.error || upstreamPayload?.message, 500), bookingId).run();
      return Response.json({ ok: false, error: upstreamPayload?.error || "booking_failed", message: upstreamPayload?.message || "That time could not be booked. Refresh the calendar and choose another time." }, { status: upstream.status === 409 ? 409 : 502 });
    }
  } catch (error) {
    await env.LEADS_DB.prepare("UPDATE appointments SET status = 'failed', provider_status = 'upstream_error', provider_error = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(clean(error?.message, 500), bookingId).run();
    return Response.json({ ok: false, error: "calendar_unavailable" }, { status: 503 });
  }

  const event = upstreamPayload.event || {};
  await env.LEADS_DB.prepare(`UPDATE appointments SET status = 'confirmed', provider_status = 'created', zoho_event_id = ?, zoho_calendar_uid = ?, zoho_view_url = ?, zoho_meeting_url = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(event.event_id || null, event.calendar_uid || null, event.view_url || null, event.meeting_url || null, bookingId).run();

  const when = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(start);
  const ownerMail = await sendCloudflareEmail(env, {
    to: "info@mehyar.us",
    from: "info@mehyar.us",
    replyTo: email,
    subject: `New MehyarSoft call: ${name} - ${when}`,
    text: `A call was booked through mehyar.us.\n\nName: ${name}\nEmail: ${email}\nPhone: ${phone || "Not provided"}\nBusiness: ${company || "Not provided"}\nService: ${service}\nTime: ${when}\nBooking ID: ${bookingId}\n\n${notes || "No additional notes."}`,
  });
  const clientMail = await sendCloudflareEmail(env, {
    to: email,
    from: "info@mehyar.us",
    replyTo: "info@mehyar.us",
    subject: `Your MehyarSoft call is booked for ${when}`,
    text: `Hi ${name},\n\nYour 30-minute phone call with MehyarSoft is confirmed for ${when}. We will call ${phone || "the phone number you provide by replying to this email"}.\n\nTopic: ${service}\n\nNeed to change it? Reply to this email.\n\nMehyarSoft\nhttps://mehyar.us`,
  });
  await env.LEADS_DB.batch([
    env.LEADS_DB.prepare("UPDATE appointments SET owner_email_status = ?, client_email_status = ?, updated_at = datetime('now') WHERE id = ?").bind(ownerMail.status, clientMail.status, bookingId),
    env.LEADS_DB.prepare("UPDATE leads SET notification_status = ?, updated_at = datetime('now') WHERE id = ?").bind(ownerMail.ok ? "sent" : "failed", leadId),
    env.LEADS_DB.prepare("INSERT INTO lead_events (id, lead_id, event_type, actor, metadata_json) VALUES (?, ?, 'booking_confirmed', 'system', ?)").bind(crypto.randomUUID(), leadId, JSON.stringify({ booking_id: bookingId, start: start.toISOString(), zoho_event_id: event.event_id || null, owner_email: ownerMail.status, client_email: clientMail.status })),
  ]);
  return Response.json({ ok: true, appointment: { id: bookingId, status: "confirmed", starts_at: start.toISOString(), ends_at: end.toISOString(), timezone: "America/New_York", label: when }, email: { client: clientMail.status, owner: ownerMail.status } }, { status: 201 });
}

function clean(value, max) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
}
