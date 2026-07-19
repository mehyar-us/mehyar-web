// /api/mayor/discovered — full prospect list with leak signals, drafts, sends, replies.
//
// Returns one row per prospect with denormalized counts so the AdminMayor
// dashboard can render the "Discovered" tab + drill-down panel without
// N+1 queries. Backed by the proper prospect pipeline tables (prospects,
// prospect_signals, prospect_drafts, prospect_sends, prospect_replies),
// NOT the legacy prospect_sequences table.
//
// Query params:
//   ?status=new|scanned|drafted|approved|sent|replied|...   filter by status
//   ?vertical=dental|hvac|...                              filter by vertical
//   ?min_leak_score=50                                     only prospects with high leak signal
//   ?needs_draft=1                                         prospects scanned but not yet drafted
//   ?limit=50                                              cap rows (default 50, max 200)
//   ?include_sequences=1                                   also include the new prospect_sequences
//                                                         rows (Mayor engine's old flow) per prospect
//   ?sort=leak_score|created_at|last_contact|name          default leak_score DESC

import { verifyAdminToken, json, corsHeaders } from "../_shared/adminAuth.js";

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

export async function onRequestGet({ request, env }) {
  if (!await bearerAccepted(request, env)) {
    return json({ ok: false, error: "unauthorized" }, 401, request, env);
  }
  if (!env?.LEADS_DB) {
    return json({ ok: false, error: "missing_db" }, 500, request, env);
  }
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const vertical = url.searchParams.get("vertical");
  const minLeakScore = parseInt(url.searchParams.get("min_leak_score") || "0", 10) || 0;
  const needsDraft = url.searchParams.get("needs_draft") === "1";
  const includeSequences = url.searchParams.get("include_sequences") === "1";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 200);
  const sortKey = url.searchParams.get("sort") || "leak_score";

  // Build WHERE clause safely
  const where = [];
  const params = [];
  if (status) { where.push("p.status = ?"); params.push(status); }
  if (vertical) { where.push("p.vertical = ?"); params.push(vertical); }
  if (minLeakScore > 0) {
    where.push("COALESCE((SELECT leak_score FROM prospect_signals WHERE prospect_id = p.id ORDER BY scanned_at DESC LIMIT 1), 0) >= ?");
    params.push(minLeakScore);
  }
  if (needsDraft) {
    where.push(`EXISTS (SELECT 1 FROM prospect_signals ps WHERE ps.prospect_id = p.id AND ps.leak_score >= 30)
                AND NOT EXISTS (SELECT 1 FROM prospect_drafts pd WHERE pd.prospect_id = p.id AND pd.status IN ('draft','approved'))`);
  }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";

  const orderBy = {
    leak_score:    "COALESCE((SELECT leak_score FROM prospect_signals WHERE prospect_id = p.id ORDER BY scanned_at DESC LIMIT 1), 0) DESC, p.last_contact_at DESC, p.created_at DESC",
    created_at:    "p.created_at DESC",
    last_contact:  "p.last_contact_at DESC, p.created_at DESC",
    name:          "p.business_name COLLATE NOCASE ASC",
  }[sortKey] || "leak_score";

  // Main prospect query + denormalized aggregates
  const sql = `
    SELECT
      p.id, p.created_at, p.updated_at, p.source, p.source_ref,
      p.business_name, p.website, p.root_domain, p.email, p.email_source, p.phone,
      p.vertical, p.city, p.region, p.country, p.postal_code,
      p.status, p.consent_state,
      p.last_scanned_at, p.last_drafted_at, p.last_sent_at, p.last_contact_at,
      p.meta_json,
      -- Latest leak scan
      (SELECT leak_score FROM prospect_signals ps WHERE ps.prospect_id = p.id ORDER BY scanned_at DESC LIMIT 1) AS leak_score,
      (SELECT leak_signals_json FROM prospect_signals ps WHERE ps.prospect_id = p.id ORDER BY scanned_at DESC LIMIT 1) AS leak_signals_json,
      (SELECT detected_platform FROM prospect_signals ps WHERE ps.prospect_id = p.id ORDER BY scanned_at DESC LIMIT 1) AS detected_platform,
      (SELECT has_booking_cta FROM prospect_signals ps WHERE ps.prospect_id = p.id ORDER BY scanned_at DESC LIMIT 1) AS has_booking_cta,
      (SELECT has_phone_click_to_call FROM prospect_signals ps WHERE ps.prospect_id = p.id ORDER BY scanned_at DESC LIMIT 1) AS has_phone_click_to_call,
      (SELECT has_ssl FROM prospect_signals ps WHERE ps.prospect_id = p.id ORDER BY scanned_at DESC LIMIT 1) AS has_ssl,
      (SELECT load_time_ms FROM prospect_signals ps WHERE ps.prospect_id = p.id ORDER BY scanned_at DESC LIMIT 1) AS load_time_ms,
      -- Counts
      (SELECT COUNT(*) FROM prospect_signals ps WHERE ps.prospect_id = p.id) AS scan_count,
      (SELECT COUNT(*) FROM prospect_drafts pd WHERE pd.prospect_id = p.id) AS draft_count,
      (SELECT COUNT(*) FROM prospect_drafts pd WHERE pd.prospect_id = p.id AND pd.status = 'draft') AS draft_open_count,
      (SELECT COUNT(*) FROM prospect_drafts pd WHERE pd.prospect_id = p.id AND pd.status = 'approved') AS draft_approved_count,
      (SELECT COUNT(*) FROM prospect_sends ps WHERE ps.prospect_id = p.id) AS send_count,
      (SELECT COUNT(*) FROM prospect_sends ps WHERE ps.prospect_id = p.id AND ps.status = 'sent') AS send_sent_count,
      (SELECT COUNT(*) FROM prospect_sends ps WHERE ps.prospect_id = p.id AND ps.status = 'replied') AS send_replied_count,
      (SELECT COUNT(*) FROM prospect_replies pr WHERE pr.prospect_id = p.id) AS reply_count,
      (SELECT COUNT(*) FROM prospect_replies pr WHERE pr.prospect_id = p.id AND pr.classification = 'interest') AS reply_interest_count
    FROM prospects p
    ${whereSql}
    ORDER BY ${orderBy}
    LIMIT ?
  `;
  params.push(limit);

  let prospects = [];
  try {
    const { results } = await env.LEADS_DB.prepare(sql).bind(...params).all();
    prospects = results || [];
  } catch (e) {
    return json({ ok: false, error: "query_failed", message: String(e?.message || e) }, 500, request, env);
  }

  // Aggregate stats across the entire pipeline (no filter)
  let totals = {};
  try {
    const { results } = await env.LEADS_DB.prepare(`
      SELECT
        (SELECT COUNT(*) FROM prospects) AS prospects_total,
        (SELECT COUNT(*) FROM prospects WHERE status = 'new') AS prospects_new,
        (SELECT COUNT(*) FROM prospects WHERE status = 'scanned') AS prospects_scanned,
        (SELECT COUNT(*) FROM prospects WHERE status = 'drafted') AS prospects_drafted,
        (SELECT COUNT(*) FROM prospects WHERE status = 'approved') AS prospects_approved,
        (SELECT COUNT(*) FROM prospects WHERE status = 'sent') AS prospects_sent,
        (SELECT COUNT(*) FROM prospects WHERE status = 'replied') AS prospects_replied,
        (SELECT COUNT(*) FROM prospects WHERE status = 'unsubscribed') AS prospects_unsubscribed,
        (SELECT COUNT(*) FROM prospects WHERE status = 'bounced') AS prospects_bounced,
        (SELECT COUNT(*) FROM prospects WHERE status = 'invalid') AS prospects_invalid,
        (SELECT COUNT(*) FROM prospect_signals) AS signals_total,
        (SELECT COUNT(*) FROM prospect_drafts) AS drafts_total,
        (SELECT COUNT(*) FROM prospect_drafts WHERE status = 'draft') AS drafts_open,
        (SELECT COUNT(*) FROM prospect_drafts WHERE status = 'approved') AS drafts_approved,
        (SELECT COUNT(*) FROM prospect_sends) AS sends_total,
        (SELECT COUNT(*) FROM prospect_sends WHERE status = 'sent') AS sends_sent,
        (SELECT COUNT(*) FROM prospect_sends WHERE status = 'delivered') AS sends_delivered,
        (SELECT COUNT(*) FROM prospect_sends WHERE status = 'bounced') AS sends_bounced,
        (SELECT COUNT(*) FROM prospect_sends WHERE status = 'failed') AS sends_failed,
        (SELECT COUNT(*) FROM prospect_sends WHERE status = 'replied') AS sends_replied,
        (SELECT COUNT(*) FROM prospect_replies) AS replies_total,
        (SELECT COUNT(*) FROM prospect_replies WHERE classification = 'interest') AS replies_interest,
        (SELECT COUNT(*) FROM prospect_replies WHERE classification = 'unsubscribe') AS replies_unsub,
        (SELECT COUNT(*) FROM prospect_replies WHERE classification = 'objection') AS replies_objection,
        (SELECT COUNT(*) FROM prospect_replies WHERE classification = 'not_interested') AS replies_not_interested,
        (SELECT COUNT(DISTINCT vertical) FROM prospects WHERE vertical IS NOT NULL) AS vertical_count
    `).all();
    totals = results?.[0] || {};
  } catch (e) {
    totals = { _error: String(e?.message || e) };
  }

  // Per-vertical breakdown
  let verticals = [];
  try {
    const { results } = await env.LEADS_DB.prepare(`
      SELECT vertical,
             COUNT(*) AS count,
             SUM(CASE WHEN status IN ('sent','replied') THEN 1 ELSE 0 END) AS contacted,
             SUM(CASE WHEN status = 'replied' THEN 1 ELSE 0 END) AS replies,
             (SELECT AVG(leak_score) FROM prospect_signals ps WHERE ps.prospect_id IN (SELECT id FROM prospects WHERE vertical = p.vertical)) AS avg_leak_score
      FROM prospects p
      WHERE vertical IS NOT NULL
      GROUP BY vertical
      ORDER BY count DESC
    `).all();
    verticals = results || [];
  } catch (_) {}

  // Optionally attach legacy prospect_sequences rows (the live Mayor engine's flow)
  if (includeSequences && prospects.length > 0) {
    const ids = prospects.map(p => p.id);
    try {
      const placeholders = ids.map(() => "?").join(",");
      const { results: seqs } = await env.LEADS_DB.prepare(`
        SELECT id, prospect_id, step_no, subject, status, scheduled_for, sent_at,
               SUBSTR(body_text, 1, 240) AS body_preview
        FROM prospect_sequences
        WHERE prospect_id IN (${placeholders})
        ORDER BY prospect_id, step_no
      `).bind(...ids).all();
      const byProspect = {};
      for (const s of (seqs || [])) {
        if (!byProspect[s.prospect_id]) byProspect[s.prospect_id] = [];
        byProspect[s.prospect_id].push(s);
      }
      for (const p of prospects) p.sequences = byProspect[p.id] || [];
    } catch (_) {
      for (const p of prospects) p.sequences = [];
    }
  }

  return json({
    ok: true,
    filter: { status, vertical, min_leak_score: minLeakScore, needs_draft: needsDraft, sort: sortKey },
    count: prospects.length,
    totals,
    verticals,
    prospects,
  }, 200, request, env);
}