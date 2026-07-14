// GET /api/admin/prospect-sources/list-real?q=&limit=
// Returns the real prospect table with their latest signals + latest LLM analysis
// (joined from opportunity_events event_type='analysis').
//
// Important: NEVER return example.com / test-like rows.

import { verifyAdminToken, json, corsHeaders } from "../../_shared/adminAuth.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestGet({ request, env }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  const url = new URL(request.url);
  const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10) || 100, 300);

  try {
    let rows;
    if (q) {
      const like = `%${q}%`;
      rows = await env.LEADS_DB.prepare(`
        SELECT id, business_name, website, root_domain, email, phone, vertical, city, country,
               status, source, last_scanned_at, last_drafted_at, last_contact_at, last_touched_at
        FROM prospects
        WHERE (LOWER(IFNULL(business_name, '')) LIKE ?1
            OR LOWER(IFNULL(root_domain, '')) LIKE ?1
            OR LOWER(IFNULL(website, '')) LIKE ?1)
          AND root_domain NOT LIKE '%.example.com'
          AND root_domain NOT LIKE '%.test'
          AND root_domain NOT LIKE '%.invalid'
          AND root_domain NOT LIKE '%.localhost'
          AND root_domain NOT LIKE 'example.com'
        ORDER BY created_at DESC LIMIT ?
      `).bind(like, limit).all();
    } else {
      rows = await env.LEADS_DB.prepare(`
        SELECT id, business_name, website, root_domain, email, phone, vertical, city, country,
               status, source, last_scanned_at, last_drafted_at, last_contact_at, last_touched_at
        FROM prospects
        WHERE root_domain NOT LIKE '%.example.com'
          AND root_domain NOT LIKE '%.test'
          AND root_domain NOT LIKE '%.invalid'
          AND root_domain NOT LIKE '%.localhost'
          AND root_domain NOT LIKE 'example.com'
        ORDER BY created_at DESC LIMIT ?
      `).bind(limit).all();
    }

    const items = [];
    for (const p of (rows.results || [])) {
      const sig = await env.LEADS_DB.prepare(`
        SELECT scanned_at, status_code, has_ssl, has_booking_cta, has_phone_click_to_call,
               has_form_action, has_email_link, has_address, page_weight_kb, load_time_ms,
               detected_platform, leak_signals_json, leak_score, title
        FROM prospect_signals WHERE prospect_id = ? ORDER BY scanned_at DESC LIMIT 1
      `).bind(p.id).first().catch(() => null);

      const ev = await env.LEADS_DB.prepare(`
        SELECT payload_json, created_at FROM opportunity_events
        WHERE prospect_id = ? AND event_type = 'analysis'
        ORDER BY created_at DESC LIMIT 1
      `).bind(p.id).first().catch(() => null);

      let analysis = null;
      let analysis_at = null;
      if (ev && ev.payload_json) {
        try {
          const obj = JSON.parse(ev.payload_json);
          // strip signal_snapshot's bulky text from list view to keep payload tiny
          if (obj && obj.signal_snapshot) {
            const ss = obj.signal_snapshot;
            obj.signal_snapshot = { ...ss, visible_text_excerpt: ss.visible_text_excerpt?.slice(0, 600) };
          }
          analysis = obj;
          analysis_at = ev.created_at;
        } catch {}
      }

      items.push({
        ...p,
        signals: sig ? {
          ...sig,
          leak_signals: safeJson(sig.leak_signals_json, []),
        } : null,
        analysis,
        analysis_at,
      });
    }

    return json({ ok: true, items, total: items.length, updatedAt: new Date().toISOString() }, 200, request, env);
  } catch (err) {
    return json({ ok: false, error: "list_real_failed", details: String(err?.message || err) }, 500, request, env);
  }
}

function safeJson(s, fallback) {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}
