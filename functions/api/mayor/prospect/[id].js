// /api/mayor/prospect/[id] — single-prospect drill-down.
//
// Returns everything the AdminMayor dashboard needs to render the
// prospect detail panel: prospect record, full scan history, all drafts
// (with body text + cited signals), all sends (with provider status),
// and all inbound replies. One round-trip per prospect.

import { verifyAdminToken, json, corsHeaders } from "../../_shared/adminAuth.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

async function bearerAccepted(request, env) {
  const h = request.headers.get("authorization") || "";
  if (!h.startsWith("Bearer ")) return false;
  const tok = h.slice(7);
  if (tok && env?.GOV_INGEST_TOKEN && tok === env.GOV_INGEST_TOKEN) return true;
  const a = await verifyAdminToken(request, env);
  return a.ok;
}

export async function onRequestGet({ request, env, params }) {
  if (!await bearerAccepted(request, env)) {
    return json({ ok: false, error: "unauthorized" }, 401, request, env);
  }
  if (!env?.LEADS_DB) {
    return json({ ok: false, error: "missing_db" }, 500, request, env);
  }
  const id = params?.id;
  if (!id) {
    return json({ ok: false, error: "missing_id" }, 400, request, env);
  }

  const db = env.LEADS_DB;
  const out = { ok: true, id };

  // Prospect
  try {
    const { results } = await db.prepare(`SELECT * FROM prospects WHERE id = ?`).bind(id).all();
    out.prospect = results?.[0] || null;
  } catch (e) {
    return json({ ok: false, error: "prospect_query_failed", message: String(e?.message || e) }, 500, request, env);
  }
  if (!out.prospect) {
    return json({ ok: false, error: "prospect_not_found" }, 404, request, env);
  }

  // All leak scans (latest first)
  try {
    const { results } = await db.prepare(`
      SELECT id, scanned_at, http_ok, https_ok, status_code, redirect_url,
             title, has_viewport, has_booking_cta, has_phone_click_to_call,
             has_form_action, has_email_link, has_address, has_ssl,
             page_weight_kb, load_time_ms,
             detected_platform, detected_cms_hints, leak_signals_json, leak_score, notes
      FROM prospect_signals
      WHERE prospect_id = ?
      ORDER BY scanned_at DESC
      LIMIT 50
    `).bind(id).all();
    out.signals = results || [];
  } catch (e) {
    out.signals = [];
    out.signals_error = String(e?.message || e);
  }

  // All drafts (with body text + cited signals + reviewer notes)
  try {
    const { results } = await db.prepare(`
      SELECT id, created_at, generated_by, model, subject,
             body_text, body_html, cited_signals_json,
             status, reviewer_notes
      FROM prospect_drafts
      WHERE prospect_id = ?
      ORDER BY created_at DESC
      LIMIT 50
    `).bind(id).all();
    out.drafts = results || [];
  } catch (e) {
    out.drafts = [];
    out.drafts_error = String(e?.message || e);
  }

  // All sends (with provider status + RFC 8058 headers)
  try {
    const { results } = await db.prepare(`
      SELECT id, draft_id, created_at, scheduled_for, attempted_at, finished_at,
             provider, provider_id, to_email, from_email, reply_to, subject,
             status, failure_reason, test_only, physical_address
      FROM prospect_sends
      WHERE prospect_id = ?
      ORDER BY COALESCE(finished_at, attempted_at, created_at) DESC
      LIMIT 50
    `).bind(id).all();
    out.sends = results || [];
  } catch (e) {
    out.sends = [];
    out.sends_error = String(e?.message || e);
  }

  // All inbound replies
  try {
    const { results } = await db.prepare(`
      SELECT id, send_id, received_at, from_email, subject,
             body_excerpt, classification, manually_synced, created_action
      FROM prospect_replies
      WHERE prospect_id = ?
      ORDER BY received_at DESC
      LIMIT 50
    `).bind(id).all();
    out.replies = results || [];
  } catch (e) {
    out.replies = [];
    out.replies_error = String(e?.message || e);
  }

  // Legacy prospect_sequences rows (the live Mayor engine's flow)
  try {
    const { results } = await db.prepare(`
      SELECT id, step_no, subject, body_text, send_after_days,
             status, send_id, scheduled_for, sent_at, created_at
      FROM prospect_sequences
      WHERE prospect_id = ?
      ORDER BY step_no
    `).bind(id).all();
    out.sequences = results || [];
  } catch (e) {
    out.sequences = [];
    out.sequences_error = String(e?.message || e);
  }

  // Derived: next-action hint
  const p = out.prospect;
  const hints = [];
  if (p.status === 'new') {
    hints.push("Run a website scan to surface leak signals.");
  } else if (p.status === 'scanned' && out.drafts.filter(d => d.status === 'draft').length === 0) {
    hints.push("Score is " + (out.signals[0]?.leak_score ?? 'n/a') + "/100 — generate a draft email.");
  } else if (out.drafts.filter(d => d.status === 'draft').length > 0) {
    hints.push("Drafts waiting for review. Approve one to queue the send.");
  } else if (out.drafts.filter(d => d.status === 'approved').length > 0 && out.sends.filter(s => s.status === 'queued').length > 0) {
    hints.push("Approved + queued — next outreach tick will send.");
  } else if (p.status === 'sent') {
    hints.push("Awaiting reply. Check the Replies tab.");
  } else if (p.status === 'replied') {
    const interestReply = out.replies.find(r => r.classification === 'interest');
    if (interestReply) hints.push("INTEREST REPLY — schedule a call: " + (interestReply.from_email || ""));
  } else if (p.status === 'unsubscribed') {
    hints.push("Suppression active — no further outreach.");
  } else if (p.status === 'bounced') {
    hints.push("Email bounced. Verify or remove from pipeline.");
  }
  out.next_action = hints;

  return json(out, 200, request, env);
}