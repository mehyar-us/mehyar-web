// /api/mayor/health — observability snapshot.
//
// Returns the live state of every Mayor engine subsystem in one round-trip:
//   - Env vars reaching runtime (which keys are present, which are missing)
//   - DB tables row counts (sanity check that migration ran)
//   - Last-run timestamps for every loop (discovery, outreach, followup, digest)
//   - Queue depth (queued sends, open drafts, unreplied replies)
//   - Error counts (last 24h / 7d)
//   - Loop health flags (warmup day, cap remaining, pause state, bounce rate)
//   - Funnel (prospects → worked → delivered → interested)
//
// Used by the AdminMayor "Live" tab health badge + the Cron Worker pre-flight
// check before kicking off /api/admin/cron/run.

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

  const out = { ok: true, ts: new Date().toISOString() };

  // ── Env var health ────────────────────────────────────────────────────────
  const envChecks = {
    LEADS_DB:               !!env?.LEADS_DB,
    MAYOR_FROM_EMAIL:       !!env?.MAYOR_FROM_EMAIL,
    MAYOR_REPLY_TO:         !!env?.MAYOR_REPLY_TO,
    MAYOR_PHYSICAL_ADDRESS: !!env?.MAYOR_PHYSICAL_ADDRESS,
    CF_EMAIL_ACCOUNT_ID:    !!(env?.CF_EMAIL_ACCOUNT_ID || env?.CLOUDFLARE_ACCOUNT_ID),
    CF_EMAIL_GLOBAL_KEY:    !!(env?.CF_EMAIL_GLOBAL_KEY || env?.CLOUDFLARE_API_TOKEN),
    GOOGLE_PLACES_API_KEY:  !!(env?.GOOGLE_PLACES_API_KEY || env?.MEHYAR_GOOGLE_PLACES_API_KEY),
    GOV_INGEST_TOKEN:       !!env?.GOV_INGEST_TOKEN,
    ADMIN_TOKEN_KV:         !!env?.ADMIN_TOKEN_KV,
    CLOUDFLARE_EMAIL:       !!env?.CLOUDFLARE_EMAIL,
  };
  out.env_health = {
    keys: envChecks,
    total_present: Object.values(envChecks).filter(Boolean).length,
    total_expected: Object.keys(envChecks).length,
    degraded: !envChecks.LEADS_DB || !envChecks.CF_EMAIL_GLOBAL_KEY || !envChecks.MAYOR_FROM_EMAIL,
  };

  if (!env?.LEADS_DB) {
    out.db_counts = { _error: "missing_db" };
    out.last_runs = {};
    out.queue = {};
    out.errors = {};
    out.verdict = ["DEGRADED — LEADS_DB binding missing"];
    out.color = "red";
    return json(out, 200, request, env);
  }
  const db = env.LEADS_DB;

  // ── DB row counts (sanity) ───────────────────────────────────────────────
  try {
    const tableList = ["prospects", "prospect_signals", "prospect_drafts", "prospect_sends", "prospect_replies", "mayor_events", "mayor_settings", "mayor_replies", "prospect_sequences"];
    const counts = {};
    for (const t of tableList) {
      try {
        const { results } = await db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).all();
        counts[t] = results?.[0]?.n ?? -1;
      } catch (e) {
        counts[t] = -1;
      }
    }
    out.db_counts = counts;
  } catch (e) {
    out.db_counts = { _error: String(e?.message || e) };
  }

  // ── Last runs (from mayor_settings) ──────────────────────────────────────
  out.last_runs = {
    discovery:  null,
    outreach:   null,
    followup:   null,
    digest:     null,
    weekly:     null,
  };
  try {
    const { results } = await db.prepare(`SELECT key, value FROM mayor_settings`).all();
    const s = {};
    for (const r of (results || [])) s[r.key] = r.value;
    out.last_runs.discovery = s.discovered_at || null;
    out.last_runs.outreach  = s.outreach_run_at || null;
    out.last_runs.followup  = s.followup_run_at || null;
    out.last_runs.digest    = s.digest_run_at || null;
    out.last_runs.weekly    = s.weekly_run_at || null;
    out.warmup_day          = parseInt(s.warmup_day || "0", 10);
    out.daily_sent_count    = parseInt(s.daily_sent_count || "0", 10);
    out.daily_cap           = parseInt(s.daily_email_cap || "25", 10);
    out.cap_remaining       = Math.max(0, out.daily_cap - out.daily_sent_count);
    out.paused              = !!parseInt(s.paused_forever || "0", 10) || (!!s.paused_until && new Date(s.paused_until).getTime() > Date.now());
    out.paused_until        = s.paused_until || null;
    out.auto_send           = s.auto_send !== "0";
    out.bounce_rate_alert   = parseFloat(s.bounce_rate_alert || "0.10");
  } catch (e) {
    out.last_runs._error = String(e?.message || e);
  }

  // ── Queue depth ──────────────────────────────────────────────────────────
  try {
    const { results: drafts } = await db.prepare(`
      SELECT status, COUNT(*) AS n FROM prospect_drafts GROUP BY status
    `).all();
    const { results: sends } = await db.prepare(`
      SELECT status, COUNT(*) AS n FROM prospect_sends
       WHERE created_at >= datetime('now', '-30 days')
       GROUP BY status
    `).all();
    const { results: replies } = await db.prepare(`
      SELECT classification, COUNT(*) AS n FROM prospect_replies
       WHERE received_at >= datetime('now', '-30 days')
       GROUP BY classification
    `).all();
    out.queue = {
      drafts: Object.fromEntries((drafts || []).map((r) => [r.status, r.n])),
      sends_30d: Object.fromEntries((sends || []).map((r) => [r.status, r.n])),
      replies_30d: Object.fromEntries((replies || []).map((r) => [r.classification || "unclassified", r.n])),
      queued_for_send: (sends || []).filter((r) => r.status === "queued").reduce((a, r) => a + r.n, 0),
      open_drafts: (drafts || []).filter((r) => r.status === "draft").reduce((a, r) => a + r.n, 0),
    };
  } catch (e) {
    out.queue = { _error: String(e?.message || e) };
  }

  // ── Errors last 24h / 7d ──────────────────────────────────────────────────
  try {
    const { results: err24 } = await db.prepare(`
      SELECT COUNT(*) AS n FROM mayor_events WHERE kind = 'error' AND created_at >= datetime('now', '-1 day')
    `).all();
    const { results: err7 } = await db.prepare(`
      SELECT COUNT(*) AS n FROM mayor_events WHERE kind = 'error' AND created_at >= datetime('now', '-7 days')
    `).all();
    const { results: lastErrs } = await db.prepare(`
      SELECT id, summary, created_at FROM mayor_events WHERE kind = 'error' ORDER BY created_at DESC LIMIT 5
    `).all();
    out.errors = {
      last_24h: err24?.[0]?.n ?? 0,
      last_7d:  err7?.[0]?.n ?? 0,
      recent:   lastErrs || [],
    };
  } catch (e) {
    out.errors = { _error: String(e?.message || e) };
  }

  // ── Bounce rate (last 30 days) ────────────────────────────────────────────
  try {
    const { results: bs } = await db.prepare(`
      SELECT
        SUM(CASE WHEN status IN ('sent','delivered','replied') THEN 1 ELSE 0 END) AS delivered,
        SUM(CASE WHEN status = 'bounced' THEN 1 ELSE 0 END) AS bounced,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN status = 'skipped_suppressed' THEN 1 ELSE 0 END) AS skipped,
        COUNT(*) AS total
      FROM prospect_sends
      WHERE created_at >= datetime('now', '-30 days')
    `).all();
    const r = bs?.[0] || {};
    const delivered = r.delivered || 0;
    const bounced = r.bounced || 0;
    const failed = r.failed || 0;
    out.bounce_rate_30d = delivered > 0 ? bounced / delivered : 0;
    out.send_stats_30d = {
      total: r.total || 0,
      delivered, bounced, failed, skipped: r.skipped || 0,
      delivery_rate: r.total > 0 ? delivered / r.total : 0,
    };
  } catch (e) {
    out.bounce_rate_30d = null;
    out.send_stats_30d = { _error: String(e?.message || e) };
  }

  // ── Funnel counts (the money view) ────────────────────────────────────────
  try {
    const { results: fr } = await db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM prospects) AS prospects,
        (SELECT COUNT(*) FROM prospects WHERE status IN ('drafted','approved','queued','sent')) AS worked,
        (SELECT COUNT(*) FROM prospect_sends WHERE status IN ('sent','delivered','replied')) AS delivered,
        (SELECT COUNT(*) FROM prospect_replies WHERE classification = 'interest') AS interested,
        (SELECT COUNT(*) FROM prospect_replies WHERE classification IN ('objection','not_interested','unsubscribe','stop')) AS rejected,
        (SELECT COUNT(DISTINCT prospect_id) FROM prospect_replies WHERE classification = 'interest' AND received_at >= datetime('now', '-7 days')) AS interested_7d
    `).all();
    const r = fr?.[0] || {};
    out.funnel = {
      prospects: r.prospects || 0,
      worked:    r.worked || 0,
      delivered: r.delivered || 0,
      interested: r.interested || 0,
      rejected:  r.rejected || 0,
      interested_7d: r.interested_7d || 0,
      contact_to_interest: r.delivered > 0 ? r.interested / r.delivered : 0,
    };
  } catch (e) {
    out.funnel = { _error: String(e?.message || e) };
  }

  // ── Health verdict ────────────────────────────────────────────────────────
  const verdicts = [];
  if (out.env_health.degraded) verdicts.push("DEGRADED — missing required env vars");
  if (out.paused) verdicts.push(`PAUSED ${out.paused_until ? "until " + out.paused_until : "forever"}`);
  if (out.bounce_rate_30d !== null && out.bounce_rate_30d > out.bounce_rate_alert) verdicts.push(`HIGH BOUNCE — ${(out.bounce_rate_30d * 100).toFixed(1)}% over 30d (alert at ${(out.bounce_rate_alert * 100).toFixed(0)}%)`);
  if ((out.errors?.last_24h ?? 0) >= 3) verdicts.push(`${out.errors.last_24h} errors in last 24h`);
  if ((out.queue?.queued_for_send ?? 0) > 50) verdicts.push(`${out.queue.queued_for_send} sends queued — backlog growing`);
  if (verdicts.length === 0) verdicts.push("HEALTHY");
  out.verdict = verdicts;
  out.color = verdicts[0] === "HEALTHY" ? "emerald" : (verdicts[0].includes("PAUSED") ? "zinc" : (verdicts[0].includes("DEGRADED") || verdicts[0].includes("HIGH BOUNCE") ? "red" : "amber"));

  return json(out, 200, request, env);
}