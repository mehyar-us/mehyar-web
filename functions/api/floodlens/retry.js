// functions/api/floodlens/retry.js
// POST /api/floodlens/retry — synchronously re-drives PDF generation for one
// stuck FloodLens order. This is the fulfillment sweep's stable caller: the
// GitHub Actions runner holds the connection open, so isolate eviction on the
// worker side can't orphan the run the way waitUntil() can.
//
// Auth: Authorization: Bearer <AUDIT_CRON_SECRET> (same internal automation
// credential as /api/pay/fulfillment-sweep). No buyer action needed.
//
// Contract: exactly ONE generation path — delegates to generateFloodlensOrder
// in functions/api/_shared/fulfillFloodlens.js. Idempotent: returns
// {replay:true} when the order is already ready; attempt-capped at 8 drives
// per order (poison-row guard).

import { generateFloodlensOrder } from "../_shared/fulfillFloodlens.js";
import { sendCloudflareEmail } from "../_shared/cloudflareEmail.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function onRequestPost({ request, env }) {
  const secret = env.AUDIT_CRON_SECRET || "";
  const auth = request.headers.get("authorization") || "";
  if (!secret || auth !== "Bearer " + secret) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  const db = env.LEADS_DB;
  if (!db) return json({ ok: false, error: "no_db" }, 503);

  let body = {};
  try { body = await request.json(); } catch {}
  const orderId = Number(body.order_id || body.id || 0);
  if (!orderId) return json({ ok: false, error: "order_id_required" }, 400);

  const sendEmail = (e, msg) => sendCloudflareEmail(e, msg);
  try {
    const r = await generateFloodlensOrder({ db, env, sendEmail }, orderId);
    return json({ ok: !!r.ok, ...r });
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e).slice(0, 120) }, 500);
  }
}
