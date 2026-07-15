// POST /api/admin/opportunities/:id/decision
// Mark a SAM.gov opportunity as won/lost/no_bid.
// Records to opportunity_decisions + sets stage on gov_opportunities + audit log.
//
// Body: { outcome: 'won'|'lost'|'no_bid', value_usd?: number, reason_code?: string, reason_body?: string }

import { verifyAdminToken, json, corsHeaders } from "../../_shared/adminAuth.js";

const ACCEPTED_OUTCOMES = new Set(["won", "lost", "no_bid", "on_hold"]);

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestPost({ request, env, params }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  const opportunityId = params?.id;
  if (!opportunityId) return json({ ok: false, error: "missing_id" }, 400, request, env);

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const outcome = String(body?.outcome || "").toLowerCase();
  if (!ACCEPTED_OUTCOMES.has(outcome)) {
    return json({ ok: false, error: "bad_outcome", accepted: [...ACCEPTED_OUTCOMES] }, 400, request, env);
  }
  const valueUsd = Number(body?.value_usd || 0) || 0;
  const reasonCode = String(body?.reason_code || "").slice(0, 64) || null;
  const reasonBody = String(body?.reason_body || "").slice(0, 4000) || null;

  try {
    // Verify opportunity exists
    const opp = await env.LEADS_DB.prepare(
      `SELECT id, title, agency, stage, fit_score FROM gov_opportunities WHERE id = ? LIMIT 1`
    ).bind(opportunityId).first().catch(() => null);
    if (!opp) return json({ ok: false, error: "not_found" }, 404, request, env);

    // Insert decision row (table created in migration 0012)
    const decisionId = crypto.randomUUID();
    await env.LEADS_DB.prepare(`
      INSERT INTO opportunity_decisions (id, opportunity_id, kind, decision, outcome,
                                         value_usd, reason_code, reason_body,
                                         decided_by, decided_at, created_at)
      VALUES (?, ?, 'sam', ?, ?, ?, ?, ?, 'owner', datetime('now'), datetime('now'))
    `).bind(decisionId, opportunityId, outcome, outcome, valueUsd, reasonCode, reasonBody).run().catch(async (e) => {
      // Table might not exist yet — create it on the fly
      await env.LEADS_DB.prepare(`
        CREATE TABLE IF NOT EXISTS opportunity_decisions (
          id TEXT PRIMARY KEY,
          opportunity_id TEXT,
          kind TEXT NOT NULL DEFAULT 'sam',
          decision TEXT NOT NULL,
          outcome TEXT NOT NULL,
          value_usd REAL DEFAULT 0,
          reason_code TEXT,
          reason_body TEXT,
          decided_by TEXT NOT NULL DEFAULT 'owner',
          decided_at TEXT NOT NULL DEFAULT (datetime('now')),
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `).run();
      // Retry insert
      await env.LEADS_DB.prepare(`
        INSERT INTO opportunity_decisions (id, opportunity_id, kind, decision, outcome,
                                           value_usd, reason_code, reason_body,
                                           decided_by, decided_at, created_at)
        VALUES (?, ?, 'sam', ?, ?, ?, ?, ?, 'owner', datetime('now'), datetime('now'))
      `).bind(decisionId, opportunityId, outcome, outcome, valueUsd, reasonCode, reasonBody).run();
    });

    // Update opportunity stage
    const newStage = outcome; // won → won, lost → lost, no_bid → no_bid, on_hold → on_hold
    await env.LEADS_DB.prepare(`
      UPDATE gov_opportunities SET stage = ?, updated_at = datetime('now') WHERE id = ?
    `).bind(newStage, opportunityId).run();

    // If won with value_usd, set last_draft_id + last_drafted_at so case-studies can pick it up
    if (outcome === "won") {
      await env.LEADS_DB.prepare(`
        UPDATE gov_opportunities
        SET last_draft_id = ?, last_drafted_at = datetime('now')
        WHERE id = ?
      `).bind(decisionId, opportunityId).run().catch(() => null);
    }

    // Audit event
    await env.LEADS_DB.prepare(`
      INSERT INTO opportunity_events (id, kind, opportunity_id, sam_id, event_type,
                                     actor, payload_json, created_at)
      VALUES (?, 'sam', ?, ?, 'decision', 'owner', ?, datetime('now'))
    `).bind(crypto.randomUUID(), opportunityId, opportunityId, JSON.stringify({
      decision_id: decisionId,
      outcome, value_usd: valueUsd, reason_code: reasonCode, reason_body: reasonBody,
      from_stage: opp.stage,
      to_stage: newStage,
    }).slice(0, 18000)).run().catch(() => null);

    return json({
      ok: true,
      decision_id: decisionId,
      opportunity_id: opportunityId,
      outcome,
      value_usd: valueUsd,
      new_stage: newStage,
      previous_stage: opp.stage,
      title: opp.title,
      agency: opp.agency,
      decided_at: new Date().toISOString(),
    }, 200, request, env);
  } catch (e) {
    return json({ ok: false, error: "decision_failed", details: String(e?.message || e) }, 500, request, env);
  }
}
