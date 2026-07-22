// POST /api/admin/mayor/replies/[id]/mark-handled
//
// Flip prospect_replies.needs_action from 1 to 0 after the owner has
// responded to the inbound email. Idempotent — re-posting is a no-op.

import { verifyAdminToken, json, corsHeaders } from "../../../../_shared/adminAuth.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestPost({ request, env, params }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  const id = (params?.id || "").toString().slice(0, 64);
  if (!id) return json({ ok: false, error: "missing_id" }, 400, request, env);

  try {
    const result = await env.LEADS_DB.prepare(`
      UPDATE prospect_replies
      SET needs_action = 0, handled_at = COALESCE(handled_at, datetime('now'))
      WHERE id = ?
    `).bind(id).run();
    return json({
      ok: true,
      id,
      changes: result?.meta?.changes ?? 0,
    }, 200, request, env);
  } catch (e) {
    console.error("mark-handled: update failed", e);
    return json({ ok: false, error: "update_failed", details: String(e?.message || e) }, 500, request, env);
  }
}
