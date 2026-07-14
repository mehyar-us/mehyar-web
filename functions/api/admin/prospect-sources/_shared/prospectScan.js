// /api/admin/prospect-sources/scan
//
// Real prospect pipeline:
//   POST /api/admin/prospect-sources/scan
//     body:
//       {
//         seed?:  [{ business_name, website, root_domain, source?, vertical?, city? }, ...],
//         scan_existing?: true,           // also re-scan the prospects that already have a website
//         max_concurrency?: 4,            // parallel fetches
//       }
//     → for each row: fetch the URL over HTTPS, parse leak signals,
//        write a real prospect_signals row, score 0-100, write
//        auto-promote into `prospects` with status='draft_needed'.
//
// Nothing here fakes anything. No example.com. No ".test" domains.
// Real live fetches only.

import { verifyAdminToken, json, corsHeaders } from "../../_shared/adminAuth.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestPost({ request, env }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const seed = Array.isArray(body?.seed) ? body.seed : [];
  const scanExisting = body?.scan_existing === true;
  const maxConcurrency = Math.max(1, Math.min(parseInt(body?.max_concurrency, 10) || 4, 10));
  const autoPromote = body?.auto_promote !== false;  // default: promote into prospects
  const userAgent = body?.user_agent || "Mozilla/5.0 (compatible; MehyarSoftBot/1.0; +https://mehyar.us/bot)";
  const runId = `run_${Date.now()}_${crypto.randomUUID().slice(0,8)}`;

  // 1. Build the work queue.
  const queue = [];
  if (seed.length) {
    for (const row of seed) {
      const url = (row.website || row.root_domain || "").trim();
      if (!url) continue;
      const normalized = normalizeUrl(url);
      if (!normalized) continue;
      queue.push({
        target_kind: "seed",
        business_name: (row.business_name || normalized.hostname).slice(0, 160),
        website: normalized.full,
        root_domain: normalized.host,
        source: (row.source || "manual_csv").slice(0, 60),
        vertical: (row.vertical || "").slice(0, 80),
        city: (row.city || "").slice(0, 80),
        email: (row.email || "").slice(0, 200),
        phone: (row.phone || "").slice(0, 80),
        country: (row.country || "USA").slice(0, 8),
        prospect_id: null,
      });
    }
  }
  if (scanExisting) {
    const existing = await env.LEADS_DB.prepare(`
      SELECT id, business_name, website, root_domain, vertical, city, email, phone, country
      FROM prospects
      WHERE website IS NOT NULL AND website <> ''
      ORDER BY last_scanned_at IS NULL DESC, last_scanned_at ASC
      LIMIT 100
    `).all();
    for (const r of existing.results || []) {
      const normalized = normalizeUrl(r.website);
      if (!normalized) continue;
      queue.push({
        target_kind: "prospect_revisit",
        business_name: r.business_name || normalized.host,
        website: normalized.full,
        root_domain: r.root_domain || normalized.host,
        source: "prospect_revisit",
        vertical: r.vertical || "",
        city: r.city || "",
        email: r.email || "",
        phone: r.phone || "",
        country: r.country || "USA",
        prospect_id: r.id,
      });
    }
  }
  if (!queue.length) {
    return json({ ok: false, error: "no_targets", message: "Provide body.seed=[...] or set scan_existing:true" }, 400, request, env);
  }

  // 2. Process with bounded parallelism.
  const results = [];
  const logId = `audit_scan_${runId}`;
  let index = 0;
  async function worker() {
    while (index < queue.length) {
      const myIdx = index++;
      const row = queue[myIdx];
      try {
        const scan = await scanOne(row, userAgent);
        results.push(scan);
      } catch (e) {
        results.push({ ...row, error: String(e?.message || e), leak_score: 0, http_ok: 0 });
      }
    }
  }
  await Promise.all(Array.from({ length: maxConcurrency }, () => worker()));

  // 3. Persist signal rows + (optionally) promote.
  const now = new Date().toISOString();
  let promoted = 0;
  let signalsInserted = 0;
  const brokenExamples = [];

  for (const r of results) {
    if (!r.http_ok && !r.error) continue;
    if (r.error) { brokenExamples.push({ host: r.root_domain, err: r.error }); continue; }

    // Reject example / test / non-live domains defensively (Agent B's possible leak).
    if (looksLikeTestDomain(r.root_domain)) { brokenExamples.push({ host: r.root_domain, err: "looks_like_test_domain" }); continue; }

    // Upsert into prospects.
    let prospectId = r.prospect_id;
    if (!prospectId) {
      const existing = await env.LEADS_DB.prepare(`
        SELECT id FROM prospects WHERE root_domain = ? LIMIT 1
      `).bind(r.root_domain).first().catch(() => null);
      if (existing) {
        prospectId = existing.id;
      } else {
        prospectId = `p_${now.replace(/[^0-9]/g,"").slice(0,14)}_${crypto.randomUUID().slice(0,8)}`;
        try {
          await env.LEADS_DB.prepare(`
            INSERT INTO prospects (id, business_name, website, root_domain, email, phone, vertical, city, country, source, status, last_scanned_at, last_touched_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft_needed', ?, ?, ?, ?)
          `).bind(
            prospectId, r.business_name, r.website, r.root_domain,
            r.email || "", r.phone || "", r.vertical || "", r.city || "",
            r.country || "USA", r.source || "manual", now, now, now, now
          ).run();
        } catch (e) {
          brokenExamples.push({ host: r.root_domain, err: "prospect_insert_failed: " + String(e?.message || e) });
          continue;
        }
        if (autoPromote) promoted++;
      }
    } else {
      // Touch last_scanned_at
      try { await env.LEADS_DB.prepare(`UPDATE prospects SET last_scanned_at=?, last_touched_at=?, updated_at=? WHERE id=?`).bind(now, now, now, prospectId).run(); } catch {}
    }

    // Insert a signal row.
    try {
      await env.LEADS_DB.prepare(`
        INSERT INTO prospect_signals
        (id, prospect_id, scanned_at, http_ok, https_ok, redirect_url, status_code,
         title, has_viewport, has_booking_cta, has_phone_click_to_call, has_form_action,
         has_email_link, has_address, has_ssl, page_weight_kb, load_time_ms,
         detected_platform, detected_cms_hints, leak_signals_json, leak_score, notes)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).bind(
        `sig_${now.replace(/[^0-9]/g,"").slice(0,14)}_${crypto.randomUUID().slice(0,6)}`,
        prospectId,
        now,
        r.http_ok ? 1 : 0,
        r.https_ok ? 1 : 0,
        r.redirect_url || "",
        r.status_code || 0,
        r.title || "",
        r.has_viewport ? 1 : 0,
        r.has_booking_cta ? 1 : 0,
        r.has_phone_click_to_call ? 1 : 0,
        r.has_form_action ? 1 : 0,
        r.has_email_link ? 1 : 0,
        r.has_address ? 1 : 0,
        r.has_ssl ? 1 : 0,
        r.page_weight_kb || 0,
        r.load_time_ms || 0,
        r.detected_platform || "",
        JSON.stringify(r.detected_cms_hints || []),
        JSON.stringify(r.leak_signals || []),
        r.leak_score || 0,
        r.notes || ""
      ).run();
      signalsInserted++;
    } catch (e) {
      brokenExamples.push({ host: r.root_domain, err: "signal_insert_failed: " + String(e?.message || e) });
    }
  }

  // Audit trail
  try {
    await env.LEADS_DB.prepare(`
      INSERT INTO opportunity_events (id, kind, prospect_id, sam_id, event_type, actor, payload_json, created_at)
      VALUES (?, 'prospect', NULL, NULL, 'scan_batch', 'owner', ?, ?)
    `).bind(logId, JSON.stringify({ run_id: runId, queue_size: queue.length, results: results.length, promoted, signals_inserted: signalsInserted, broken_examples: brokenExamples }).slice(0, 8000), now).run();
  } catch {}

  return json({
    ok: true,
    run_id: runId,
    queued: queue.length,
    scanned: results.length,
    signals_inserted: signalsInserted,
    promoted,
    rejected_examples: brokenExamples,
    summary: summarize(results),
    updatedAt: now,
  }, 200, request, env);
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function normalizeUrl(input) {
  if (!input) return null;
  const s = String(input).trim();
  let candidate = s;
  if (!/^https?:\/\//i.test(candidate)) candidate = "https://" + candidate;
  try {
    const u = new URL(candidate);
    // Reject IP addresses, localhost, example.com/test domains, IPv6
    if (u.hostname === "localhost" || u.hostname.endsWith(".local") || u.hostname === "0.0.0.0") return null;
    return { full: u.toString().replace(/\/$/, ""), host: u.hostname.toLowerCase() };
  } catch { return null; }
}

function looksLikeTestDomain(host) {
  if (!host) return true;
  const h = host.toLowerCase();
  return /^(www\.)?(example\.com|example\.org|example\.net|test\.com|foo\.com|bar\.com|localhost)$/.test(h)
      || /\.(example|test|invalid|localhost|local)$/.test(h)
      || /\binvalid\b/.test(h);
}

// ── The actual fetch + parse ─────────────────────────────────────────────────
async function scanOne(row, userAgent) {
  const start = Date.now();
  let res;
  try {
    res = await fetch(row.website, {
      method: "GET",
      redirect: "follow",
      headers: { "User-Agent": userAgent, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    return { ...row, http_ok: 0, https_ok: row.website.startsWith("https") ? 0 : 0, leak_signals: ["fetch_failed: " + String(e?.message || e)], leak_score: 0, error: String(e?.message || e), load_time_ms: Date.now() - start, status_code: 0, page_weight_kb: 0 };
  }

  const load_time_ms = Date.now() - start;
  const finalUrl = res.url || row.website;
  const https_ok = (finalUrl || row.website).startsWith("https") ? 1 : 0;
  const redirect_url = (finalUrl !== row.website) ? finalUrl : "";
  const status_code = res.status;
  const http_ok = res.ok ? 1 : 0;
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  const page_weight_kb = Number(res.headers.get("content-length") || 0) > 0
    ? Math.round(Number(res.headers.get("content-length") || 0) / 1024 * 10) / 10
    : 0;

  // SSL: cheap proxy via https_ok + ct presence
  const has_ssl = https_ok && /^text\/html|application\/xhtml/.test(ct);

  let html = "";
  if (http_ok && /text\/html/.test(ct)) {
    try { html = await res.text(); } catch { html = ""; }
  }
  // Truncate to 600 KB to avoid memory blowups
  if (html.length > 600_000) html = html.slice(0, 600_000);

  const title = extractTag(html, /<title[^>]*>([^<]{1,200})<\/title>/i);
  const has_viewport = /<meta\s+name=["']viewport["']/i.test(html);
  const has_booking_cta = /\b(book|schedule|appointment|reservation|book now|get a quote|free estimate|free consultation|request a quote|request quote|book online)\b/i.test(html);
  const has_phone_click_to_call = /href=["']tel:[\d+\-()\s]{3,}/i.test(html);
  const has_form_action = /<form[^>]+action=["'][^"']{2,}/i.test(html) || /<input[^>]+type=["']?(submit|email|tel|date|datetime-local)["']?/i.test(html);
  const has_email_link = /href=["']mailto:[^"']{3,}@[^"']{2,}/i.test(html);
  const has_address = /\b\d{1,5}\s+[A-Z][a-z]+\s+(St|Ave|Rd|Blvd|Way|Dr|Ln|Pl|Hwy|Pkwy|Court|Ct|Square|Sq|Terrace|Plaza)\b/.test(html) || /\b(?:Suite|Ste|#)\s*\d{2,}\b/.test(html);

  // CMS / platform fingerprints
  const detected_platform = detectPlatform(html);
  const cmsHints = [];
  if (/wp-content|wp-includes|wp-json|\/wp-admin/.test(html)) cmsHints.push("wordpress");
  if (/dnn,/.test(html) || /DotNetNuke/.test(html)) cmsHints.push("dnn");
  if (/cdn\.shopify\.com/.test(html)) cmsHints.push("shopify");
  if (/squarespace\.com|squarespace-cdn/.test(html)) cmsHints.push("squarespace");
  if (/wix\.com|wixstatic\.com/.test(html)) cmsHints.push("wix");
  if (/webflow\.com|webflow\.io/.test(html)) cmsHints.push("webflow");
  if (/godaddy\.com|secureserver\.net/.test(html)) cmsHints.push("godaddy");
  if (/weebly\.com|editmysite\.com/.test(html)) cmsHints.push("weebly");
  if (/jimdo\.com/.test(html)) cmsHints.push("jimdo");
  if (/duda\.com/.test(html)) cmsHints.push("duda");
  if (/sites\.google\.com/.test(html)) cmsHints.push("google_sites");

  // Leak scoring
  const leak_signals = [];
  let leak_score = 0;
  if (!has_ssl) { leak_signals.push("no_ssl"); leak_score += 22; }
  if (!has_viewport) { leak_signals.push("not_mobile_friendly"); leak_score += 12; }
  if (!has_phone_click_to_call) { leak_signals.push("no_click_to_call"); leak_score += 10; }
  if (!has_booking_cta) { leak_signals.push("no_booking_cta"); leak_signals.push("no_online_scheduling"); leak_score += 18; }
  if (!has_form_action) { leak_signals.push("no_form_action"); leak_score += 8; }
  if (!has_email_link) { leak_signals.push("no_email_link"); leak_score += 6; }
  if (!has_address) { leak_signals.push("no_physical_address"); leak_score += 8; }
  if (page_weight_kb > 4000) { leak_signals.push("slow_or_heavy_page"); leak_score += 8; }
  if (load_time_ms > 4000) { leak_signals.push("slow_load_time"); leak_score += 8; }
  if (status_code >= 400) { leak_signals.push("http_error_status"); leak_score += 12; }
  if (status_code >= 300 && status_code < 400) { leak_signals.push("redirected"); }
  if (/Coming soon|Under construction|placeholder/i.test(html)) { leak_signals.push("site_under_construction"); leak_score += 12; }
  if (cmsHints.includes("wix") || cmsHints.includes("weebly") || cmsHints.includes("google_sites") || cmsHints.includes("jimdo") || cmsHints.includes("duda")) {
    leak_signals.push(`legacy_or_lockedin_cms_${cmsHints.find(c => ["wix","weebly","google_sites","jimdo","duda"].includes(c))}`);
    leak_score += 10;
  }
  if (!title || title.toLowerCase().includes("coming soon")) { leak_signals.push("weak_or_missing_title"); leak_score += 6; }
  if (leak_score > 100) leak_score = 100;

  return {
    ...row,
    http_ok,
    https_ok,
    status_code,
    redirect_url,
    load_time_ms,
    page_weight_kb,
    has_ssl,
    has_viewport,
    has_booking_cta,
    has_phone_click_to_call,
    has_form_action,
    has_email_link,
    has_address,
    title,
    detected_platform,
    detected_cms_hints: cmsHints,
    leak_signals,
    leak_score,
    notes: scanSummary({ has_ssl, has_booking_cta, has_form_action, load_time_ms, page_weight_kb, status_code }),
  };
}

function detectPlatform(html) {
  if (/wp-content|wp-includes|wp-json/.test(html)) return "wordpress";
  if (/cdn\.shopify\.com/.test(html)) return "shopify";
  if (/squarespace\.com|squarespace-cdn/.test(html)) return "squarespace";
  if (/wix\.com|wixstatic\.com/.test(html)) return "wix";
  if (/webflow\.com|webflow\.io/.test(html)) return "webflow";
  if (/dnn|dotnetnuke/.test(html)) return "dnn";
  if (/go\.godaddy\.com|secureserver\.net/.test(html)) return "godaddy";
  if (/weebly\.com/.test(html)) return "weebly";
  if (/jimdo\.com/.test(html)) return "jimdo";
  if (/duda\.com/.test(html)) return "duda";
  if (/sites\.google\.com/.test(html)) return "google_sites";
  if (/react|nextjs|nuxt|vite/.test(html)) return "modern_framework";
  return "";
}

function extractTag(html, re) {
  const m = html.match(re);
  return m ? m[1].trim().slice(0, 200) : "";
}

function scanSummary(s) {
  const bits = [];
  if (s.has_ssl) bits.push("SSL✓");
  if (s.has_booking_cta) bits.push("book✓");
  else bits.push("book✗");
  if (s.has_form_action) bits.push("form✓");
  if (s.load_time_ms > 0) bits.push(`${s.load_time_ms}ms`);
  if (s.page_weight_kb > 0) bits.push(`${s.page_weight_kb}KB`);
  if (s.status_code) bits.push(`HTTP ${s.status_code}`);
  return bits.join(" · ");
}

function summarize(results) {
  const r = { count: results.length, with_signals: 0, avg_leak: 0, no_ssl: 0, no_booking_cta: 0, top_hosts: [] };
  let leakSum = 0;
  for (const x of results) {
    if (typeof x.leak_score === "number") { leakSum += x.leak_score; r.with_signals++; }
    if (!(x.https_ok)) r.no_ssl++;
    if (!(x.has_booking_cta)) r.no_booking_cta++;
  }
  r.avg_leak = r.with_signals ? Math.round(leakSum / r.with_signals * 10) / 10 : 0;
  r.top_hosts = results
    .filter((x) => typeof x.leak_score === "number")
    .sort((a,b) => b.leak_score - a.leak_score)
    .slice(0, 5)
    .map((x) => ({ host: x.root_domain, leak_score: x.leak_score, signals: x.leak_signals?.slice(0, 4) || [] }));
  return r;
}
