// POST /api/admin/prospects/scan-businesses
// Body: { vertical?: string, city?: string, region?: string, max_results?: number, auto_draft_top?: number }
//
// 1. Lists cold prospects in the given vertical/city (status='new' or 'scanned')
// 2. For each: fetch the homepage, parse signals
// 3. Score them by leak_score (high = more pain = better lead)
// 4. Optionally auto-draft the top N (calls /api/admin/prospects/draft internally)
//
// Returns: { ok, scanned, drafted, results: [...], used_llm }
//
// Owner-only.

import { verifyAdminToken, json, corsHeaders } from "../../_shared/adminAuth.js";

const MAX_RESULTS = 30;
const HTTP_TIMEOUT_MS = 12_000;

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestPost({ request, env }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const vertical = String(body?.vertical || "").trim().toLowerCase();
  const city = String(body?.city || "").trim().toLowerCase();
  const region = String(body?.region || "").trim().toLowerCase();
  const maxResults = Math.min(MAX_RESULTS, parseInt(body?.max_results || "10", 10) || 10);
  const autoDraftTop = Math.max(0, Math.min(5, parseInt(body?.auto_draft_top || "0", 10) || 0));

  // 1. Find candidate prospects
  const filters = [];
  const params = [];
  if (vertical) { filters.push("LOWER(vertical) = ?"); params.push(vertical); }
  if (city)     { filters.push("LOWER(city) = ?"); params.push(city); }
  if (region)   { filters.push("LOWER(region) = ?"); params.push(region); }
  filters.push("status IN ('new','scanned','queued')");
  filters.push("website IS NOT NULL AND website != ''");

  const candidates = await env.LEADS_DB.prepare(`
    SELECT id, business_name, website, root_domain, vertical, city, region, email, status
    FROM prospects
    WHERE ${filters.join(" AND ")}
    ORDER BY updated_at DESC
    LIMIT ?
  `).bind(...params, maxResults).all().catch((e) => ({ error: String(e.message || e) }));

  if (candidates.error) {
    return json({ ok: false, error: "query_failed", details: candidates.error }, 500, request, env);
  }
  const list = candidates.results || [];
  if (list.length === 0) {
    return json({ ok: true, scanned: 0, drafted: 0, results: [], message: "No matching prospects in DB." }, 200, request, env);
  }

  // 2. Scan each site (lightweight, no LLM here — just HTTP + regex)
  const results = [];
  for (const p of list) {
    try {
      const signals = await scanSite(env, p.website || p.root_domain);
      const leak_score = computeLeakScore(signals);
      // Persist signal row
      await env.LEADS_DB.prepare(`
        INSERT INTO prospect_signals (id, prospect_id, scanned_at, status_code, page_weight_kb, load_time_ms,
          has_ssl, has_booking_cta, has_phone_click_to_call, has_form_action, has_email_link, has_address,
          detected_platform, leak_score, raw_json)
        VALUES (?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        p.id,
        signals.status_code, signals.page_weight_kb, signals.load_time_ms,
        signals.has_ssl ? 1 : 0, signals.has_booking_cta ? 1 : 0,
        signals.has_phone_click_to_call ? 1 : 0, signals.has_form_action ? 1 : 0,
        signals.has_email_link ? 1 : 0, signals.has_address ? 1 : 0,
        signals.detected_platform, leak_score, JSON.stringify(signals).slice(0, 8000)
      ).run().catch(() => null);
      await env.LEADS_DB.prepare(`UPDATE prospects SET last_scanned_at = datetime('now'), status = COALESCE(NULLIF(status,''),'scanned') WHERE id = ?`).bind(p.id).run();

      results.push({
        id: p.id,
        business_name: p.business_name,
        website: p.website,
        root_domain: p.root_domain,
        leak_score,
        signals,
        ok: true,
      });
    } catch (e) {
      results.push({
        id: p.id,
        business_name: p.business_name,
        ok: false,
        error: String(e?.message || e),
      });
    }
  }

  // 3. Rank by leak_score
  const ranked = results
    .filter((r) => r.ok)
    .sort((a, b) => b.leak_score - a.leak_score);

  // 4. Auto-draft top N
  let drafted = 0;
  if (autoDraftTop > 0 && ranked.length > 0) {
    const topPicks = ranked.slice(0, autoDraftTop);
    for (const r of topPicks) {
      try {
        const origin = new URL(request.url).origin;
        const draftResp = await fetch(`${origin}/api/admin/prospects/draft`, {
          method: "POST",
          headers: {
            "authorization": `Bearer ${auth.token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ prospect_id: r.id }),
          signal: AbortSignal.timeout(60_000),
        }).catch(() => null);
        if (draftResp && draftResp.ok) {
          const j = await draftResp.json().catch(() => ({}));
          r.drafted = true;
          r.draft_id = j.draft_id;
          drafted++;
        } else {
          r.drafted = false;
        }
      } catch (e) {
        r.drafted = false;
        r.draft_error = String(e?.message || e);
      }
    }
  }

  // Audit log
  try {
    await env.LEADS_DB.prepare(`
      INSERT INTO opportunity_events (id, kind, event_type, actor, payload_json, created_at)
      VALUES (?, 'prospect', 'business_scan', 'owner', ?, datetime('now'))
    `).bind(crypto.randomUUID(), JSON.stringify({
      vertical, city, region,
      scanned: results.length,
      drafted,
      top: ranked.slice(0, 5).map((r) => ({ id: r.id, name: r.business_name, leak_score: r.leak_score })),
    }).slice(0, 8000)).run();
  } catch {}

  return json({
    ok: true,
    vertical, city, region,
    scanned: results.length,
    successful: results.filter((r) => r.ok).length,
    drafted,
    auto_draft_top: autoDraftTop,
    results,
    top_picks: ranked.slice(0, 10).map((r) => ({
      id: r.id, business_name: r.business_name, website: r.website, leak_score: r.leak_score, drafted: r.drafted,
    })),
  }, 200, request, env);
}

