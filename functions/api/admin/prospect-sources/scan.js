// POST /api/admin/prospect-sources/scan
//
// Owner-triggered batch fetch + leak-score against real live URLs.
//
// Body:
//   {
//     seed?: [{ business_name, website, root_domain, source?, vertical?, city?, email?, phone? }, ...],
//     scan_existing?: true,           // also re-scan the existing prospects
//     auto_promote?: true (default),
//     max_concurrency?: 4,
//   }

import { verifyAdminToken, json, corsHeaders } from "../../_shared/adminAuth.js";
import {
  looksLikeTestDomain,
  scanOne,
  summarize,
} from "../../_shared/prospectScan.js";

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
  const autoPromote = body?.auto_promote !== false;
  const userAgent = body?.user_agent || "Mozilla/5.0 (compatible; MehyarSoftBot/1.0; +https://mehyar.us/bot)";
  const runId = `run_${Date.now()}_${crypto.randomUUID().slice(0,8)}`;

  // Build queue
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
    `).all().catch(() => null);
    for (const r of existing?.results || []) {
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

  // Process with bounded parallelism.
  const results = [];
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

  // Persist
  const now = new Date().toISOString();
  let promoted = 0;
  let signalsInserted = 0;
  const promotedIds = [];
  const brokenExamples = [];

  for (const r of results) {
    if (!r.http_ok && !r.error) continue;
    if (r.error) { brokenExamples.push({ host: r.root_domain, err: r.error }); continue; }
    if (looksLikeTestDomain(r.root_domain)) { brokenExamples.push({ host: r.root_domain, err: "looks_like_test_domain" }); continue; }

    let prospectId = r.prospect_id;
    if (!prospectId) {
      const existing = await env.LEADS_DB.prepare(`SELECT id FROM prospects WHERE root_domain = ? LIMIT 1`).bind(r.root_domain).first().catch(() => null);
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
        if (autoPromote) { promoted++; promotedIds.push(prospectId); }
      }
    } else {
      try { await env.LEADS_DB.prepare(`UPDATE prospects SET last_scanned_at=?, last_touched_at=?, updated_at=? WHERE id=?`).bind(now, now, now, prospectId).run(); } catch {}
    }

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
        prospectId, now,
        r.http_ok ? 1 : 0, r.https_ok ? 1 : 0,
        r.redirect_url || "", r.status_code || 0,
        r.title || "",
        r.has_viewport ? 1 : 0, r.has_booking_cta ? 1 : 0, r.has_phone_click_to_call ? 1 : 0,
        r.has_form_action ? 1 : 0, r.has_email_link ? 1 : 0, r.has_address ? 1 : 0,
        r.has_ssl ? 1 : 0,
        r.page_weight_kb || 0, r.load_time_ms || 0,
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
    `).bind(`audit_scan_${runId}`, JSON.stringify({ run_id: runId, queue_size: queue.length, results: results.length, promoted, signals_inserted: signalsInserted, broken_examples: brokenExamples }).slice(0, 8000), now).run();
  } catch {}

  return json({
    ok: true,
    run_id: runId,
    queued: queue.length,
    scanned: results.length,
    signals_inserted: signalsInserted,
    promoted,
    promoted_ids: promotedIds,
    rejected_examples: brokenExamples,
    summary: summarize(results),
    updatedAt: now,
  }, 200, request, env);
}

// ── URL normalization (kept here, not in shared, to avoid the cross-folder import) ─
function normalizeUrl(input) {
  if (!input) return null;
  const s = String(input).trim();
  let candidate = s;
  if (!/^https?:\/\//i.test(candidate)) candidate = "https://" + candidate;
  try {
    const u = new URL(candidate);
    if (u.hostname === "localhost" || u.hostname.endsWith(".local") || u.hostname === "0.0.0.0") return null;
    return { full: u.toString().replace(/\/$/, ""), host: u.hostname.toLowerCase() };
  } catch { return null; }
}
