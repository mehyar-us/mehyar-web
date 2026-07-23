// GET /api/admin/mayor/pipeline-audit
//
// One-call funnel audit + actionable suggestions. Returns:
//
//   {
//     funnel: {
//       discovered, drafts, sent, replied, interested, won,
//       step_conversion: [{stage, count, conversion_from_prev}, …],
//     },
//     drops:               string[]   // text descriptions of where the pipeline loses people
//     stage_breakdown:     { sam: …, prospect: … }
//     provider_breakdown:  { manual_approval: n, resend: n }
//     reply_breakdown:     { interest: n, warm: n, unsubscribe: n, … }
//     bottleneck_stage:    string
//     suggestions: [
//       { priority, title, why, how, action_href?, expected_lift },
//       …
//     ],
//     summary: string (deterministic headline for the dashboard)
//   }
//
// "suggestions" is computed deterministically by translating observed
// drop-offs + ratios into concrete, prescribed fixes. Each suggestion
// links to the part of the app that owns the fix so the founder can
// act in one click.
//
// Auth: admin bearer token.

import { verifyAdminToken, json, corsHeaders } from "../../_shared/adminAuth.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

// Bounded integer parser
function i(s, lo, hi, fb) {
  const n = parseInt(s, 10);
  if (!Number.isFinite(n)) return fb;
  return Math.max(lo, Math.min(hi, n));
}

