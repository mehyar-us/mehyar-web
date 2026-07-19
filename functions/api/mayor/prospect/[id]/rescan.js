// /api/mayor/prospect/[id]/rescan — fetch the prospect's website and run
// a fresh leak scan, writing a new prospect_signals row + updating the
// prospect's last_scanned_at + status.
//
// Returns: { ok, prospect_id, signals: {<latest scan>}, errors: [...] }
//
// Doesn't generate a draft — that's a separate /generate-draft call so the
// user can review signals first.

import { verifyAdminToken, json, corsHeaders } from "../../../_shared/adminAuth.js";

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

const PLATFORM_HINTS = {
  wordpress:    /wp-content|wp-includes|wordpress/i,
  wix:          /wixstatic\.com|wix\.com|wix-code/i,
  squarespace:  /squarespace\.com|sqsp/i,
  webflow:      /webflow\.com|webflow\.io/i,
  shopify:      /cdn\.shopify\.com|myshopify\.com/i,
  hubspot:      /hubspot\.com|hs-scripts|hsforms/i,
  framer:       /framer\.com|framerusercontent/i,
  google_sites: /sites\.google\.com|googleusercontent/i,
};

function detectPlatform(html, headers) {
  const combined = `${html.slice(0, 200_000)} ${headers?.["x-powered-by"] || ""} ${headers?.server || ""}`;
  for (const [name, rx] of Object.entries(PLATFORM_HINTS)) {
    if (rx.test(combined)) return name;
  }
  return "unknown";
}

