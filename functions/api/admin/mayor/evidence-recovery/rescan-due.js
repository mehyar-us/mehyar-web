// POST /api/admin/mayor/evidence-recovery/rescan-due
//
// Batch recovery for prospects blocked by the evidence gate. It does not
// draft or send email. It only rescans prospects whose latest signal is empty,
// missing, or non-citable, then reports which leads became draftable.

import { verifyAdminToken, json, corsHeaders } from "../../../_shared/adminAuth.js";
import { onRequestPost as rescanProspect } from "../../../mayor/prospect/[id]/rescan.js";

const CITABLE_SIGNAL_KEYS = [
  "no_https",
  "slow_load",
  "heavy_page",
  "large_page",
  "no_viewport",
  "no_booking_cta",
  "no_phone_link",
  "no_phone_cta",
  "no_form_action",
  "no_email_link",
  "no_address",
  "platform_generic",
  "generic_template",
  "iframes_only",
];

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestPost({ request, env }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  let body = {};
  try { body = await request.json(); } catch {}
  const limit = clampInt(body?.limit, 1, 25, 8);
  const force = body?.force === true;
  const db = env.LEADS_DB;

  const candidates = await loadCandidates(db, limit, force);
  const results = [];
  const authRequest = new Request(request.url, {
    method: "POST",
    headers: request.headers,
  });

  for (const candidate of candidates) {
    try {
      const response = await rescanProspect({ request: authRequest, env, params: { id: candidate.id } });
      const payload = await response.json().catch(() => ({}));
      const citable = Array.isArray(payload?.leaks) && payload.leaks.some((signal) => CITABLE_SIGNAL_KEYS.includes(signal));
      results.push({
        prospect_id: candidate.id,
        business_name: candidate.business_name,
        root_domain: candidate.root_domain,
        previous_quality: classifySignal(candidate),
        ok: response.ok && payload?.ok !== false,
        status: response.status,
        citable,
        score: payload?.score ?? null,
        leaks: payload?.leaks || [],
        error: payload?.error || "",
        message: payload?.message || "",
      });
    } catch (error) {
      results.push({
        prospect_id: candidate.id,
        business_name: candidate.business_name,
        root_domain: candidate.root_domain,
        previous_quality: classifySignal(candidate),
        ok: false,
        citable: false,
        error: "rescan_failed",
        message: String(error?.message || error),
      });
    }
  }

  const recovered = results.filter((r) => r.ok && r.citable).length;
  const stillBlocked = results.filter((r) => r.ok && !r.citable).length;
  const failed = results.filter((r) => !r.ok).length;

  await db.prepare(`
    INSERT INTO mayor_events (id, kind, loop, summary, details_json, created_at)
    VALUES (?, 'discovery', 'evidence_recovery', ?, ?, datetime('now'))
  `).bind(
    crypto.randomUUID(),
    `Evidence recovery rescanned ${results.length}; ${recovered} became draftable`,
    JSON.stringify({ recovered, still_blocked: stillBlocked, failed, results }).slice(0, 12000),
  ).run().catch(() => {});

  return json({
    ok: true,
    scanned: results.length,
    recovered,
    still_blocked: stillBlocked,
    failed,
    candidates_remaining_hint: candidates.length === limit ? "more_may_exist" : "none_in_batch",
    results,
    review_href: "/admin/mayor",
  }, 200, request, env);
}

async function loadCandidates(db, limit, force) {
  const citableLike = CITABLE_SIGNAL_KEYS.map(() => "COALESCE(sig.leak_signals_json, '') LIKE ?").join(" OR ");
  const freshnessClause = force
    ? ""
    : "AND (p.last_scanned_at IS NULL OR p.last_scanned_at <= datetime('now','-6 hour'))";
  const sql = `
    SELECT
      p.id, p.business_name, p.website, p.root_domain, p.email, p.status, p.last_scanned_at,
      sig.leak_signals_json, COALESCE(sig.leak_score, 0) AS leak_score, sig.scanned_at
    FROM prospects p
    LEFT JOIN prospect_signals sig ON sig.id = (
      SELECT id FROM prospect_signals WHERE prospect_id = p.id ORDER BY scanned_at DESC LIMIT 1
    )
    WHERE COALESCE(p.status, '') NOT IN ('archived','won','lost','unsubscribed','rejected')
      AND COALESCE(p.email, '') != ''
      AND COALESCE(p.email, '') NOT LIKE '%.example.com'
      AND COALESCE(p.email, '') NOT LIKE '%.test'
      AND COALESCE(p.email, '') NOT LIKE '%.invalid'
      AND COALESCE(p.website, p.root_domain, '') != ''
      ${freshnessClause}
      AND NOT (${citableLike})
    ORDER BY
      CASE WHEN sig.id IS NULL THEN 0 ELSE 1 END,
      COALESCE(p.last_scanned_at, p.created_at) ASC
    LIMIT ?
  `;
  const args = [...CITABLE_SIGNAL_KEYS.map((signal) => `%${signal}%`), limit];
  const rows = await db.prepare(sql).bind(...args).all().catch(() => ({ results: [] }));
  return rows.results || [];
}

function classifySignal(row) {
  const raw = String(row?.leak_signals_json || "");
  if (!raw) return "no_signal";
  if (raw === "[]") return "clean_no_signal";
  if (raw === "[\"fetch_failed\"]") return "fetch_failed_only";
  if (CITABLE_SIGNAL_KEYS.some((signal) => raw.includes(signal))) return "citable";
  return Number(row?.leak_score || 0) > 0 ? "non_citable_score" : "weak_other";
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
