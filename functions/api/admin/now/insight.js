// /api/admin/now/insight
//
// GET /api/admin/now/insight
//
// AI-generated "what should I do first today" digest based on the current
// state of the pipeline. Uses LLM with fallback heuristic.
//
// Response: { ok, text: string, actions: [{ label, href }], used_llm }

import { verifyAdminToken, json, corsHeaders } from "../../_shared/adminAuth.js";
import { chatJson } from "../../_shared/llmChat.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestGet({ request, env }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  // Pull the current state
  const sam = await env.LEADS_DB.prepare(`
    SELECT id, title, agency, fit_score, response_deadline,
           CAST(julianday(response_deadline) - julianday('now') AS INTEGER) AS d,
           stage, ai_suggestion
    FROM gov_opportunities
    WHERE status='active' AND stage NOT IN ('won','lost','archived')
    ORDER BY (CASE WHEN fit_score IS NULL THEN 0 ELSE fit_score END) DESC,
             (CASE WHEN response_deadline IS NULL THEN 9999 ELSE julianday(response_deadline) - julianday('now') END) ASC
    LIMIT 6
  `).all().catch(() => ({ results: [] }));

  const prospects = await env.LEADS_DB.prepare(`
    SELECT id, business_name, root_domain, leak_score, stage, last_touched_at
    FROM prospects
    WHERE status NOT IN ('archived','won','lost','unsubscribed','bounced')
    ORDER BY (CASE WHEN leak_score IS NULL THEN 0 ELSE leak_score END) DESC
    LIMIT 6
  `).all().catch(() => ({ results: [] }));

  const counts = await env.LEADS_DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM gov_opportunities WHERE status='active') as sam_active,
      (SELECT COUNT(*) FROM gov_opportunities WHERE status='active' AND julianday(response_deadline) - julianday('now') <= 7) as sam_due_7d,
      (SELECT COUNT(*) FROM gov_opportunities WHERE stage='drafting' OR stage='evaluating') as sam_in_progress,
      (SELECT COUNT(*) FROM prospects WHERE status NOT IN ('archived','won','lost','unsubscribed')) as pros_total,
      (SELECT COUNT(*) FROM prospects WHERE status NOT IN ('archived','won','lost','unsubscribed') AND leak_score >= 60) as pros_hot,
      (SELECT COUNT(*) FROM prospect_drafts WHERE status='pending_review') as drafts_pending,
      (SELECT COUNT(*) FROM prospect_sends WHERE status='queued_for_review') as sends_queued,
      (SELECT COUNT(*) FROM opportunity_events WHERE event_type='reply_received' AND created_at >= datetime('now','-7 days')) as replies_7d,
      (SELECT COALESCE(SUM(value_usd),0) FROM opportunity_decisions WHERE decision='won' AND decided_at >= datetime('now','-30 days')) as won_30d
  `).first().catch(() => ({}));

  const c = counts || {};
  const samList = sam.results || [];
  const proList = prospects.results || [];

  // Quick heuristic fallback
  let text = "";
  const actions = [];
  const dueSoon = samList.filter((s) => Number(s.d) <= 7 && Number.isFinite(s.d));
  const draftsPending = Number(c.drafts_pending || 0);
  const hotPros = proList.filter((p) => Number(p.leak_score || 0) >= 60);
  const replies7d = Number(c.replies_7d || 0);

  const lines = [];
  if (dueSoon.length > 0) {
    lines.push(`🔥 ${dueSoon.length} SAM.gov opportunity${dueSoon.length === 1 ? "" : "s"} due within a week. The most urgent is "${dueSoon[0].title}" (D-${dueSoon[0].d}).`);
    actions.push({ label: `Open ${dueSoon[0].agency || dueSoon[0].title?.slice(0, 30)}`, href: `/admin/leads?focus=${dueSoon[0].id}` });
  } else {
    lines.push("🟢 No SAM deadlines this week. Good time to prospect-scan or post a case study.");
    actions.push({ label: "Fetch new contracts", href: "/admin/system" });
  }
  if (draftsPending > 0) {
    lines.push(`📝 ${draftsPending} draft${draftsPending === 1 ? "" : "s"} waiting for your review in the outreach queue.`);
    actions.push({ label: "Review drafts", href: "/admin/outreach" });
  } else if (dueSoon.length === 0) {
    lines.push("📋 Inbox zero on drafts. Use the time to deep-evaluate a prospect.");
    actions.push({ label: "Open CRM", href: "/admin/leads" });
  }
  if (hotPros.length > 0 && draftsPending === 0) {
    lines.push(`🧲 ${hotPros.length} hot prospect${hotPros.length === 1 ? "" : "s"} with leak ≥ 60 (no reply yet).`);
    actions.push({ label: `Pick a prospect: ${hotPros[0].business_name?.slice(0, 24) || "top"}`, href: `/admin/leads?focus=${hotPros[0].id}` });
  }
  if (replies7d > 0) {
    lines.push(`📬 ${replies7d} repl${replies7d === 1 ? "y" : "ies"} in the last 7 days — reply within 4h to maximize close rate.`);
    actions.push({ label: "Open replies", href: "/admin/outreach" });
  } else if (c.sends_queued > 0) {
    lines.push(`📤 ${c.sends_queued} send${c.sends_queued === 1 ? "" : "s"} queued. Approve to ship.`);
    actions.push({ label: "Approve sends", href: "/admin/outreach" });
  }
  const won30 = Number(c.won_30d || 0);
  if (won30 > 0) lines.push(`💰 $${won30.toLocaleString()} won in the last 30 days. Nice. Marking one as Won auto-drafts a case study for SEO.`);
  if (lines.length === 0) lines.push("✅ Nothing critical. Take a breath, or deep-evaluate the top CRM lead.");

  text = lines.join("\n\n");

  // Try LLM for a punchier rewrite
  let used_llm = false;
  try {
    const llm = await chatJson({
      env,
      messages: [
        {
          role: "system",
          content: `You are Mehyar's sales/BD copilot for MehyarSoft (a one-person software/cloud/AI consultancy). 
Rewrite the user's bullet digest into a 4-7 line punchy, human, peer-to-peer "what should I do today" message.
Constraints:
- ≤ 80 words total
- Address Mehyar directly ("you", not "the user")
- Lead with the single most urgent item
- End with one concrete next action
- No emojis outside the lead bullet
- No marketing fluff — this is for the founder, plain English`,
        },
        {
          role: "user",
          content: text,
        },
      ],
      max_tokens: 250,
      temperature: 0.5,
      json_mode: false,
    });
    if (llm.used_llm && llm.content) {
      text = llm.content.slice(0, 1200);
      used_llm = true;
    }
  } catch {}

  return json({ ok: true, text, actions, used_llm }, 200, request, env);
}
