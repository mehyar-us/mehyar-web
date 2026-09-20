// functions/api/sproutscore/status.js
// SproutScore buyer status + retry surface (mehyar-web side).
//
// GET  /api/sproutscore/status?token=<order access_token>
//   Read-only: order status, product, credits (3-pack), report summary.
//   The success page polls this while generation runs.
// POST /api/sproutscore/status?token=<order access_token>
//   Body: {action:"retry"} — re-run generation for a failed single-report
//         order (exactly-once via the order row status guard).
//         {action:"set-center", center_id, center_name} — attach the center
//         to an awaiting single-report order and kick off generation.
//
// Token rules mirror /api/pay/status: < 16 chars -> 403, unknown -> 404.

import { runSproutscoreGeneration, sproutscoreErrorCopy } from "../_shared/fulfillSproutscore.js";
import { sendCloudflareEmail } from "../_shared/cloudflareEmail.js";

const nowSql = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function findOrder(db, token) {
  return db.prepare("SELECT * FROM sproutscore_orders WHERE access_token = ?").bind(token).first();
}

function orderView(order, credits) {
  let summary = null;
  try {
    const out = JSON.parse(order.output_json || "null");
    if (out && out.summary) summary = { ...out.summary, data_source: out.data_source, generated_at: out.generated_at };
  } catch {}
  let intakeName = "";
  try { intakeName = (JSON.parse(order.inputs_json || "{}") || {}).center_name || ""; } catch {}
  return {
    ok: true,
    status: order.status,
    product_id: order.product_id,
    email: order.email,
    bundle_slots: order.bundle_slots,
    credits: (credits || []).map((c) => ({ slot_no: c.slot_no, status: c.status, center_name: c.center_name })),
    report_summary: summary,
    ready_at: order.ready_at,
    email_sent_at: order.email_sent_at,
    failure_reason: order.status === "failed" ? order.failure_reason : null,
    error_copy: order.status === "failed" ? sproutscoreErrorCopy(order.failure_reason, intakeName) : null,
  };
}

export async function onRequestGet({ request, env }) {
  const db = env.LEADS_DB;
  if (!db) return json({ ok: false, error: "db_unavailable" }, 500);
  const token = (new URL(request.url).searchParams.get("token") || "").trim();
  if (!token || token.length < 16) return json({ ok: false, error: "invalid_token" }, 403);
  const order = await findOrder(db, token);
  if (!order) return json({ ok: false, error: "not_found" }, 404);
  const credits = order.bundle_slots
    ? (await db.prepare("SELECT slot_no, status, center_name FROM sproutscore_credits WHERE order_id = ? ORDER BY slot_no").bind(order.id).all()).results || []
    : [];
  return json(orderView(order, credits));
}

export async function onRequestPost({ request, env, waitUntil }) {
  const db = env.LEADS_DB;
  if (!db) return json({ ok: false, error: "db_unavailable" }, 500);
  const token = (new URL(request.url).searchParams.get("token") || "").trim();
  if (!token || token.length < 16) return json({ ok: false, error: "invalid_token" }, 403);
  const order = await findOrder(db, token);
  if (!order) return json({ ok: false, error: "not_found" }, 404);

  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "");

  const sendEmail = (e, msg) => sendCloudflareEmail(e, msg);

  if (action === "retry") {
    if (order.status === "ready") return json({ ok: true, action: "already_ready" });
    if (order.bundle_slots) return json({ ok: false, error: "not_applicable" }, 400);
    await db.prepare(`UPDATE sproutscore_orders SET status='paid', failure_reason=NULL WHERE id=?`).bind(order.id).run();
    const run = () => runSproutscoreGeneration(db, env, sendEmail, order.id);
    if (typeof waitUntil === "function") waitUntil(run());
    else await run();
    return json({ ok: true, action: "retry_started" });
  }

  if (action === "set-center") {
    if (order.bundle_slots) return json({ ok: false, error: "not_applicable" }, 400);
    if (order.status === "ready") return json({ ok: true, action: "already_ready" });
    const center_id = String(body.center_id || "").slice(0, 200).trim();
    const center_name = String(body.center_name || "").slice(0, 500).trim();
    if (!center_id && !center_name) return json({ ok: false, error: "missing_center" }, 400);
    let intake = {};
    try { intake = JSON.parse(order.inputs_json || "{}") || {}; } catch {}
    intake.center_id = center_id || intake.center_id || "";
    intake.center_name = center_name || intake.center_name || "";
    await db.prepare(`UPDATE sproutscore_orders SET inputs_json=?, status='paid', failure_reason=NULL WHERE id=?`)
      .bind(JSON.stringify(intake), order.id).run();
    const run = () => runSproutscoreGeneration(db, env, sendEmail, order.id);
    if (typeof waitUntil === "function") waitUntil(run());
    else await run();
    return json({ ok: true, action: "center_set" });
  }

  return json({ ok: false, error: "unknown_action" }, 400);
}
