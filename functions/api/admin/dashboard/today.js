// GET /api/admin/dashboard/today?days=1
// Returns the three "Today" views for the admin dashboard tab:
//   - leadsToday: list + aggregations from `leads` in the window
//   - draftsToday: counts from `prospects` + `prospect_drafts` + `prospect_sends` in the window
//   - recentEvents: last 50 lead_events from the window
//
// Admin-only — same JWT gate as /api/admin/metrics and /api/prospects/*.

import { verifyAdminToken, json, corsHeaders } from "../../_shared/adminAuth.js";

function cap(v, max) { return (v || "").length > max ? v.slice(0, max) : v; }

function safeDays(input) {
  const n = parseInt(input, 10);
  if (!Number.isFinite(n)) return 1;
  if (n < 1) return 1;
  if (n > 30) return 30;
  return n;
}

export async function onRequestGet({ request, env }) {
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);

  const url = new URL(request.url);
  const days = safeDays(url.searchParams.get("days"));
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 200);

  // 1) Leads in window
  const leadsRows = await env.LEADS_DB.prepare(`
    SELECT id, created_at, source, form_type, status,
           name, email, phone, company, website,
           service_interest, budget_range, timeline,
           substr(message, 1, 300) AS message_excerpt
    FROM leads
    WHERE created_at >= datetime('now', '-' || ? || ' days')
    ORDER BY created_at DESC
    LIMIT ?
  `).bind(days, limit).all();

  // 2) Leads aggregations
  const byFormType = await env.LEADS_DB.prepare(`
    SELECT form_type, COUNT(*) AS count
    FROM leads
    WHERE created_at >= datetime('now', '-' || ? || ' days')
    GROUP BY form_type
    ORDER BY count DESC
  `).bind(days).all();
  const bySource = await env.LEADS_DB.prepare(`
    SELECT COALESCE(source, 'unknown') AS source, COUNT(*) AS count
    FROM leads
    WHERE created_at >= datetime('now', '-' || ? || ' days')
    GROUP BY source
    ORDER BY count DESC
  `).bind(days).all();
  const topServiceInterest = await env.LEADS_DB.prepare(`
    SELECT COALESCE(service_interest, 'unspecified') AS service_interest, COUNT(*) AS count
    FROM leads
    WHERE created_at >= datetime('now', '-' || ? || ' days')
      AND service_interest IS NOT NULL AND service_interest != ''
    GROUP BY service_interest
    ORDER BY count DESC
    LIMIT 5
  `).bind(days).all();

  // 3) Prospect pipeline in window
  const prosScanned = await env.LEADS_DB.prepare(
    `SELECT COUNT(*) AS n FROM prospect_signals WHERE scanned_at >= datetime('now', '-' || ? || ' days')`
  ).bind(days).first();
  const prosDrafted = await env.LEADS_DB.prepare(
    `SELECT COUNT(*) AS n FROM prospect_drafts WHERE created_at >= datetime('now', '-' || ? || ' days')`
  ).bind(days).first();
  const prosSent = await env.LEADS_DB.prepare(
    `SELECT COUNT(*) AS n FROM prospect_sends WHERE created_at >= datetime('now', '-' || ? || ' days')`
  ).bind(days).first();
  const prosQueued = await env.LEADS_DB.prepare(
    `SELECT COUNT(*) AS n FROM prospect_sends WHERE status = 'queued'`
  ).first();
  const prosTotal = await env.LEADS_DB.prepare(`SELECT COUNT(*) AS n FROM prospects`).first();
  const prosUnsubscribed = await env.LEADS_DB.prepare(
    `SELECT COUNT(*) AS n FROM prospect_replies WHERE classification = 'unsubscribe' AND received_at >= datetime('now', '-' || ? || ' days')`
  ).bind(days).first();

  // 4) Recent lead events
  const events = await env.LEADS_DB.prepare(`
    SELECT id, lead_id, created_at, event_type, actor, substr(metadata_json, 1, 600) AS metadata_json
    FROM lead_events
    WHERE created_at >= datetime('now', '-' || ? || ' days')
    ORDER BY created_at DESC
    LIMIT ?
  `).bind(days, limit).all();

  // 5) Suppression list size (helpful for the founder)
  const suppression = await env.LEADS_DB.prepare(
    `SELECT COUNT(*) AS count FROM suppression_list`
  ).first();

  // 6) Last successful admin dashboard render time (just for the header)
  return json({
    ok: true,
    window_days: days,
    generated_at: new Date().toISOString(),
    leads: {
      count: (leadsRows.results || []).length,
      by_form_type: (byFormType.results || []),
      by_source: (bySource.results || []),
      top_service_interest: (topServiceInterest.results || []),
      rows: (leadsRows.results || []).map((r) => ({
        id: r.id,
        created_at: r.created_at,
        source: r.source,
        form_type: r.form_type,
        status: r.status,
        name: r.name,
        email: r.email,
        phone: r.phone,
        company: r.company,
        website: r.website,
        service_interest: r.service_interest,
        budget_range: r.budget_range,
        timeline: r.timeline,
        message_excerpt: r.message_excerpt,
      })),
    },
    prospect_pipeline: {
      total_prospects: Number(prosTotal?.n || 0),
      scanned_in_window: Number(prosScanned?.n || 0),
      drafted_in_window: Number(prosDrafted?.n || 0),
      sent_in_window: Number(prosSent?.n || 0),
      queued_now: Number(prosQueued?.n || 0),
      unsubscribed_in_window: Number(prosUnsubscribed?.n || 0),
    },
    recent_events: (events.results || []),
    suppression_total: Number(suppression?.count || 0),
  }, 200, request, env);
}

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export const __test = { safeDays, cap };
