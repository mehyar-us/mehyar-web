// functions/api/pay/fulfillment-sweep.js
// POST /api/pay/fulfillment-sweep — recovery backstop for stuck AI-fulfillment
// orders. Runs on a schedule (GitHub Actions cron, every 5 min). Fully
// automatic: no human touch, no buyer action required.
//
// Why it exists (2026-09-16): the webhook's optimistic fast path drives the
// ~150s playbook generation inside waitUntil(). If that isolate is evicted
// mid-run, the order is orphaned in 'generating' forever — no catch runs,
// because the isolate is gone, not errored. The sweep re-arms such rows and
// re-drives generation (idempotent on ready), then sends the buyer email
// exactly once via the atomic email_sent_at claim.
//
// Auth: Authorization: Bearer <AUDIT_CRON_SECRET> — the shared internal
// automation credential already injected into this worker's env by the
// deploy workflow. No new secrets.
//
// Scope: hustlekit_orders today. To cover another product, add its resume
// driver next to resumeHustlekitOrder and call it from the loop below.

import { sendCloudflareEmail } from "../_shared/cloudflareEmail.js";
import { resumeHustlekitOrder } from "../_shared/fulfillHustlekit.js";

const STUCK_MINUTES = 8; // older than this in paid/generating => orphaned run
const MAX_ROWS = 5;      // bound per sweep invocation

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

  const cutoff = new Date(Date.now() - STUCK_MINUTES * 60000).toISOString();
  // NOTE: 'failed' is deliberately excluded — it means generate itself threw
  // (a content failure, not an orphaned run) and stays buyer-retryable via
  // the success page. The sweep only heals orphaned runs.
  const stuck = await db
    .prepare(
      "SELECT id FROM hustlekit_orders " +
        "WHERE status IN ('paid','generating') AND (created_at IS NULL OR created_at < ?) " +
        "ORDER BY created_at ASC LIMIT ?"
    )
    .bind(cutoff, MAX_ROWS)
    .all();

  const sendEmail = (e, msg) => sendCloudflareEmail(e, msg);
  const orders = [];
  for (const r of stuck.results || []) {
    try {
      orders.push(await resumeHustlekitOrder({ db, env, sendEmail }, r.id));
    } catch (e) {
      orders.push({ order_id: r.id, ok: false, error: String((e && e.message) || e).slice(0, 120) });
    }
  }
  return json({ ok: true, swept: orders.length, stuck_minutes: STUCK_MINUTES, orders });
}
