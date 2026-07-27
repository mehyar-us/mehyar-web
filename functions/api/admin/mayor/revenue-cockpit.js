// GET /api/admin/mayor/revenue-cockpit
//
// Revenue command layer for Mayor. It translates the raw CRM state into the
// next owner actions most likely to create cash: reply handling, reviewed
// sends, draft approvals, local-business fixes, and winnable contracts.

import { verifyAdminToken, json, corsHeaders } from "../../_shared/adminAuth.js";

const DEFAULT_TARGET = 100000;

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestGet({ request, env }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  const url = new URL(request.url);
  const target = clampNumber(url.searchParams.get("target"), 10000, 1000000, DEFAULT_TARGET);
  const limit = clampNumber(url.searchParams.get("limit"), 5, 50, 12);
  const db = env.LEADS_DB;

  const [
    quoteSummary,
    wonSummary,
    replyRows,
    dueRows,
    draftRows,
    prospectRows,
    samRows,
    sendHealth,
    replyHealth,
  ] = await Promise.all([
    first(db, `
      SELECT
        SUM(CASE WHEN status = 'paid' AND COALESCE(paid_at, updated_at, created_at) >= datetime('now','-30 day') THEN total_usd ELSE 0 END) AS paid_30d,
        SUM(CASE WHEN status IN ('quote','invoice') THEN total_usd ELSE 0 END) AS open_quote_value,
        COUNT(CASE WHEN status IN ('quote','invoice') THEN 1 END) AS open_quotes
      FROM quotes
    `),
    first(db, `
      SELECT
        SUM(CASE WHEN decision = 'won' AND decided_at >= datetime('now','-30 day') THEN COALESCE(value_usd, 0) ELSE 0 END) AS won_30d,
        COUNT(CASE WHEN decision = 'won' AND decided_at >= datetime('now','-30 day') THEN 1 END) AS wins_30d
      FROM opportunity_decisions
    `),
    all(db, `
      SELECT
        pr.id, pr.prospect_id, pr.classification, pr.received_at, pr.subject, pr.body_excerpt,
        p.business_name, p.root_domain, p.email, p.vertical, p.city
      FROM prospect_replies pr
      LEFT JOIN prospects p ON p.id = pr.prospect_id
      WHERE COALESCE(pr.needs_action, 1) = 1
      ORDER BY
        CASE WHEN pr.classification IN ('interest','warm') THEN 0
             WHEN pr.classification = 'objection' THEN 1
             ELSE 2 END,
        pr.received_at DESC
      LIMIT 10
    `),
    all(db, `
      SELECT
        s.id, s.prospect_id, s.step_no, s.subject, s.body_text, s.scheduled_for,
        p.business_name, p.root_domain, p.email, p.vertical, p.city
      FROM prospect_sequences s
      JOIN prospects p ON p.id = s.prospect_id
      WHERE s.status = 'queued'
        AND (s.scheduled_for IS NULL OR s.scheduled_for <= datetime('now'))
        AND p.email IS NOT NULL AND p.email != ''
        AND p.email NOT LIKE '%.example.com'
        AND p.email NOT LIKE '%.test'
        AND p.email NOT LIKE '%.invalid'
      ORDER BY s.scheduled_for ASC
      LIMIT 20
    `),
    all(db, `
      SELECT
        d.id, d.prospect_id, d.subject, d.created_at,
        p.business_name, p.root_domain, p.email, p.vertical, p.city,
        COALESCE(sig.leak_score, 0) AS leak_score
      FROM prospect_drafts d
      JOIN prospects p ON p.id = d.prospect_id
      LEFT JOIN prospect_signals sig ON sig.id = (
        SELECT id FROM prospect_signals WHERE prospect_id = p.id ORDER BY scanned_at DESC LIMIT 1
      )
      WHERE d.status IN ('draft','ready','pending_review')
        AND p.email IS NOT NULL AND p.email != ''
        AND p.email NOT LIKE '%.example.com'
      ORDER BY leak_score DESC, d.created_at DESC
      LIMIT 20
    `),
    all(db, `
      SELECT
        p.id, p.business_name, p.root_domain, p.email, p.vertical, p.city, p.status,
        p.last_contact_at, COALESCE(sig.leak_score, 0) AS leak_score,
        sig.leak_signals_json
      FROM prospects p
      LEFT JOIN prospect_signals sig ON sig.id = (
        SELECT id FROM prospect_signals WHERE prospect_id = p.id ORDER BY scanned_at DESC LIMIT 1
      )
      WHERE p.status NOT IN ('archived','won','lost','unsubscribed','rejected')
        AND p.email IS NOT NULL AND p.email != ''
        AND p.email NOT LIKE '%.example.com'
        AND p.root_domain NOT LIKE '%.example.com'
      ORDER BY leak_score DESC, p.updated_at DESC
      LIMIT 20
    `),
    all(db, `
      SELECT
        id, title, agency, set_aside, fit_score, estimated_value, response_deadline, stage, created_at
      FROM gov_opportunities
      WHERE COALESCE(stage, status, 'discovery') NOT IN ('won','lost','archived','no_bid','rejected')
        AND COALESCE(fit_score, 0) >= 55
        AND (response_deadline IS NULL OR date(response_deadline) >= date('now', '+7 days'))
      ORDER BY fit_score DESC, date(response_deadline) ASC
      LIMIT 20
    `),
    all(db, `
      SELECT
        date(COALESCE(attempted_at, created_at)) AS day,
        COUNT(*) AS sends,
        SUM(CASE WHEN status IN ('bounced','failed') THEN 1 ELSE 0 END) AS failed_or_bounced,
        SUM(CASE WHEN status = 'bounced' THEN 1 ELSE 0 END) AS bounced
      FROM prospect_sends
      WHERE COALESCE(attempted_at, created_at) >= datetime('now','-14 day')
      GROUP BY date(COALESCE(attempted_at, created_at))
      ORDER BY day DESC
      LIMIT 14
    `),
    all(db, `
      SELECT classification, COUNT(*) AS n
      FROM prospect_replies
      WHERE received_at >= datetime('now','-30 day')
      GROUP BY classification
    `),
  ]);

  const actions = [];
  for (const r of replyRows) actions.push(actionFromReply(r));
  for (const r of dueRows) actions.push(actionFromDueSequence(r));
  for (const r of draftRows) actions.push(actionFromDraft(r));
  for (const r of prospectRows) actions.push(actionFromProspect(r));
  for (const r of samRows) actions.push(actionFromSam(r));

  actions.sort((a, b) =>
    (b.priority_score - a.priority_score) ||
    (b.expected_value_usd - a.expected_value_usd)
  );

  const unique = [];
  const seen = new Set();
  for (const a of actions) {
    const key = `${a.kind}:${a.id}:${a.action_type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(a);
    if (unique.length >= limit) break;
  }

  const booked30 = Number(quoteSummary?.paid_30d || 0) + Number(wonSummary?.won_30d || 0);
  const openQuoteValue = Number(quoteSummary?.open_quote_value || 0);
  const weightedPipeline = unique.reduce((sum, a) => sum + a.expected_value_usd * a.close_probability, 0);
  const gap = Math.max(0, target - booked30);
  const recommendedDailyReviewed = Math.max(5, Math.min(25, Math.ceil(gap / 7500 / 20 * 5)));

  const summary = {
    target_monthly_usd: target,
    booked_30d_usd: Math.round(booked30),
    open_quote_value_usd: Math.round(openQuoteValue),
    weighted_next_actions_usd: Math.round(weightedPipeline),
    gap_to_target_usd: Math.round(gap),
    open_quotes: Number(quoteSummary?.open_quotes || 0),
    wins_30d: Number(wonSummary?.wins_30d || 0),
    recommended_daily_reviewed_emails: recommendedDailyReviewed,
    auto_send_posture: "review_required",
  };
  const deliverability = buildDeliverabilityPanel(sendHealth, replyHealth, dueRows.length);
  const draftReviewInbox = draftRows.map((r) => ({
    id: r.id,
    prospect_id: r.prospect_id,
    subject: r.subject,
    business_name: r.business_name,
    email: r.email,
    offer: offerForProspect(r),
    pricing: pricingForOffer(offerForProspect(r)),
    reason: Number(r.leak_score || 0) >= 60 ? `Leak score ${r.leak_score}: visible operational/website pain.` : "Draft exists and needs owner review before sending.",
    source: r.root_domain || r.email || "prospect",
    send_button_href: `/admin/money?focus=${encodeURIComponent(r.id)}`,
    risk: riskForVertical(r.vertical),
  }));
  const leadScores = [
    ...prospectRows.map(scoreProspectLead),
    ...samRows.map(scoreSamLead),
  ].sort((a, b) => b.revenue_score - a.revenue_score).slice(0, limit);
  const replyPlaybook = replyRows.map(playbookForReply);
  const bookingTasks = replyRows
    .filter((r) => ["interest", "warm"].includes(String(r.classification || "").toLowerCase()))
    .map((r) => ({
      reply_id: r.id,
      prospect_id: r.prospect_id,
      title: `Book 15-minute call with ${r.business_name || r.email || "warm lead"}`,
      meeting_cta: "Would tomorrow or the next morning be better for a quick 15-minute call?",
      href: "/admin/leads?kind=replies",
      due: "now",
      value_usd: 7500,
    }));
  const govBidNoBid = samRows.map(bidNoBidForSam);
  const moneyCleanup = buildMoneyCleanup(summary, actions, draftReviewInbox, deliverability);

  return json({
    ok: true,
    summary,
    top_actions: unique,
    draft_review_inbox: draftReviewInbox,
    lead_scores: leadScores,
    offer_selector: buildOfferSelector(),
    reply_playbook: replyPlaybook,
    gov_bid_no_bid: govBidNoBid,
    money_cleanup: moneyCleanup,
    deliverability,
    booking_tasks: bookingTasks,
    scorecard: buildScorecard(summary, unique),
    updatedAt: new Date().toISOString(),
  }, 200, request, env);
}

async function first(db, sql) {
  return db.prepare(sql).first().catch(() => ({}));
}

async function all(db, sql) {
  const r = await db.prepare(sql).all().catch(() => ({ results: [] }));
  return r.results || [];
}

function actionFromReply(r) {
  const warm = ["interest", "warm"].includes(String(r.classification || "").toLowerCase());
  return {
    id: r.id,
    kind: "reply",
    action_type: warm ? "book_call" : "reply_triage",
    title: warm ? `Reply now: ${r.business_name || r.from_email || "warm lead"}` : `Triage reply: ${r.business_name || r.subject || "prospect"}`,
    subtitle: r.body_excerpt || r.subject || "",
    why: warm ? "Warm replies are the shortest path to cash. Speed-to-lead matters more than more discovery." : "Unreviewed replies can block follow-ups or hide opt-outs.",
    next_step: warm ? "Send a short human reply and offer one 15-minute slot." : "Classify, handle, and either book, suppress, or follow up.",
    href: "/admin/leads?kind=replies",
    priority_score: warm ? 98 : 82,
    expected_value_usd: warm ? 7500 : 1500,
    close_probability: warm ? 0.35 : 0.08,
    risk: "low",
    channel: "email",
    business_name: r.business_name || "",
    meta: { classification: r.classification, received_at: r.received_at, prospect_id: r.prospect_id },
  };
}

function actionFromDueSequence(r) {
  return {
    id: r.id,
    kind: "outreach_due",
    action_type: "review_send",
    title: `Review due email: ${r.business_name || r.root_domain}`,
    subtitle: r.subject || "",
    why: "This email is due, but production is correctly in review-required mode.",
    next_step: "Open the draft/send queue, inspect the copy, then approve only if the offer and source are solid.",
    href: "/admin/sent?status=queued",
    priority_score: 70,
    expected_value_usd: 2500,
    close_probability: 0.04,
    risk: riskForVertical(r.vertical),
    channel: "email",
    business_name: r.business_name || "",
    meta: { prospect_id: r.prospect_id, step_no: r.step_no, scheduled_for: r.scheduled_for },
  };
}

function actionFromDraft(r) {
  const score = Number(r.leak_score || 0);
  return {
    id: r.id,
    kind: "draft",
    action_type: "approve_or_rewrite",
    title: `Review draft: ${r.business_name || r.root_domain}`,
    subtitle: r.subject || "",
    why: score >= 60 ? `High leak score (${score}) means the pain is visible.` : "Draft exists; owner review is the bottleneck.",
    next_step: "Check evidence, pricing angle, and opt-out footer. Approve, rewrite, or reject.",
    href: `/admin/money?focus=${encodeURIComponent(r.id)}`,
    priority_score: 66 + Math.min(20, Math.round(score / 5)),
    expected_value_usd: score >= 70 ? 7500 : 2500,
    close_probability: score >= 70 ? 0.08 : 0.04,
    risk: riskForVertical(r.vertical),
    channel: "email",
    business_name: r.business_name || "",
    meta: { prospect_id: r.prospect_id, leak_score: score },
  };
}

function actionFromProspect(r) {
  const score = Number(r.leak_score || 0);
  return {
    id: r.id,
    kind: "prospect",
    action_type: score >= 60 ? "generate_or_refresh_offer" : "qualify",
    title: `${score >= 60 ? "Build offer" : "Qualify"}: ${r.business_name || r.root_domain}`,
    subtitle: `${r.vertical || "local business"}${r.city ? ` in ${r.city}` : ""}`,
    why: score >= 60 ? `Leak score ${score}: credible reason to offer a diagnostic or quick fix.` : "Needs better evidence before outreach.",
    next_step: score >= 60 ? "Deep-analyze, generate a short offer, then review the first-touch email." : "Rescan website or enrich source before drafting.",
    href: `/admin/leads?kind=prospect&focus=${encodeURIComponent(r.id)}`,
    priority_score: 45 + Math.min(35, Math.round(score / 2)),
    expected_value_usd: score >= 70 ? 7500 : 2500,
    close_probability: score >= 70 ? 0.07 : 0.03,
    risk: riskForVertical(r.vertical),
    channel: "email",
    business_name: r.business_name || "",
    meta: { leak_score: score, status: r.status, last_contact_at: r.last_contact_at },
  };
}

function offerForProspect(r) {
  const vertical = String(r.vertical || "").toLowerCase();
  const score = Number(r.leak_score || 0);
  if (score >= 75) return "automation_sprint";
  if (/\b(cafe|bakery|restaurant|gym|salon|clinic|dental)\b/.test(vertical)) return "quick_fix";
  return "audit";
}

function pricingForOffer(offer) {
  const map = {
    audit: "$250 diagnostic or free 5-minute Loom first",
    quick_fix: "$1,500-$7,500 fixed-scope quick fix",
    automation_sprint: "$7,500-$25,000 automation/build sprint",
    retainer: "$500-$3,500/mo retainer",
    gov_capability: "$1,500 proposal assist or capability response",
  };
  return map[offer] || map.audit;
}

function scoreProspectLead(r) {
  const fit = Math.min(100, Math.max(20, Number(r.leak_score || 0)));
  const urgency = r.last_contact_at ? 40 : 75;
  const deliverability = r.email && !String(r.email).includes("example.com") ? 85 : 0;
  const value = Number(r.leak_score || 0) >= 70 ? 7500 : 2500;
  const winProbability = Math.round(((fit * 0.35 + urgency * 0.2 + deliverability * 0.25 + 60 * 0.2) / 100) * 12) / 100;
  return {
    id: r.id,
    kind: "prospect",
    title: r.business_name || r.root_domain,
    fit,
    urgency,
    value_usd: value,
    deliverability,
    win_probability: winProbability,
    revenue_score: Math.round((fit * 0.35) + (urgency * 0.2) + (deliverability * 0.2) + (value / 250)),
    next_action: Number(r.leak_score || 0) >= 60 ? "Generate/review offer email" : "Rescan/enrich before outreach",
    href: `/admin/leads?kind=prospect&focus=${encodeURIComponent(r.id)}`,
  };
}

function scoreSamLead(r) {
  const fit = Math.min(100, Math.max(0, Number(r.fit_score || 0)));
  const deadlineDays = daysUntil(r.response_deadline);
  const urgency = deadlineDays == null ? 45 : deadlineDays < 14 ? 85 : 65;
  const licenseLike = /\b(renewal|license|subscription|brand name|hardware|rotary table|calibrator)\b/i.test(String(r.title || ""));
  const value = Number(r.estimated_value || 0) || (licenseLike ? 1500 : 15000);
  const deliverability = licenseLike ? 35 : 70;
  const winProbability = licenseLike ? 0.02 : fit >= 75 ? 0.08 : 0.04;
  return {
    id: r.id,
    kind: "sam",
    title: r.title,
    fit,
    urgency,
    value_usd: value,
    deliverability,
    win_probability: winProbability,
    revenue_score: Math.round((fit * 0.45) + (urgency * 0.2) + (deliverability * 0.15) + Math.min(30, value / 1000)),
    next_action: licenseLike ? "Bid/no-bid gate: likely pass unless services angle exists" : "Verify requirements and draft capability response",
    href: `/admin/leads?kind=sam&focus=${encodeURIComponent(r.id)}`,
  };
}

function actionFromSam(r) {
  const fit = Number(r.fit_score || 0);
  const title = String(r.title || "");
  const licenseLike = /\b(renewal|license|subscription|brand name|maintenance)\b/i.test(title);
  const baseValue = Number(r.estimated_value || 0) || (licenseLike ? 1500 : 15000);
  return {
    id: r.id,
    kind: "sam",
    action_type: licenseLike ? "bid_no_bid" : "draft_capability_response",
    title: `${licenseLike ? "Bid/no-bid" : "Draft capability response"}: ${title}`,
    subtitle: `${r.agency || ""}${r.response_deadline ? ` · due ${r.response_deadline}` : ""}`.slice(0, 160),
    why: licenseLike ? "Looks like license/resale work; only pursue if there is a services angle." : `Fit score ${fit}; enough runway to prepare a serious response.`,
    next_step: licenseLike ? "Pass unless you can identify a software services path or teaming partner." : "Open the opportunity, verify requirements, evaluate attachments, then draft a capability email.",
    href: `/admin/leads?kind=sam&focus=${encodeURIComponent(r.id)}`,
    priority_score: licenseLike ? 42 : 58 + Math.min(32, Math.round(fit / 3)),
    expected_value_usd: baseValue,
    close_probability: licenseLike ? 0.02 : fit >= 75 ? 0.08 : 0.04,
    risk: "medium",
    channel: "contract",
    business_name: r.agency || "",
    meta: { fit_score: fit, deadline: r.response_deadline, stage: r.stage, license_like: licenseLike },
  };
}

function bidNoBidForSam(r) {
  const title = String(r.title || "");
  const deadlineDays = daysUntil(r.response_deadline);
  const licenseLike = /\b(renewal|license|subscription|brand name|maintenance)\b/i.test(title);
  const hardwareLike = /\b(hardware|rotary table|calibrator|parts|equipment)\b/i.test(title);
  const expiredOrTight = deadlineDays != null && deadlineDays < 7;
  const fit = Number(r.fit_score || 0);
  const flags = [];
  if (licenseLike) flags.push("license_or_renewal");
  if (hardwareLike) flags.push("hardware_or_equipment");
  if (expiredOrTight) flags.push("deadline_under_7_days");
  if (fit < 60) flags.push("fit_below_60");
  const decision = flags.length ? "no_bid_or_team_only" : "bid";
  return {
    id: r.id,
    title,
    agency: r.agency,
    decision,
    flags,
    fit_score: fit,
    deadline_days: deadlineDays,
    next_step: decision === "bid"
      ? "Evaluate attachments, confirm eligibility, draft capability response."
      : "Pass unless a clear services lane or teaming partner exists.",
    href: `/admin/leads?kind=sam&focus=${encodeURIComponent(r.id)}`,
  };
}

function playbookForReply(r) {
  const cls = String(r.classification || "unclassified").toLowerCase();
  const warm = ["interest", "warm"].includes(cls);
  const objection = cls === "objection";
  const unsubscribe = cls === "unsubscribe" || cls === "stop";
  return {
    reply_id: r.id,
    prospect_id: r.prospect_id,
    classification: cls,
    business_name: r.business_name,
    recommended_action: warm ? "book_meeting" : objection ? "handle_objection" : unsubscribe ? "suppress_and_mark_handled" : "classify_manually",
    next_reply: warm
      ? `Thanks for replying. I can send a quick audit, or we can do 15 minutes and I’ll show you the first fix I’d make. Would tomorrow or the next morning work?`
      : objection
      ? `Totally fair. The useful version is small: I can send a 5-minute audit first, then you decide if any fix is worth pricing.`
      : unsubscribe
      ? `Understood. I won’t contact you again.`
      : `Thanks for the reply. What would be most useful: a quick audit, pricing for a fix, or should I close the loop?`,
    meeting_cta: warm ? "Offer one specific 15-minute slot and one fallback." : "",
    mark_won_lost_href: r.prospect_id ? `/admin/leads?kind=prospect&focus=${encodeURIComponent(r.prospect_id)}` : "/admin/leads?kind=replies",
    href: "/admin/leads?kind=replies",
  };
}

function buildOfferSelector() {
  return [
    { id: "audit", label: "Audit", price: "$250", best_for: "cold lead with weak evidence", cta: "Want me to send a 5-minute audit?" },
    { id: "quick_fix", label: "Quick fix", price: "$1.5k-$7.5k", best_for: "visible website/intake leak", cta: "I can price the first fix as a fixed-scope sprint." },
    { id: "automation_sprint", label: "Automation sprint", price: "$7.5k-$25k", best_for: "manual CRM, intake, ops, AI workflow", cta: "I can map and ship the first automation sprint." },
    { id: "retainer", label: "Retainer", price: "$500-$3.5k/mo", best_for: "ongoing founder/operator support", cta: "I can keep improving the system monthly." },
    { id: "gov_capability", label: "Gov capability response", price: "$1.5k+", best_for: "SAM/RFI/RFQ with services lane", cta: "I can send a concise capability response." },
  ];
}

function buildDeliverabilityPanel(sendRows, replyRows, dueCount) {
  const sends14 = sendRows.reduce((s, r) => s + Number(r.sends || 0), 0);
  const failed14 = sendRows.reduce((s, r) => s + Number(r.failed_or_bounced || 0), 0);
  const bounced14 = sendRows.reduce((s, r) => s + Number(r.bounced || 0), 0);
  const replies = Object.fromEntries(replyRows.map((r) => [r.classification || "unclassified", Number(r.n || 0)]));
  const optOuts = Number(replies.unsubscribe || 0) + Number(replies.stop || 0);
  const bounceRate = sends14 ? Math.round((bounced14 / sends14) * 1000) / 10 : 0;
  const failureRate = sends14 ? Math.round((failed14 / sends14) * 1000) / 10 : 0;
  return {
    posture: "review_required",
    sends_14d: sends14,
    due_for_review: dueCount,
    bounced_14d: bounced14,
    failed_or_bounced_14d: failed14,
    bounce_rate_pct: bounceRate,
    failure_rate_pct: failureRate,
    opt_outs_30d: optOuts,
    domain_health: bounceRate >= 5 || optOuts >= 3 ? "watch" : "ok",
    recommendation: bounceRate >= 5
      ? "Pause scaled sending and validate emails before any approvals."
      : "Keep auto-send off; review 5-15 high-quality emails/day.",
    daily_safe_send_range: sends14 > 0 && bounceRate < 3 ? "10-25 reviewed emails/day" : "5-10 reviewed emails/day",
    by_day: sendRows,
    replies_30d: replies,
  };
}

function buildMoneyCleanup(summary, actions, drafts, deliverability) {
  const staleActions = actions.filter((a) => a.priority_score < 55).length;
  return {
    expected_value_method: "expected_value_usd * close_probability from ranked next actions",
    real_expected_value_usd: summary.weighted_next_actions_usd,
    deal_value_source: "quotes.total_usd + opportunity_decisions.value_usd + estimated contract/prospect values",
    next_action_count: actions.length,
    stale_pipeline_count: staleActions,
    draft_review_count: drafts.length,
    deliverability_state: deliverability.domain_health,
    cleanup_actions: [
      "Mark expired/tight license-renewal SAM opportunities no-bid.",
      "Convert warm replies into booking tasks before scanning more leads.",
      "Review or reject old drafts so the queue reflects real money.",
      "Create quotes for warm prospects so pipeline value stops being placeholder math.",
    ],
  };
}

function riskForVertical(vertical) {
  const v = String(vertical || "").toLowerCase();
  if (/\b(dental|doctor|clinic|medspa|medical|health|law|legal|finance|insurance)\b/.test(v)) return "manual_high";
  return "low";
}

function daysUntil(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.ceil((t - Date.now()) / 86400000);
}

function buildScorecard(summary, actions) {
  const warmReplies = actions.filter((a) => a.kind === "reply" && a.action_type === "book_call").length;
  const reviewSends = actions.filter((a) => a.action_type === "review_send").length;
  const govActions = actions.filter((a) => a.kind === "sam").length;
  const localActions = actions.filter((a) => ["prospect", "draft", "outreach_due"].includes(a.kind)).length;
  return [
    { label: "Warm replies", value: warmReplies, state: warmReplies > 0 ? "urgent" : "ok" },
    { label: "Emails to review", value: reviewSends, state: reviewSends > 0 ? "work" : "ok" },
    { label: "Gov contract actions", value: govActions, state: govActions > 0 ? "work" : "ok" },
    { label: "Local biz actions", value: localActions, state: localActions > 0 ? "work" : "ok" },
    { label: "Daily reviewed sends", value: summary.recommended_daily_reviewed_emails, state: "target" },
  ];
}

function clampNumber(value, lo, hi, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}