function detectLeaks(html, headers, httpsOk, finalUrl) {
  const lc = html.toLowerCase();
  const leaks = [];
  const checks = {
    no_https:        !httpsOk,
    no_viewport:     !/<meta\s+name=["']viewport/i.test(html),
    no_booking_cta:  !/\b(book|schedule|reserve|request\s+(an?\s+)?(appointment|quote|consultation))\b/i.test(html),
    no_phone_cta:    !/<a[^>]+href=["']tel:/i.test(html),
    no_form_action:  !/<form[^>]+action=/i.test(html),
    no_email_link:   !/<a[^>]+href=["']mailto:/i.test(html),
    no_address:      !/\b\d+\s+\w+\s+(ave|avenue|st|street|blvd|boulevard|rd|road|dr|drive|hwy|highway|way|plaza|square)\b/i.test(html),
    large_page:      html.length > 200_000,
    page_5xx:        false,
    slow_load:       false,
    redirect_loop:   false,
    iframes_only:    /<body[^>]*>[\s\S]*<iframe[\s\S]*<\/body>/i.test(html) && !/<h1[\s\S]*<\/h1>/i.test(html.slice(0, 50_000)),
    generic_template:/\b(lorem ipsum|placeholder|coming soon|under construction|example\.com)\b/i.test(html),
  };
  for (const [k, v] of Object.entries(checks)) if (v) leaks.push(k);
  return leaks;
}

export async function onRequestPost({ request, env, params }) {
  if (!await bearerAccepted(request, env)) {
    return json({ ok: false, error: "unauthorized" }, 401, request, env);
  }
  if (!env?.LEADS_DB) {
    return json({ ok: false, error: "missing_db" }, 500, request, env);
  }
  const id = params?.id;
  if (!id) return json({ ok: false, error: "missing_prospect_id" }, 400, request, env);

  const db = env.LEADS_DB;
  const { results: prs } = await db.prepare(`SELECT * FROM prospects WHERE id = ?`).bind(id).all();
  const prospect = prs?.[0];
  if (!prospect) return json({ ok: false, error: "prospect_not_found" }, 404, request, env);
  if (!prospect.website) {
    return json({ ok: false, error: "prospect_no_website", message: "Set the prospect.website first." }, 409, request, env);
  }

  const errors = [];
  const start = Date.now();
  let httpOk = 0, httpsOk = 0, statusCode = 0, html = "", finalUrl = prospect.website, headers = {}, leaked = [];
  let platform = "unknown";

  try {
    // Normalize to https for the scan
    let target = prospect.website;
    if (!/^https?:\/\//i.test(target)) target = "https://" + target;

    const resp = await fetch(target, {
      headers: { "User-Agent": "Mozilla/5.0 MehyarBot/1.0" },
      redirect: "follow",
    });
    statusCode = resp.status;
    headers = Object.fromEntries(resp.headers.entries());
    finalUrl = resp.url || target;
    httpsOk = (finalUrl || "").startsWith("https://");
    httpOk = resp.ok ? 1 : 0;
    html = await resp.text();
    platform = detectPlatform(html, headers);
    leaked = detectLeaks(html, headers, httpsOk, finalUrl);
  } catch (e) {
    errors.push({ stage: "fetch", message: String(e?.message || e) });
    leaked.push("page_5xx");
  }

  const loadTime = Date.now() - start;
  if (loadTime > 2500) leaked.push("slow_load");
  if (statusCode >= 500) leaked.push("page_5xx");

  const score = Math.min(100, leaked.length * 12);

  // Persist
  const signalId = crypto.randomUUID();
  try {
    await db.prepare(`
      INSERT INTO prospect_signals
        (id, prospect_id, scanned_at, http_ok, https_ok, status_code, redirect_url,
         title, has_viewport, has_booking_cta, has_phone_click_to_call, has_form_action,
         has_email_link, has_address, has_ssl, page_weight_kb, load_time_ms,
         detected_platform, leak_signals_json, leak_score, notes)
      VALUES (?, ?, datetime('now'), ?, ?, ?, ?,
              ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?,
              ?, ?, ?, ?)
    `).bind(
      signalId,
      prospect.id,
      httpOk, httpsOk ? 1 : 0, statusCode, finalUrl !== prospect.website ? finalUrl : null,
      (html.match(/<title>([^<]*)<\/title>/i)?.[1] || null),
      !leaked.includes("no_viewport") ? 1 : 0,
      !leaked.includes("no_booking_cta") ? 1 : 0,
      !leaked.includes("no_phone_cta") ? 1 : 0,
      !leaked.includes("no_form_action") ? 1 : 0,
      !leaked.includes("no_email_link") ? 1 : 0,
      !leaked.includes("no_address") ? 1 : 0,
      httpsOk ? 1 : 0,
      Math.round(html.length / 1024),
      loadTime,
      platform,
      JSON.stringify(leaked),
      score,
      errors.length ? JSON.stringify(errors) : null,
    ).run();
  } catch (e) {
    return json({ ok: false, error: "signals_insert_failed", message: String(e?.message || e) }, 500, request, env);
  }

  // Update prospect
  try {
    await db.prepare(`
      UPDATE prospects
         SET status = CASE WHEN status = 'new' THEN 'scanned' ELSE status END,
             last_scanned_at = datetime('now'),
             updated_at = datetime('now')
       WHERE id = ?
    `).bind(prospect.id).run();
  } catch (_) {}

  // Audit event
  try {
    await db.prepare(`
      INSERT INTO mayor_events (id, kind, loop, summary, details_json, created_at)
      VALUES (?, 'discovery', 'manual_rescan', ?, ?, datetime('now'))
    `).bind(
      crypto.randomUUID(),
      `Rescan ${prospect.business_name}: leak score ${score}/100 (${leaked.length} leaks, platform=${platform})`,
      JSON.stringify({ prospect_id: prospect.id, signal_id: signalId, score, leaks: leaked, platform, load_time_ms: loadTime })
    ).run();
  } catch (_) {}

  return json({
    ok: true,
    prospect_id: prospect.id,
    signal_id: signalId,
    score,
    leaks: leaked,
    platform,
    load_time_ms: loadTime,
    page_weight_kb: Math.round(html.length / 1024),
    status_code: statusCode,
    https_ok: !!httpsOk,
    title: html.match(/<title>([^<]*)<\/title>/i)?.[1] || null,
    errors,
  }, 200, request, env);
}