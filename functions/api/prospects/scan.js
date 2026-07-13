// POST /api/prospects/scan  { prospect_id | url }
// GET  /api/prospects/scan?prospect_id=…
//
// Pulls the homepage (with safe fallbacks), extracts leak signals, writes
// prospect_signals + updates prospects.status. Gated on the same admin JWT
// issued by /v1/admin/login.
//
// Design principles:
//  - Cloudflare Workers = 30s CPU cap on free; hard timeout + abort if so.
//  - Never trust the homepage DOM for security-sensitive decisions (no script exec).
//  - Best-effort only — if the site 5xx's, we still record what we got (no leak evidence ≠ no leak).

import { verifyAdminToken, json, corsHeaders, isAllowedOrigin } from "../_shared/adminAuth.js";

const PLATFORM_HINTS = [
  { name: "wordpress", re: /wp-content|wp-includes|wordpress/i },
  { name: "wix",       re: /wix\.com|wixstatic\.com|wixsite/i },
  { name: "squarespace", re: /squarespace\.com|squarespacecdn|staticfld\.com/i },
  { name: "webflow",   re: /webflow\.(com|io)|assets-global\.website-files\.com/i },
  { name: "shopify",   re: /myshopify\.com|shopify/i },
  { name: "hubspot",   re: /hubspot|hsforms\.com|hbspt/i },
  { name: "joomla",    re: /\/joomla\//i },
  { name: "duda",      re: /dudamobile\.com|irp\.cdn-cgi\.com/i },
];

const BOOKING_KEYWORDS = /\b(book(ing)?|schedule|appointment|request\s+appointment|reserve|get\s+started|buy\s+now|order\s+now|consultation|contact\s+us)\b/i;
const ABORT_DEADLINE_MS = 8000;

const nowIso = () => new Date().toISOString();

async function readBodyCap(request, maxBytes = 8 * 1024) {
  const reader = request.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) { try { await reader.cancel(); } catch {}; throw new Error("payload_too_large"); }
    chunks.push(value);
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: false }).decode(out);
}

function cap(value, max) {
  return (value || "").length > max ? value.slice(0, max) : value;
}

function pickText(html) {
  const noScripts = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
  return noScripts.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function detectPlatform(html, headers) {
  const hay = (html || "").slice(0, 50000) + " " + JSON.stringify(headers || {});
  for (const p of PLATFORM_HINTS) if (p.re.test(hay)) return p.name;
  return "unknown";
}

function rootDomainOf(input) {
  if (!input) return "";
  let s = String(input).trim().toLowerCase();
  if (!/^https?:\/\//.test(s)) s = "https://" + s;
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^www\./, "");
    const parts = host.split(".");
    if (parts.length <= 2) return host;
    return parts.slice(-2).join(".");
  } catch { return ""; }
}