async function scanSite(env, host) {
  if (!host) throw new Error("no host");
  let url = host.startsWith("http") ? host : `https://${host}`;
  const signals = {
    scanned_at: new Date().toISOString(),
    url,
    status_code: 0,
    page_weight_kb: 0,
    load_time_ms: 0,
    has_ssl: url.startsWith("https"),
    has_booking_cta: false,
    has_phone_click_to_call: false,
    has_form_action: false,
    has_email_link: false,
    has_address: false,
    detected_platform: null,
  };
  const t0 = Date.now();
  const r = await fetch(url, {
    headers: { "User-Agent": "MehyarSoft-Scanner/1.0" },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    redirect: "follow",
  }).catch((e) => { throw new Error(`fetch failed: ${e.message}`); });
  signals.status_code = r.status;
  const ct = r.headers.get("content-type") || "";
  if (!ct.includes("text/html")) {
    signals.detected_platform = "non-html";
    signals.load_time_ms = Date.now() - t0;
    return signals;
  }
  const html = await r.text().catch(() => "");
  signals.page_weight_kb = Math.round(html.length / 1024);
  signals.load_time_ms = Date.now() - t0;
  const lower = html.toLowerCase();

  // Signal detection
  signals.has_booking_cta = /(book now|schedule|appointment|reserve|book online)/i.test(lower);
  signals.has_phone_click_to_call = /tel:/.test(lower);
  signals.has_form_action = /<form[^>]*action=/i.test(html);
  signals.has_email_link = /mailto:/.test(lower);
  signals.has_address = /\b\d{1,5}\s+[a-z]+\s+(st|street|ave|avenue|blvd|road|rd|ln|lane|dr|drive|way|ct|court)\b/i.test(lower);

  // Platform sniff
  if (/wp-content|wp-includes/.test(lower)) signals.detected_platform = "WordPress";
  else if (/shopify/.test(lower)) signals.detected_platform = "Shopify";
  else if (/squarespace/.test(lower)) signals.detected_platform = "Squarespace";
  else if (/wix\.com/.test(lower)) signals.detected_platform = "Wix";
  else if (/webflow/.test(lower)) signals.detected_platform = "Webflow";
  else if (/gohighlevel|ghl\.app/.test(lower)) signals.detected_platform = "GoHighLevel";
  else if (/hubspot/.test(lower)) signals.detected_platform = "HubSpot CMS";
  else if (lower.includes("react")) signals.detected_platform = "React";
  else if (lower.includes("vue")) signals.detected_platform = "Vue";
  else if (lower.includes("next.js")) signals.detected_platform = "Next.js";

  return signals;
}

function computeLeakScore(s) {
  let score = 50;
  if (!s.has_ssl) score += 15;
  if (!s.has_booking_cta) score += 12;
  if (!s.has_phone_click_to_call) score += 5;
  if (!s.has_form_action) score += 8;
  if (!s.has_email_link) score += 5;
  if (!s.has_address) score += 5;
  if (s.status_code >= 400) score += 10;
  if (s.page_weight_kb > 3000) score += 5;  // heavy page
  if (s.load_time_ms > 3000) score += 5;
  return Math.min(100, Math.max(0, score));
}