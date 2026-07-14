// GET  /api/admin/replies              — list reply classifications with filters
// POST /api/admin/replies              — manually add / classify a reply
// OPTIONS handled for CORS

import { verifyAdminToken, json, corsHeaders } from "../../_shared/adminAuth.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestGet({ request, env }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  const url = new URL(request.url);
  const prospectId = url.searchParams.get("prospect_id") || "";
  const label = url.searchParams.get("label") || "";
  const q = (url.searchParams.get("q") || "").slice(0, 80).trim();
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "60", 10) || 60, 200);
  const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10) || 0, 0);

  const conds = [];
  const args = [];

  if (prospectId) { conds.push("rc.prospect_id = ?"); args.push(prospectId); }
  if (label) { conds.push("rc.label = ?"); args.push(label); }
  if (q) {
    conds.push("(pr.subject LIKE ? OR pr.body_excerpt LIKE ? OR p.business_name LIKE ? OR rc.review_notes LIKE ?)");
    const w = `%${q}%`;
    args.push(w, w, w, w);
  }

  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";

  try {
    const rows = await env.LEADS_DB.prepare(`
      SELECT
        rc.id                  AS classification_id,
        rc.label,
        rc.confidence,
        rc.classified_by,
        rc.classifier_version,
        rc.review_notes,
        rc.reviewed_at,
        rc.action_taken,
        rc.created_at          AS classified_at,
        pr.id                  AS reply_id,
        pr.received_at,
        pr.from_email,
        pr.subject             AS reply_subject,
        pr.body_excerpt,
        pr.manually_synced,
        p.id                   AS prospect_id,
        p.business_name,
        p.root_domain,
        p.email                AS prospect_email,
        p.vertical,
        p.city,
        p.region,
        ps.status              AS send_status
      FROM reply_classifications rc
      JOIN prospect_replies     pr  ON pr.id = rc.reply_id
      JOIN prospects            p   ON p.id  = rc.prospect_id
      LEFT JOIN prospect_sends  ps  ON ps.prospect_id = p.id
      ${where}
      ORDER BY pr.received_at DESC
      LIMIT ? OFFSET ?
    `).bind(...args, limit, offset).all();

    const totalRow = await env.LEADS_DB.prepare(`
      SELECT COUNT(*) AS n
      FROM reply_classifications rc
      JOIN prospect_replies pr ON pr.id = rc.reply_id
      JOIN prospects p ON p.id = rc.prospect_id
      ${where}
    `).bind(...args).first();

    return json({
      ok: true,
      items: rows.results || [],
      total: Number(totalRow?.n || 0),
      limit, offset, label, prospectId, q,
      updatedAt: new Date().toISOString(),
    }, 200, request, env);
  } catch (e) {
    return json({ ok: false, error: "query_failed", details: String(e?.message || e) }, 500, request, env);
  }
}

// POST — manually add a reply record + classify it in one shot
export async function onRequestPost({ request, env }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400, request, env);
  }

  const { prospect_id, from_email, subject, body_excerpt, label, review_notes, action_taken } = body || {};
  if (!prospect_id || !from_email) {
    return json({ ok: false, error: "prospect_id_and_from_email_required" }, 400, request, env);
  }

  const replyId = crypto.randomUUID();
  const classId = crypto.randomUUID();
  const now = new Date().toISOString();
  const resolvedLabel = String(label || "unclassified").toLowerCase().slice(0, 32);

  try {
    // Insert reply
    await env.LEADS_DB.prepare(`
      INSERT INTO prospect_replies (id, prospect_id, received_at, from_email, subject, body_excerpt, classification, manually_synced, created_action)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).bind(
      replyId,
      prospect_id,
      now,
      String(from_email).slice(0, 254),
      String(subject || "").slice(0, 500),
      String(body_excerpt || "").slice(0, 4096),
      resolvedLabel,
      String(action_taken || "none"),
    ).run();

    // Insert classification
    await env.LEADS_DB.prepare(`
      INSERT INTO reply_classifications (id, reply_id, prospect_id, label, confidence, classified_by, classifier_version, review_notes, reviewed_at, action_taken, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1.0, 'manual', '', ?, ?, ?, ?, ?)
    `).bind(
      classId,
      replyId,
      prospect_id,
      resolvedLabel,
      String(review_notes || "").slice(0, 500),
      now,
      String(action_taken || "none"),
      now, now,
    ).run();

    // If action is 'replied_recorded' or label is 'interest', update prospect stage
    if (resolvedLabel === "interest" || resolvedLabel === "warm" || resolvedLabel === "replied") {
      await env.LEADS_DB.prepare(`
        UPDATE prospects SET stage = 'Replied', last_contact_at = ?, last_touched_at = ?, updated_at = ? WHERE id = ?
      `).bind(now, now, now, prospect_id).run();
    }
  } catch (e) {
    return json({ ok: false, error: "insert_failed", details: String(e?.message || e) }, 500, request, env);
  }

  return json({ ok: true, reply_id: replyId, classification_id: classId, label: resolvedLabel }, 201, request, env);
}
