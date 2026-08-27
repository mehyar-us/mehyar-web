import { verifyAdminToken, json, isAllowedOrigin } from "../../_shared/adminAuth.js";
import { sendCloudflareEmail } from "../../_shared/cloudflareEmail.js";

export async function onRequestOptions({ request, env }) {
  return json({}, 204, request, env);
}

export async function onRequestPost({ request, env }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!isAllowedOrigin(request, env)) return json({ ok: false, error: "origin_not_allowed" }, 403, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "database_unavailable" }, 503, request, env);
  const body = await request.json().catch(() => ({}));
  const leadId = clean(body.lead_id, 80);
  const subject = clean(body.subject, 180);
  const message = cleanMultiline(body.message, 12000);
  if (!leadId || !subject || !message || body.confirm_send !== true) return json({ ok: false, error: "lead_subject_message_and_confirmation_required" }, 400, request, env);
  const lead = await env.LEADS_DB.prepare("SELECT id, email, name FROM leads WHERE id = ? LIMIT 1").bind(leadId).first();
  if (!lead?.email) return json({ ok: false, error: "lead_not_found" }, 404, request, env);

  const replyId = crypto.randomUUID();
  await env.LEADS_DB.prepare(`INSERT INTO client_replies (id, lead_id, status, to_email, subject, body_text, actor)
    VALUES (?, ?, 'sending', ?, ?, ?, ?)`).bind(replyId, leadId, lead.email, subject, message, auth.session?.sub || "owner").run();
  const result = await sendCloudflareEmail(env, {
    to: lead.email,
    from: "info@mehyar.us",
    replyTo: "info@mehyar.us",
    subject,
    text: message,
  });
  await env.LEADS_DB.batch([
    env.LEADS_DB.prepare("UPDATE client_replies SET status = ?, provider_message_id = ?, provider_error = ?, sent_at = CASE WHEN ? = 'sent' THEN datetime('now') ELSE NULL END WHERE id = ?")
      .bind(result.ok ? "sent" : "failed", result.messageId || null, result.error || null, result.ok ? "sent" : "failed", replyId),
    env.LEADS_DB.prepare("INSERT INTO lead_events (id, lead_id, event_type, actor, metadata_json) VALUES (?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), leadId, result.ok ? "admin_reply_sent" : "admin_reply_failed", auth.session?.sub || "owner", JSON.stringify({ reply_id: replyId, provider: "cloudflare_email_service", status: result.status })),
  ]);
  if (!result.ok) return json({ ok: false, error: result.error || "email_send_failed", reply_id: replyId }, 502, request, env);
  return json({ ok: true, reply_id: replyId, status: "sent", provider_message_id: result.messageId }, 200, request, env);
}

function clean(value, max) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
}
function cleanMultiline(value, max) {
  return typeof value === "string" ? value.replace(/[\u0000\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max) : "";
}
