// POST /api/admin/mayor/replies/:id/outcome
//
// Converts an actionable reply into a durable prospect outcome. This is the
// cockpit shortcut for "mark won/lost/on hold" from the Reply Playbook.

import { verifyAdminToken, json, corsHeaders } from "../../../../_shared/adminAuth.js";

const OUTCOMES = new Set(["won", "lost", "on_hold"]);

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestPost({ request, env, params }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  const replyId = String(params?.id || "").slice(0, 96);
  if (!replyId) return json({ ok: false, error: "missing_reply_id" }, 400, request, env);

  let body = {};
  try { body = await request.json(); } catch {}
  const outcome = String(body?.outcome || "").toLowerCase();
  if (!OUTCOMES.has(outcome)) {
    return json({ ok: false, error: "bad_outcome", accepted: [...OUTCOMES] }, 400, request, env);
  }

  const valueUsd = outcome === "won" ? clampMoney(body?.value_usd, 7500) : 0;
  const reasonCode = String(body?.reason_code || `reply_playbook_${outcome}`).slice(0, 64);
  const reasonBody = String(body?.reason_body || "").trim().slice(0, 3000) ||
    defaultReason(outcome, valueUsd);

  const db = env.LEADS_DB;
  await ensureDecisionSchema(db);

  const reply = await db.prepare(`
    SELECT
      pr.id, pr.prospect_id, pr.classification, pr.received_at, pr.subject, pr.body_excerpt,
      p.business_name, p.root_domain, p.email, p.status AS prospect_status
    FROM prospect_replies pr
    LEFT JOIN prospects p ON p.id = pr.prospect_id
    WHERE pr.id = ?
    LIMIT 1
  `).bind(replyId).first().catch(() => null);
  if (!reply) return json({ ok: false, error: "reply_not_found" }, 404, request, env);
  if (!reply.prospect_id) return json({ ok: false, error: "reply_missing_prospect" }, 409, request, env);

  const decisionId = crypto.randomUUID();
  const newStatus = outcome === "on_hold" ? "replied" : outcome;
  const payload = JSON.stringify({
    decision_id: decisionId,
    reply_id: replyId,
    outcome,
    value_usd: valueUsd,
    reason_code: reasonCode,
    reason_body: reasonBody,
    classification: reply.classification,
    reply_subject: reply.subject,
    reply_excerpt: reply.body_excerpt,
    from_stage: reply.prospect_status || "",
    to_stage: newStatus,
  }).slice(0, 6000);

  try {
    await db.prepare(`
      INSERT INTO opportunity_decisions (
        id, opportunity_id, kind, decision, outcome,
        value_usd, reason_code, reason_body,
        decided_by, decided_at, created_at
      )
      VALUES (?, ?, 'prospect', ?, ?, ?, ?, ?, 'owner', datetime('now'), datetime('now'))
    `).bind(decisionId, reply.prospect_id, outcome, outcome, valueUsd, reasonCode, reasonBody).run();

    await db.prepare(`
      UPDATE prospects
      SET status = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(newStatus, reply.prospect_id).run();

    await db.prepare(`
      UPDATE prospect_replies
      SET needs_action = 0,
          handled_at = COALESCE(handled_at, datetime('now')),
          created_action = ?
      WHERE id = ?
    `).bind(`marked_${outcome}`, replyId).run().catch(async () => {
      await db.prepare(`
        UPDATE prospect_replies
        SET needs_action = 0, handled_at = COALESCE(handled_at, datetime('now'))
        WHERE id = ?
      `).bind(replyId).run().catch(() => null);
    });

    await db.prepare(`
      INSERT INTO opportunity_events (
        id, kind, prospect_id, event_type, actor, from_stage, to_stage, payload_json, created_at
      )
      VALUES (?, 'prospect', ?, 'decision', 'owner', ?, ?, ?, datetime('now'))
    `).bind(
      crypto.randomUUID(),
      reply.prospect_id,
      reply.prospect_status || "",
      newStatus,
      payload
    ).run().catch(() => null);

    await db.prepare(`
      INSERT INTO opportunity_notes (id, kind, prospect_id, body, author, created_at, updated_at)
      VALUES (?, 'prospect', ?, ?, 'owner', datetime('now'), datetime('now'))
    `).bind(
      crypto.randomUUID(),
      reply.prospect_id,
      `${labelForOutcome(outcome)} from reply playbook. ${reasonBody}`
    ).run().catch(() => null);

    await db.prepare(`
      INSERT INTO mayor_events (id, kind, loop, summary, details_json, created_at)
      VALUES (?, 'reply', 'outcome', ?, ?, datetime('now'))
    `).bind(
      crypto.randomUUID(),
      `${labelForOutcome(outcome)}: ${reply.business_name || reply.email || reply.prospect_id}`,
      payload
    ).run().catch(() => null);

    return json({
      ok: true,
      reply_id: replyId,
      prospect_id: reply.prospect_id,
      decision_id: decisionId,
      outcome,
      value_usd: valueUsd,
      new_status: newStatus,
      previous_status: reply.prospect_status || "",
    }, 200, request, env);
  } catch (e) {
    return json({ ok: false, error: "reply_outcome_failed", details: String(e?.message || e) }, 500, request, env);
  }
}

async function ensureDecisionSchema(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS opportunity_decisions (
      id TEXT PRIMARY KEY,
      opportunity_id TEXT,
      kind TEXT NOT NULL DEFAULT 'sam',
      decision TEXT NOT NULL,
      outcome TEXT,
      value_usd REAL DEFAULT 0,
      reason_code TEXT,
      reason_body TEXT,
      decided_by TEXT NOT NULL DEFAULT 'owner',
      decided_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();
  await db.prepare(`ALTER TABLE opportunity_decisions ADD COLUMN outcome TEXT`).run().catch(() => null);
  await db.prepare(`ALTER TABLE opportunity_decisions ADD COLUMN value_usd REAL NOT NULL DEFAULT 0`).run().catch(() => null);
}

function clampMoney(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(100, Math.min(250000, Math.round(n)));
}

function labelForOutcome(outcome) {
  if (outcome === "won") return "Marked won";
  if (outcome === "lost") return "Marked lost";
  return "Marked on hold";
}

function defaultReason(outcome, valueUsd) {
  if (outcome === "won") return `Warm reply converted to a won prospect outcome for $${valueUsd.toLocaleString()}.`;
  if (outcome === "lost") return "Reply playbook marked this prospect lost after owner review.";
  return "Reply playbook put this prospect on hold after owner review.";
}