export async function onRequestGet({ request, env }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  const url = new URL(request.url);
  const days = i(url.searchParams.get("days"), 1, 365, 30);

  const since = `datetime('now', '-${days} days')`;
  const db = env.LEADS_DB;

  // ── Aggregate funnel counters ────────────────────────────────────
  const [
    discoveredProspect, discoveredSAM,
    draftsPending, draftsReady,
    queuedForSend, sentTotal, sentFinished,
    repliesTotal, repliesInterest, repliesWarm, repliesUnsub,
    wonTotal,
    bounceRateRow,
    activeProspectsWithLeak, prospectsContacted,
  ] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS n FROM prospects WHERE created_at >= ${since}`).first().catch(() => ({ n: 0 })),
    db.prepare(`SELECT COUNT(*) AS n FROM gov_opportunities WHERE created_at >= ${since}`).first().catch(() => ({ n: 0 })),
    db.prepare(`SELECT COUNT(*) AS n FROM prospect_drafts WHERE status = 'draft'`).first().catch(() => ({ n: 0 })),
    db.prepare(`SELECT COUNT(*) AS n FROM prospect_drafts WHERE status = 'ready'`).first().catch(() => ({ n: 0 })),
    db.prepare(`SELECT COUNT(*) AS n FROM prospect_sends WHERE status = 'queued_for_review' OR status = 'queued'`).first().catch(() => ({ n: 0 })),
    db.prepare(`SELECT COUNT(*) AS n FROM prospect_sends WHERE created_at >= ${since}`).first().catch(() => ({ n: 0 })),
    db.prepare(`SELECT COUNT(*) AS n FROM prospect_sends WHERE finished_at IS NOT NULL`).first().catch(() => ({ n: 0 })),
    db.prepare(`SELECT COUNT(*) AS n FROM prospect_replies WHERE received_at >= ${since}`).first().catch(() => ({ n: 0 })),
    db.prepare(`SELECT COUNT(*) AS n FROM prospect_replies WHERE received_at >= ${since} AND classification IN ('interest','warm')`).first().catch(() => ({ n: 0 })),
    db.prepare(`SELECT COUNT(*) AS n FROM prospect_replies WHERE received_at >= ${since} AND classification = 'warm'`).first().catch(() => ({ n: 0 })),
    db.prepare(`SELECT COUNT(*) AS n FROM prospect_replies WHERE received_at >= ${since} AND classification = 'unsubscribe'`).first().catch(() => ({ n: 0 })),
    db.prepare(`SELECT COUNT(*) AS n FROM prospects WHERE stage = 'won' AND updated_at >= ${since}`).first().catch(() => ({ n: 0 })),
    db.prepare(`SELECT
                  CAST(SUM(CASE WHEN status = 'bounced' THEN 1 ELSE 0 END) AS REAL) / NULLIF(SUM(CASE WHEN finished_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS r
                FROM prospect_sends WHERE created_at >= ${since}`).first().catch(() => ({ r: 0 })),
    db.prepare(`SELECT COUNT(*) AS n FROM prospects WHERE leak_score >= 70 AND stage NOT IN ('archived','won','lost')`).first().catch(() => ({ n: 0 })),
    db.prepare(`SELECT COUNT(*) AS n FROM prospects WHERE last_contact_at >= ${since}`).first().catch(() => ({ n: 0 })),
  ]);

  const discovered = (discoveredProspect?.n || 0) + (discoveredSAM?.n || 0);
  const sent = sentTotal?.n || 0;
  const replied = repliesTotal?.n || 0;
  const interested = repliesInterest?.n || 0;
  const won = wonTotal?.n || 0;
  const bounceRate = Number(bounceRateRow?.r || 0);
  const funnel = {
    discovered,
    drafts_pending: draftsPending?.n || 0,
    drafts_ready: draftsReady?.n || 0,
    queued_for_send: queuedForSend?.n || 0,
    sent,
    sent_finished: sentFinished?.n || 0,
    replied,
    interested,
    warm: repliesWarm?.n || 0,
    unsubscribe: repliesUnsub?.n || 0,
    won,
    prospects_with_leak: activeProspectsWithLeak?.n || 0,
    prospects_contacted: prospectsContacted?.n || 0,
    reply_rate: sent ? Math.round((replied / sent) * 1000) / 10 : 0,  // %
    interest_rate: sent ? Math.round((interested / sent) * 1000) / 10 : 0,
    win_rate: contacted => contacted > 0 ? Math.round((won / contacted) * 1000) / 10 : 0,
    bounce_rate: Math.round(bounceRate * 1000) / 10,
  };

  // ── Step conversion (discovered → drafts → sent → replied → won) ──
  const stepConversion = [
    { stage: "discovered", count: discovered, conversion_from_prev: null },
    { stage: "drafted",    count: (draftsPending?.n || 0) + (draftsReady?.n || 0), conversion_from_prev: discovered ? Math.round(((draftsPending?.n || 0) + (draftsReady?.n || 0)) / discovered * 100) : null },
    { stage: "sent",       count: sent, conversion_from_prev: discovered ? Math.round((sent / discovered) * 100) : null },
    { stage: "replied",    count: replied, conversion_from_prev: sent ? Math.round((replied / sent) * 100) : null },
    { stage: "interested", count: interested, conversion_from_prev: sent ? Math.round((interested / sent) * 100) : null },
    { stage: "won",        count: won, conversion_from_prev: interested ? Math.round((won / interested) * 100) : null },
  ];

  // ── Bottleneck ──────────────────────────────────────────────────
  let bottleneck = "none";
  let bottleneckPct = 0;
  for (let i = 1; i < stepConversion.length; i++) {
    const p = stepConversion[i - 1].count || 0;
    const c = stepConversion[i].count || 0;
    if (p > 5 && c < p * 0.25) {
      bottleneck = stepConversion[i].stage;
      bottleneckPct = Math.round((c / p) * 100);
      break;
    }
  }

  // ── Drop narrative ─────────────────────────────────────────────
  const drops = [];
  if (discovered > 5 && funnel.drafts_pending + funnel.drafts_ready < discovered * 0.2) {
    drops.push(`Only ${Math.round(((funnel.drafts_pending + funnel.drafts_ready) / discovered) * 100)}% of discovered prospects have a draft. Auto-draft is under-using the source data.`);
  }
  if (funnel.drafts_ready > 5 && funnel.queued_for_send < funnel.drafts_ready * 0.3) {
    drops.push(`${funnel.drafts_ready} drafts are ready, ${funnel.queued_for_send} are queued to send. The 'ready' queue isn't draining.`);
  }
  if (sent > 10 && funnel.reply_rate < 5) {
    drops.push(`Reply rate is ${funnel.reply_rate}% (industry baseline ~5–8%). Subject lines or list quality need attention.`);
  }
  if (funnel.reply_rate > 15) {
    drops.push(`Reply rate is ${funnel.reply_rate}% — unusually high. Quality is good; opportunities for scaled outreach are wide open.`);
  }
  if (funnel.bounce_rate > 5) {
    drops.push(`Bounce rate is ${funnel.bounce_rate}% (target <3%). Email validation should run before send.`);
  }
  if (funnel.prospects_with_leak > 20) {
    drops.push(`${funnel.prospects_with_leak} prospects have leak_score ≥ 70 and are not in archive/won/lost. Run 'promote' from CRM to act on them.`);
  }
  if (replied > 0 && funnel.unsubscribe / replied > 0.1) {
    drops.push(`Unsubscribes are ${Math.round((funnel.unsubscribe / replied) * 100)}% of replies. Volume might be too aggressive for new segments.`);
  }

  // ── Deterministic suggestions ──────────────────────────────────
  const suggestions = [];

  if (funnel.drafts_pending > 10) {
    suggestions.push({
      priority: "high",
      title: `Review ${funnel.drafts_pending} pending drafts in 1 click`,
      why: `${funnel.drafts_pending} drafts waiting in your queue. Each one is a personalised email ready to fire — reviewing them is highest-leverage work right now.`,
      how: "Open /admin/leads?stage=draft_needed, click any row, hit Send. Each one takes ~15 seconds.",
      action_href: "/admin/leads?kind=all&stage=draft_needed",
      action_label: `Review ${funnel.drafts_pending} drafts →`,
      expected_lift: "100% of those drafts can go out today — direct revenue multiplier.",
    });
  }
  if (funnel.reply_rate < 5 && sent > 10) {
    suggestions.push({
      priority: "high",
      title: "Improve subject-line CTR — current reply rate is below baseline",
      why: `Reply rate of ${funnel.reply_rate}% on ${sent} sends. Industry baseline for B2B services is 5–8%. Subject lines should look like a real human wrote them in 30 seconds.`,
      how: "Update outreach_steps.subject_template per source. Cut the corporate tone. Reference the recipient's vertical or city in line 1.",
      action_href: "/admin/leads?kind=prospect",
      action_label: "Adjust templates →",
      expected_lift: "1.5–2× reply rate should be reachable in one tuning cycle.",
    });
  }
  if (funnel.bounce_rate > 5) {
    suggestions.push({
      priority: "high",
      title: "Validate emails before send to cut bounce rate",
      why: `Bounce rate is ${funnel.bounce_rate}%, target is <3%. High bounces tank domain reputation.`,
      how: "Run prospects through a verification step before they reach the queue. Add an 'email_verified' gate in outreach_steps or use the prospect_sources dedup_days.",
      action_href: "/admin/leads?kind=all",
      action_label: "Inspect list hygiene →",
      expected_lift: "Sender domain protected; reply-rate denominator shrinks by 5–10%.",
    });
  }
  if (funnel.prospects_with_leak > 20) {
    suggestions.push({
      priority: "medium",
      title: `${funnel.prospects_with_leak} high-leak prospects are sitting untouched`,
      why: "These businesses have detectable site leaks (no SSL, no booking CTA, etc.) and the highest close-rate ceiling. They've been waiting for outreach.",
      how: "Open CRM, filter leak_score ≥ 70, batch-promote to queued, fire Mayor's outreach window.",
      action_href: "/admin/leads?kind=prospect&sort=leak_desc",
      action_label: `Work ${funnel.prospects_with_leak} leak-rich leads →`,
      expected_lift: "Each leak-rich close lands 1.3× baseline; their pain is louder.",
    });
  }
  if (discovered > 0 && (funnel.drafts_pending + funnel.drafts_ready) < discovered * 0.1) {
    suggestions.push({
      priority: "medium",
      title: "Auto-draft is converting only a small slice of discoveries",
      why: `Of ${discovered} new prospects in ${days} days, fewer than 10% have a draft. The discovery→draft bridge is the first leak.`,
      how: "Trigger the 'discover+outreach' job from /admin/mayor. It chains discovery → draft generation in one pass.",
      action_href: "/admin/mayor",
      action_label: "Open Mayor →",
      expected_lift: "Doubles the top-of-funnel throughput in one click.",
    });
  }
  if (funnel.reply_rate >= 15) {
    suggestions.push({
      priority: "high",
      title: "Reply rate is excellent — push volume hard",
      why: `${funnel.reply_rate}% reply rate is top-quartile. The constraint now is sending more, not converting more.`,
      how: "Open CRM → All tab → bulk-promote ready drafts. Bump daily_email_cap in /admin/mayor once reply behaviour holds up for a week.",
      action_href: "/admin/mayor",
      action_label: "Scale up →",
      expected_lift: "Reply-rate × sends = revenue; doubling sends should ~double replies this week.",
    });
  }
  if (funnel.replied > 5 && interested > 0 && (won / Math.max(1, interested)) < 0.1) {
    suggestions.push({
      priority: "medium",
      title: "Close-rate on interested replies is below 10%",
      why: `You have ${interested} interested replies but only ${won} wins this window. The follow-up flow needs tightening.`,
      how: "Open the Replies tab daily, sort by 'interested', and reply within 12 hours with a one-line personalised ack + 1 link to a 15-min slot.",
      action_href: "/admin/leads?kind=replies",
      action_label: "Triage replies →",
      expected_lift: "Speed-to-lead is the #1 predictor of close for warm replies.",
    });
  }

  if (suggestions.length === 0) {
    suggestions.push({
      priority: "info",
      title: "Pipeline is healthy — no critical actions right now",
      why: `Reply rate ${funnel.reply_rate}%, bounce ${funnel.bounce_rate}%, drafts: ${funnel.drafts_pending}. Within target bands.`,
      how: "Keep Mayor running. Glance at the Sent tab once a day to confirm expectation matches reality.",
      action_href: "/admin/sent",
      action_label: "Review sent inbox →",
      expected_lift: "Maintenance, not intervention.",
    });
  }

  // Sort by priority
  const priorityOrder = { high: 0, medium: 1, info: 2 };
  suggestions.sort((a, b) => (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9));

  // Stage breakdown
  const stageBreakdown = {
    sam: { active: discoveredSAM?.n || 0 },
    prospect: {
      active: discoveredProspect?.n || 0,
      high_leak: funnel.prospects_with_leak,
      contacted_this_window: funnel.prospects_contacted,
    },
  };

  const providerRows = await db.prepare(`
    SELECT provider, COUNT(*) AS n
    FROM prospect_sends
    WHERE created_at >= ${since}
    GROUP BY provider
  `).all().catch(() => ({ results: [] }));
  const providerBreakdown = {};
  for (const r of providerRows.results || []) providerBreakdown[r.provider] = r.n;

  const replyRows = await db.prepare(`
    SELECT classification, COUNT(*) AS n
    FROM prospect_replies
    WHERE received_at >= ${since}
    GROUP BY classification
  `).all().catch(() => ({ results: [] }));
  const replyBreakdown = {};
  for (const r of replyRows.results || []) replyBreakdown[r.classification || "unclassified"] = r.n;

  const summary =
    `In the last ${days} days: ${discovered} new prospects, ${sent} sent, ${replied} replies (${funnel.reply_rate}%), ${interested} interested, ${won} wins. ` +
    (bottleneck !== "none"
      ? `Biggest leak: ${bottleneck} — only ${bottleneckPct}% conversion from previous stage.`
      : `No major bottleneck — funnel is steady.`);

  return json({
    ok: true,
    days,
    funnel,
    step_conversion: stepConversion,
    bottleneck: { stage: bottleneck, conversion_pct: bottleneckPct },
    drops,
    stage_breakdown: stageBreakdown,
    provider_breakdown: providerBreakdown,
    reply_breakdown: replyBreakdown,
    suggestions,
    summary,
    updated_at: new Date().toISOString(),
  }, 200, request, env);
}
