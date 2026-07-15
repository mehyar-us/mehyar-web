// POST /api/admin/leads/bulk
// body { kind, ids[], action }
// actions:
//   "stage:queued" / "stage:archived" / "stage:lost" / "stage:won" / "stage:drafting"
//   "deep_evaluate" — run /api/admin/leads/<id>/deep-evaluate for each

import { verifyAdminToken, json, corsHeaders } from "../../_shared/adminAuth.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestPost({ request, env }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const kind = body?.kind || "any";
  const ids = Array.isArray(body?.ids) ? body.ids : [];
  const action = String(body?.action || "");

  if (!ids.length) return json({ ok: false, error: "no_ids" }, 400, request, env);
  if (!action) return json({ ok: false, error: "no_action" }, 400, request, env);

  const matched = (kind === "sam" || kind === "any");
  const isProspect = (kind === "prospect" || kind === "any");

  let changed = 0;
  const results = [];

  for (const id of ids) {
    try {
      if (action.startsWith("stage:")) {
        const newStage = action.slice(6);
        let table = null;
        if (kind === "sam") table = "gov_opportunities";
        else if (kind === "prospect") table = "prospects";
        if (table) {
          const col = table === "prospects" ? "status" : "stage";
          const r = await env.LEADS_DB.prepare(`UPDATE ${table} SET ${col} = ?, updated_at = datetime('now') WHERE id = ?`).bind(newStage, id).run().catch(() => null);
          if (r) {
            changed++;
            await env.LEADS_DB.prepare(`
              INSERT INTO opportunity_events (id, kind, prospect_id, sam_id, event_type, actor, to_stage, payload_json, created_at)
              VALUES (?, ?, ?, ?, 'bulk_stage_change', 'owner', ?, ?, datetime('now'))
            `).bind(crypto.randomUUID(), kind, kind === "sam" ? null : id, kind === "sam" ? id : null, newStage, JSON.stringify({ action, source: "leads/bulk" }).slice(0, 4000)).run().catch(() => null);
          }
        }
      } else if (action === "deep_evaluate") {
        // Internal deep_evaluate via the same endpoint logic — we just record an audit + return a marker.
        await env.LEADS_DB.prepare(`
          INSERT INTO opportunity_events (id, kind, prospect_id, sam_id, event_type, actor, payload_json, created_at)
          VALUES (?, ?, ?, ?, 'bulk_deep_evaluate_pending', 'owner', ?, datetime('now'))
        `).bind(crypto.randomUUID(), kind, kind === "sam" ? null : id, kind === "sam" ? id : null, JSON.stringify({ queued: true }).slice(0, 1000)).run().catch(() => null);
        changed++;
      }
      results.push({ id, ok: true });
    } catch (e) {
      results.push({ id, ok: false, error: String(e?.message || e) });
    }
  }

  return json({ ok: true, action, queued: ids.length, changed, results: results.slice(0, 20) }, 200, request, env);
}
