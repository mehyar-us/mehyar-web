import { verifyAdminToken, json } from "../../_shared/adminAuth.js";

export async function onRequestGet({ request, env }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "database_unavailable" }, 503, request, env);

  const [leadRows, appointmentRows, replyRows, eventRows, counts] = await Promise.all([
    env.LEADS_DB.prepare(`SELECT id, created_at, updated_at, form_type, status, name, email, phone, company, website, service_interest, budget_range, timeline, message, source,
      request_type, selected_offer, offer_code, value_estimate, calendar_intent, consent_contact, consent_marketing, referrer, utm_source, utm_medium, utm_campaign,
      turnstile_passed, notification_status, notification_error, metadata_json
      FROM leads ORDER BY created_at DESC LIMIT 150`).all(),
    env.LEADS_DB.prepare(`SELECT id, lead_id, created_at, updated_at, status, starts_at, ends_at, timezone, duration_minutes, name, email, phone, company, service_interest, notes, source,
      zoho_event_id, zoho_calendar_uid, zoho_view_url, zoho_meeting_url, client_email_status, owner_email_status, provider_status, provider_error,
      request_metadata_json, provider_metadata_json
      FROM appointments ORDER BY starts_at DESC LIMIT 150`).all(),
    env.LEADS_DB.prepare(`SELECT id, lead_id, created_at, sent_at, status, to_email, from_email, subject, body_text, provider, provider_message_id, provider_error
      FROM client_replies ORDER BY created_at DESC LIMIT 100`).all(),
    env.LEADS_DB.prepare(`SELECT id, lead_id, created_at, event_type, actor, metadata_json
      FROM lead_events ORDER BY created_at DESC LIMIT 500`).all(),
    env.LEADS_DB.prepare(`SELECT
      (SELECT COUNT(*) FROM leads) AS submissions,
      (SELECT COUNT(*) FROM leads WHERE form_type != 'newsletter') AS active_leads,
      (SELECT COUNT(*) FROM leads WHERE created_at >= datetime('now','-7 days')) AS submissions_7d,
      (SELECT COUNT(*) FROM appointments WHERE status = 'confirmed' AND starts_at >= datetime('now')) AS upcoming_appointments,
      (SELECT COUNT(*) FROM client_replies WHERE status = 'sent' AND sent_at >= datetime('now','-7 days')) AS replies_7d`).first(),
  ]);
  return json({
    ok: true,
    generated_at: new Date().toISOString(),
    counts: counts || {},
    submissions: leadRows.results || [],
    leads: (leadRows.results || []).filter((row) => row.form_type !== "newsletter"),
    appointments: appointmentRows.results || [],
    replies: replyRows.results || [],
    events: eventRows.results || [],
  }, 200, request, env);
}
