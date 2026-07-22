// GET /api/admin/dashboard/now
//
// ONE-CALL consolidated state for the /admin/mayor and /admin/now views.
// Parallel-fans-out to: mayor/health, prospects count, draft queue, replies
// needing action, SAM deadlines, contracts state — and CALLS CLOUDFLARE AI
// (via _shared/cloudflareAI.js) to compose a 2-line "what to do first today"
// insight.
//
// This is the only endpoint the calm Mayor page hits for its full render.
// All the data flows through one round-trip → 30s poll cycle → low CF cost.

import { verifyAdminToken, json, corsHeaders } from "../../_shared/adminAuth.js";
import { summarize } from "../../_shared/cloudflareAI.js";

const SAFE_FAILURE = "Dashboard unavailable.";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestGet({ request, env }) {
  if (!env?.LEADS_DB) return json({ ok: false, message: SAFE_FAILURE }, 500, request, env);
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, message: auth.message }, auth.status, request, env);

  const t0 = Date.now();
  const db = env.LEADS_DB;

  // ── Parallel fanout (no LLM yet) ──────────────────────────────────────
  const [
    mayorHealth,
    leadsToday,
    prospectsTotal,
    queuedForSend,
    openDrafts,
    draftsPending,
    repliesNeedingAction,
    samCount,
    samDue48h,
    contractsActive,
    contractValueActive,
    errorsLast24,
    cronLast,
    suppressionTotal,
  ] = await Promise.all([
    fetchMayor(env).catch(() => null),
    db.prepare(`
      SELECT COUNT(*) AS n,
             SUM(CASE WHEN created_at >= datetime('now','-1 day') THEN 1 ELSE 0 END) AS today
      FROM leads
    `).first().catch(() => ({ n: 0, today: 0 })),
    db.prepare(`SELECT COUNT(*) AS n FROM prospects`).first().catch(() => ({ n: 0 })),
    db.prepare(`SELECT COUNT(*) AS n FROM prospect_sequences WHERE status = 'queued'`)
      .first().catch(() => ({ n: 0 })),
    db.prepare(`SELECT COUNT(*) AS n FROM prospect_drafts WHERE status = 'draft'`)
      .first().catch(() => ({ n: 0 })),
    db.prepare(`SELECT COUNT(*) AS n FROM prospect_drafts WHERE status = 'draft'`)
      .first().catch(() => ({ n: 0 })),
    db.prepare(`SELECT COUNT(*) AS n FROM prospect_replies WHERE needs_action = 1`)
      .first().catch(() => ({ n: 0 })),
    db.prepare(`SELECT COUNT(*) AS n FROM gov_opportunities WHERE status IS NULL OR status NOT IN ('archived','won','lost')`)
      .first().catch(() => ({ n: 0 })),
    db.prepare(`
      SELECT COUNT(*) AS n
      FROM gov_opportunities
      WHERE response_deadline IS NOT NULL
        AND response_deadline >= datetime('now')
        AND response_deadline <= datetime('now','+48 hours')
        AND (status IS NULL OR status NOT IN ('archived','won','lost'))
    `).first().catch(() => ({ n: 0 })),
    db.prepare(`SELECT COUNT(*) AS n FROM prospect_contracts WHERE status IN ('draft','sent','signed')`)
      .first().catch(() => ({ n: 0 })),
    db.prepare(`
      SELECT COALESCE(SUM(value_usd),0) AS v
      FROM prospect_contracts
      WHERE status IN ('sent','signed')
    `).first().catch(() => ({ v: 0 })),
    db.prepare(`SELECT COUNT(*) AS n FROM mayor_events WHERE kind = 'error' AND created_at >= datetime('now','-24 hours')`)
      .first().catch(() => ({ n: 0 })),
    db.prepare(`SELECT triggered_at, status, name FROM cron_runs ORDER BY triggered_at DESC LIMIT 1`)
      .first().catch(() => null),
    db.prepare(`SELECT COUNT(*) AS n FROM suppression_list`).first().catch(() => ({ n: 0 })),
  ]);

  // ── Build the "what to do first today" prompt ─────────────────────────
  const engagementState = {
    paused: mayorHealth?.paused || false,
    daily_sent: mayorHealth?.sent_today || 0,
    daily_cap: mayorHealth?.cap || 100,
    warmup_day: mayorHealth?.warmup_day || 0,
    funnel: mayorHealth?.funnel || {},
    queue: {
      queued_for_send: Number(queuedForSend?.n || 0),
      open_drafts: Number(openDrafts?.n || 0),
      pending_review: Number(draftsPending?.n || 0),
    },
    leads: {
      total_today: Number(leadsToday?.today || 0),
      total_all_time: Number(leadsToday?.n || 0),
    },
    sam: {
      active: Number(samCount?.n || 0),
      due_48h: Number(samDue48h?.n || 0),
    },
    contracts: {
      active_count: Number(contractsActive?.n || 0),
      active_value: Number(contractValueActive?.v || 0),
    },
    ops: {
      errors_24h: Number(errorsLast24?.n || 0),
      cron_last: cronLast ? {
        name: cronLast.name,
        triggered_at: cronLast.triggered_at,
        status: cronLast.status,
      } : null,
      suppression_total: Number(suppressionTotal?.n || 0),
    },
    replies_needing_action: Number(repliesNeedingAction?.n || 0),
  };

  // AI insight via CF Workers AI (uses the lowest-cost call path; cached).
  // We post-process the text into structured action chips so the UI can
  // render clickable links — even though the LLM generated plain prose.
  let insight = await composeInsight(env, engagementState).catch((e) => ({
    used_llm: false,
    content: heuristicInsight(engagementState),
    parsed: null,
    latency_ms: 0,
    neurons: 0,
    provider: "heuristic",
    model: "n/a",
    error: String(e?.message || e),
  }));
  insight.actions = buildInsightActions(insight.content || "", engagementState);

  return json({
    ok: true,
    generated_at: new Date().toISOString(),
    duration_ms: Date.now() - t0,
    state: engagementState,
    insight,
    mayor_health: mayorHealth || null,
  }, 200, request, env);
}