async function scanUrl(rawUrl, { fetcher = fetch } = {}) {
  if (!rawUrl) return { error: "missing_url" };
  const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), ABORT_DEADLINE_MS);

  const headers = {
    "user-agent": "MehyarSoft-ProspectScanner/1.0 (+https://mehyar.us) Cloudflare-Workers",
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.5",
    "accept-encoding": "identity",
    "connection": "close",
    "upgrade-insecure-requests": "1",
  };

  let resp, html = "", finalUrl = url;
  try {
    resp = await fetcher(url, { method: "GET", redirect: "follow", signal: controller.signal, headers });
    finalUrl = resp.url || url;
    const ct = (resp.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("text/html") || ct.includes("xml")) {
      const buf = await resp.arrayBuffer();
      if (buf.byteLength > 1_500_000) {
        html = new TextDecoder("utf-8", { fatal: false }).decode(buf.slice(0, 1_500_000));
      } else {
        html = new TextDecoder("utf-8", { fatal: false }).decode(buf);
      }
    } else {
      html = `<meta http-equiv="content-type" content="${ct.replace(/[^a-z/-]/g, "")}">`;
    }
  } catch (err) {
    clearTimeout(timer);
    return {
      error: "fetch_failed",
      detail: String(err?.message || err?.name || "fetch_failed").slice(0, 200),
      final_url: url,
      https_ok: /^https/i.test(url) ? 1 : 0,
      page_weight_kb: 0,
      load_time_ms: Date.now() - startedAt,
      leak_signals_json: JSON.stringify(["fetch_failed"]),
    };
  }
  clearTimeout(timer);

  const elapsed = Date.now() - startedAt;
  const weightKb = Math.round((html.length || 0) / 1024);
  const text = pickText(html);

  const viewportMatch = /name=["']viewport["']/i.test(html);
  const formMatch     = /<form\b[^>]*action=/i.test(html);
  const telMatch      = /href=["']tel:/i.test(html);
  const mailtoMatch   = /href=["']mailto:/i.test(html);
  const addressMatch  = /\b\d{1,6}\s+[A-Z][\w'.-]*\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Place|Pl|Drive|Dr|Lane|Ln)\b/i.test(text)
                      || /\b(zip|postal)\b.*\b\d{5}\b/i.test(text);
  const bookingMatch  = BOOKING_KEYWORDS.test(text);
  const platform      = detectPlatform(html, Object.fromEntries(resp?.headers?.entries?.() || []));

  const leak_signals = [];
  const finalProto = /^https/i.test(finalUrl) ? "https" : "http";
  const https_ok = finalProto === "https" ? 1 : 0;
  if (!https_ok) leak_signals.push("no_https");
  if (elapsed > 3000) leak_signals.push("slow_load");
  if (weightKb > 2500) leak_signals.push("heavy_page");
  if (!viewportMatch) leak_signals.push("no_viewport");
  if (!bookingMatch) leak_signals.push("no_booking_cta");
  if (!telMatch) leak_signals.push("no_phone_link");
  if (!formMatch) leak_signals.push("no_form_action");
  if (!mailtoMatch) leak_signals.push("no_email_link");
  if (!addressMatch) leak_signals.push("no_address");
  if (["wix", "squarespace"].includes(platform)) leak_signals.push("platform_generic");

  const score = Math.min(100, leak_signals.length * 14);

  return {
    http_ok: resp?.status >= 200 && resp?.status < 400 ? 1 : 0,
    https_ok,
    redirect_url: finalUrl !== url ? finalUrl : null,
    status_code: resp?.status ?? 0,
    title: (html.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1] || "").trim(),
    has_viewport: viewportMatch ? 1 : 0,
    has_booking_cta: bookingMatch ? 1 : 0,
    has_phone_click_to_call: telMatch ? 1 : 0,
    has_form_action: formMatch ? 1 : 0,
    has_email_link: mailtoMatch ? 1 : 0,
    has_address: addressMatch ? 1 : 0,
    page_weight_kb: weightKb,
    load_time_ms: elapsed,
    detected_platform: platform,
    detected_cms_hints: PLATFORM_HINTS.map(p => p.name),
    leak_signals_json: JSON.stringify(leak_signals),
    leak_score: score,
  };
}

async function loadProspect(env, id) {
  return env.LEADS_DB.prepare(
    `SELECT id, business_name, website, root_domain, vertical, city FROM prospects WHERE id = ? LIMIT 1`
  ).bind(id).first();
}

async function upsertProspectByDomain(env, prospect) {
  const existing = await env.LEADS_DB.prepare(
    `SELECT id FROM prospects WHERE root_domain = ? LIMIT 1`
  ).bind(prospect.root_domain).first();
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  await env.LEADS_DB.prepare(`
    INSERT INTO prospects (id, source, source_ref, business_name, website, root_domain, vertical, city, region, country, meta_json, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new')
  `).bind(
    id,
    prospect.source || "manual",
    prospect.source_ref || null,
    prospect.business_name || prospect.root_domain,
    prospect.website || `https://${prospect.root_domain}`,
    prospect.root_domain,
    prospect.vertical || null,
    prospect.city || null,
    prospect.region || null,
    prospect.country || "US",
    JSON.stringify(prospect.meta || {}),
  ).run();
  return id;
}

async function recordSignals(env, prospectId, signals) {
  const id = crypto.randomUUID();
  await env.LEADS_DB.prepare(`
    INSERT INTO prospect_signals (
      id, prospect_id, scanned_at, http_ok, https_ok, redirect_url, status_code,
      title, has_viewport, has_booking_cta, has_phone_click_to_call,
      has_form_action, has_email_link, has_address, page_weight_kb,
      load_time_ms, detected_platform, detected_cms_hints, leak_signals_json, leak_score
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `).bind(
    id, prospectId, nowIso(),
    signals.http_ok || 0, signals.https_ok || 0,
    signals.redirect_url || null, signals.status_code || 0,
    cap(signals.title || "", 300),
    signals.has_viewport || 0, signals.has_booking_cta || 0,
    signals.has_phone_click_to_call || 0, signals.has_form_action || 0,
    signals.has_email_link || 0, signals.has_address || 0,
    signals.page_weight_kb || 0, signals.load_time_ms || 0,
    signals.detected_platform || "unknown",
    JSON.stringify(signals.detected_cms_hints || []),
    signals.leak_signals_json || "[]",
    signals.leak_score || 0,
  ).run();
  await env.LEADS_DB.prepare(
    `UPDATE prospects SET status = 'scanned', last_scanned_at = ?, updated_at = ? WHERE id = ?`
  ).bind(nowIso(), nowIso(), prospectId).run();
  return id;
}

export async function onRequestPost({ request, env }) {
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);

  let body;
  try {
    const raw = await readBodyCap(request, 8 * 1024);
    body = JSON.parse(raw || "{}");
  } catch { return json({ ok: false, error: "bad_json" }, 400, request, env); }

  let prospectId = typeof body.prospect_id === "string" ? body.prospect_id : null;
  let website    = typeof body.website === "string" ? body.website.trim() : "";

  if (!prospectId && website) {
    const root = rootDomainOf(website);
    if (!root) return json({ ok: false, error: "bad_url" }, 400, request, env);
    prospectId = await upsertProspectByDomain(env, {
      business_name: body.business_name || root,
      website: /^https?:\/\//i.test(website) ? website : `https://${website}`,
      root_domain: root,
      vertical: body.vertical || null,
      city: body.city || null,
      region: body.region || null,
      country: body.country || "US",
      source: body.source || "manual",
      meta: { manual_url: true },
    });
  }
  if (!prospectId) return json({ ok: false, error: "missing_prospect_or_url" }, 400, request, env);

  const prospect = await loadProspect(env, prospectId).catch(() => null);
  const target = (prospect?.website || website || "").trim();
  if (!target) return json({ ok: false, error: "prospect_has_no_url" }, 400, request, env);

  const signals = await scanUrl(target).catch((err) => ({ error: "scanner_threw", detail: String(err?.message || err) }));
  if (signals.error) return json({ ok: false, ...signals }, 502, request, env);

  const signalId = await recordSignals(env, prospectId, signals);
  return json({ ok: true, prospect_id: prospectId, signal_id: signalId, signals }, 200, request, env);
}

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export const __test = { scanUrl, detectPlatform, pickText, rootDomainOf, BOOKING_KEYWORDS };
