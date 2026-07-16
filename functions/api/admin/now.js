// /api/admin/now
// The single endpoint powering the "⚡ Now" tab.
// Aggregates 3 columns of work (now / today / week) + KPI strip + ops footer.

import { verifyAdminToken, json, corsHeaders } from "../_shared/adminAuth.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestGet({ request, env }) {
  // Accept either an admin session token OR the GOV_INGEST_TOKEN (machine-to-machine)
  const authHeader = request.headers.get("authorization") || "";
  let authorized = false;
  if (authHeader.startsWith("Bearer ")) {
    const tok = authHeader.slice(7);
    if (tok && env.GOV_INGEST_TOKEN && tok === env.GOV_INGEST_TOKEN) {
      authorized = true;
    } else {
      const a = await verifyAdminToken(request, env);
      if (a.ok) authorized = true;
    }
  }
  if (!authorized) return json({ ok: false, error: "unauthorized" }, 401, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  const now = new Date();
  const isoNow = now.toISOString();

  // Counts
  const countQ = async (sql, params = []) => {
    try {
      const r = await env.LEADS_DB.prepare(sql).bind(...params).first();
      return r?.n || 0;
    } catch { return 0; }
  };

  const counts = {
    sam_active:         await countQ("SELECT COUNT(*) as n FROM gov_opportunities WHERE stage IN ('discovery','evaluating','drafting')"),
    sam_due_48h:         await countQ("SELECT COUNT(*) as n FROM gov_opportunities WHERE response_deadline <= datetime('now', '+2 day') AND stage NOT IN ('won','lost','archived','no_bid')"),
    prospects_live:     await countQ("SELECT COUNT(*) as n FROM prospects WHERE status NOT IN ('archived','rejected')"),
    drafts_to_review:   await countQ("SELECT COUNT(*) as n FROM auto_tender_runs WHERE status = 'completed'"),
    outreach_due:       await countQ("SELECT COUNT(*) as n FROM outreach_steps WHERE status IN ('queued','approved') AND scheduled_for <= datetime('now')"),
    replies_24h:        await countQ("SELECT COUNT(*) as n FROM prospect_replies WHERE received_at >= datetime('now', '-1 day')"),
    won_30d:            await countQ("SELECT COUNT(*) as n FROM opportunity_decisions WHERE outcome = 'won' AND decided_at >= datetime('now', '-30 day')"),
    pipeline_value:     await countQ("SELECT COALESCE(SUM(COALESCE(estimated_value_usd, 0)), 0) as n FROM auto_tender_runs WHERE status IN ('completed','approved')"),
  };

  // Bucket 1 — NOW (deadline <=48h + recent replies + Won since 1d)
  const now_bucket = [];

  // SAM items due within 48h (sorted by deadline asc)
  const dueRows = await env.LEADS_DB.prepare(`
    SELECT id, title, agency, set_aside, response_deadline, fit_score, stage
    FROM gov_opportunities
    WHERE response_deadline IS NOT NULL AND response_deadline != ''
      AND date(response_deadline) <= date(?, '+2 day')
      AND stage NOT IN ('won','lost','archived','no_bid')
    ORDER BY date(response_deadline) ASC
    LIMIT 8
  `).bind(isoNow).all().catch(() => ({ results: [] }));

  for (const r of dueRows.results || []) {
    const daysLeft = Math.ceil((new Date(r.response_deadline).getTime() - now.getTime()) / (1000*60*60*24));
    now_bucket.push({
      kind: "sam",
      id: r.id,
      title: r.title,
      subtitle: `${r.agency || "?"} · ${r.set_aside || ""}`.slice(0, 90),
      stage: r.stage,
      fit_score: r.fit_score ?? null,
      deadline_in_days: daysLeft,
      suggestion: daysLeft <= 1 ? "🚨 Run /admin/auto-tender pipeline NOW" : "Drop a draft today — deadline is close",
      deeplink: `/admin/leads?focus=${encodeURIComponent(r.id)}`,
    });
  }

  // Recent replies (last 24h)
  const replyRows = await env.LEADS_DB.prepare(`
    SELECT id, prospect_id, from_email, subject, received_at, classification
    FROM prospect_replies WHERE received_at >= datetime('now', '-1 day')
    ORDER BY received_at DESC LIMIT 6
  `).all().catch(() => ({ results: [] }));
  for (const r of replyRows.results || []) {
    const tag = r.classification || "unknown";
    const tone = tag === "interested" ? "🔥 interested" : tag === "not_interested" ? "❌ not interested" : tag === "unsubscribe" ? "🚫 unsub" : tag === "bounce" ? "⚠️ bounced" : "❓ unclassified";
    now_bucket.push({
      kind: "reply",
      id: r.prospect_id,
      title: r.subject || "(no subject)",
      subtitle: `${tag} · ${r.from_email || ""}`,
      suggestion: tone,
      deeplink: `/admin/replies`,
    });
  }

  // Bucket 2 — TODAY
  const today_bucket = [];

  // Outreach due now (any status queued/approved, scheduled_for <= now)
  const outreachDue = await env.LEADS_DB.prepare(`
    SELECT id, prospect_id, subject, scheduled_for, status, step_no
    FROM outreach_steps
    WHERE status IN ('queued','approved') AND scheduled_for <= datetime('now')
    ORDER BY scheduled_for ASC LIMIT 10
  `).all().catch(() => ({ results: [] }));
  for (const o of outreachDue.results || []) {
    today_bucket.push({
      kind: "outreach",
      id: o.prospect_id,
      title: `Step ${o.step_no || "?"}: ${o.subject || "(draft)"}`,
      subtitle: `Scheduled ${o.scheduled_for?.slice(0,16) || ""}`,
      suggestion: o.status === "approved" ? "📤 ready to send" : "🕒 review & approve",
      deeplink: `/admin/outreach`,
    });
  }

  // Auto-tender drafts pending review
  const autoPending = await env.LEADS_DB.prepare(`
    SELECT id, sam_item_id, sam_item_title, sam_item_deadline, created_at
    FROM auto_tender_runs WHERE status = 'completed'
    ORDER BY created_at DESC LIMIT 6
  `).all().catch(() => ({ results: [] }));
  for (const r of autoPending.results || []) {
    today_bucket.push({
      kind: "auto_tender",
      id: r.sam_item_id,
      title: r.sam_item_title || "(unknown)",
      subtitle: `Auto-tender draft ready · deadline ${r.sam_item_deadline?.slice(0,10) || "?"}`,
      suggestion: "Read the cover letter, click Approve",
      deeplink: `/admin/auto-tender`,
    });
  }

  // Bucket 3 — WEEK (everything not urgent, but visible)
  const week_bucket = [];

  // Top 5 prospects with highest leak_score (not yet contacted)
  const hotProspects = await env.LEADS_DB.prepare(`
    SELECT p.id, p.business_name, p.root_domain, p.city, s.leak_score
    FROM prospects p
    LEFT JOIN prospect_signals s ON s.id = (SELECT id FROM prospect_signals WHERE prospect_id = p.id ORDER BY scanned_at DESC LIMIT 1)
    WHERE p.status NOT IN ('archived','rejected')
    ORDER BY s.leak_score DESC NULLS LAST
    LIMIT 5
  `).all().catch(() => ({ results: [] }));
  for (const p of hotProspects.results || []) {
    week_bucket.push({
      kind: "prospect",
      id: p.id,
      title: p.business_name,
      subtitle: `${p.root_domain} · leak ${p.leak_score ?? "?"}/100`,
      leak_score: p.leak_score,
      suggestion: "Personalized outreach + Deep evaluate",
      deeplink: `/admin/leads?focus=${encodeURIComponent(p.id)}`,
    });
  }

  // Ops footer
  const lastCron = await env.LEADS_DB.prepare(`
    SELECT triggered_at, payload_json FROM opportunity_events WHERE event_type = 'cron_run'
    ORDER BY created_at DESC LIMIT 1
  `).first().catch(() => null);
  let cronSummary = null;
  try {
    if (lastCron && lastCron.payload_json) {
      const obj = JSON.parse(lastCron.payload_json);
      cronSummary = {
        triggered_at: lastCron.triggered_at,
        status: obj.ok === false ? "error" : "ok",
      };
    }
  } catch {}

  // Errors in last 24h
  const errCount = await countQ(`
    SELECT COUNT(*) as n FROM opportunity_events
    WHERE event_type IN ('error','exception')
      AND created_at >= datetime('now', '-1 day')
  `);

  return json({
    ok: true,
    updatedAt: isoNow,
    counts,
    buckets: { now: now_bucket, today: today_bucket, week: week_bucket },
    ops: {
      last_cron: cronSummary,
      ai_spend_today: 0,        // TODO wire to LLM cost log
      llm_calls_today: 0,
      errors_24h: errCount,
      last_backup: { at: new Date().toISOString().slice(0,10) },  // TODO real
    },
    tone: (counts.sam_due_48h > 0 || counts.replies_24h > 0) ? "hot" : "calm",
  }, 200, request, env);
}