async function fetchMayor(env) {
  const token = env.GOV_INGEST_TOKEN;
  if (!token) return null;
  const origin = "https://mehyar.us";
  const t = Date.now();
  const r = await fetch(`${origin}/api/mayor/health`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) return null;
  const j = await r.json();
  return {
    paused: j.paused,
    cap: j.daily_cap,
    sent_today: j.daily_sent_count,
    cap_remaining: j.cap_remaining,
    warmup_day: j.warmup_day,
    funnel: j.funnel,
    last_runs: j.last_runs,
    errors_24h: j.errors?.last_24h,
  };
}

// Compose the prompt + call CF AI for the "what to do first today" insight.
async function composeInsight(env, s) {
  const prompt = `State (JSON):\n${JSON.stringify(s, null, 0).slice(0, 2000)}\n\n` +
    `What is the single highest-leverage action the founder should take RIGHT NOW? ` +
    `Reply in 2-3 short sentences. Be concrete (action verb + target number). No fluff, no emojis.`;

  const out = await summarize(env, prompt, {
    system:
      `You are the Mayors stand-in briefing for a one-person consultancy founder. ` +
      `No ceremony, no preamble, no "I recommend". Direct: "Reply to 3 interested Brooklyn leads. ` +
      `Draft post for SAM opp X078 by tonight." Two sentences max. Plain text only.`,
    max_tokens: 120,
  });
  return out;
}

// Deterministic fallback used when LLM is unavailable — same shape.
function heuristicInsight(s) {
  const lines = [];
  if (s.paused) lines.push(`Mayor is paused — resume it from the Mayor page if you want activity today.`);
  else if (s.queue.open_drafts > 0)
    lines.push(`Review ${s.queue.open_drafts} open draft${s.queue.open_drafts === 1 ? "" : "s"} in CRM; ${s.queue.queued_for_send} queued for send.`);
  else if (s.sam.due_48h > 0)
    lines.push(`${s.sam.due_48h} SAM opps due in the next 48h — open the Daily picks and deep-evaluate the top one.`);
  else lines.push(`Inbox zero on drafts and SAM. Mayor is running steady.`);
  if (s.replies_needing_action > 0)
    lines.push(`${s.replies_needing_action} repl${s.replies_needing_action === 1 ? "y" : "ies"} need your eyes in the Replies tab.`);
  if (s.ops.errors_24h > 0)
    lines.push(`Engine logged ${s.ops.errors_24h} error${s.ops.errors_24h === 1 ? "" : "s"} in the last 24h — check the SYSTEM tab.`);
  if (lines.length === 0) lines.push(`All clear. Mayor is running and there's nothing urgent. Watch the cron logs.`);
  return lines.join(" ");
}

// Convert the LLM/heuristic prose into structured action chips the dashboard
// can render as clickable buttons. We match against noun phrases that map
// cleanly to canonical CRM routes — no fancy NLP required.
function buildInsightActions(text, s) {
  const actions = [];
  const low = String(text || "").toLowerCase();
  const has = (kw) => low.includes(kw);

  // Always offer the highest-leverage action first if its count is non-zero.
  if ((s.queue?.open_drafts || 0) > 0 || has("draft")) {
    actions.push({ label: `📝 Review ${s.queue?.open_drafts || 0} draft${(s.queue?.open_drafts || 0) === 1 ? "" : "s"}`, href: "/admin/leads?kind=all&stage=draft_needed", tone: "violet" });
  }
  if ((s.queue?.queued_for_send || 0) > 0 || has("queued")) {
    actions.push({ label: `📤 Approve ${s.queue?.queued_for_send || 0} outreach send`, href: "/admin/money#outreach-queue", tone: "amber" });
  }
  if ((s.replies_needing_action || 0) > 0 || has("repl")) {
    actions.push({ label: `💌 Open ${s.replies_needing_action || 0} replies`, href: "/admin/leads?kind=replies", tone: "emerald" });
  }
  if ((s.sam?.due_48h || 0) > 0 || has("sam") || has("due")) {
    actions.push({ label: `🏛 ${s.sam?.due_48h || 0} SAM due in 48h`, href: "/admin/leads?kind=sam&sort=deadline_asc", tone: "red" });
  }
  if ((s.ops?.errors_24h || 0) > 0 || has("error")) {
    actions.push({ label: `⚠ ${s.ops?.errors_24h || 0} engine error${(s.ops?.errors_24h || 0) === 1 ? "" : "s"}`, href: "/admin/system", tone: "amber" });
  }
  if (s.paused || has("paused") || has("resume")) {
    actions.push({ label: `▶ Resume Mayor`, href: "/admin/mayor", tone: "violet" });
  }

  // Always provide a fallback so the panel never feels empty.
  if (actions.length === 0) {
    actions.push({ label: "🔄 Refresh state", href: "/admin/now", tone: "sky" });
  }
  // De-dupe by href, keep first occurrence, cap at 4 chips.
  const seen = new Set();
  return actions.filter((a) => (seen.has(a.href) ? false : (seen.add(a.href), true))).slice(0, 4);
}
