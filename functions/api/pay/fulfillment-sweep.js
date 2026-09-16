// functions/api/pay/fulfillment-sweep.js
// POST /api/pay/fulfillment-sweep — recovery backstop for stuck AI-fulfillment
// orders. Runs on a schedule (GitHub Actions cron, every 5 min). Fully
// automatic: no human touch, no buyer action required.
//
// Why it exists (2026-09-16): the webhook's optimistic fast path drives the
// ~150s playbook generation inside waitUntil(). If that isolate is evicted
// mid-run, the order is orphaned in 'generating' forever — no catch runs,
// because the isolate is gone, not errored.
//
// Two hard platform limits shape this design:
//   1. No single request/response cycle may run ~150s: the Cloudflare edge
//      524s at ~100s. So the sweep NEVER awaits a generate body — it
//      fire-and-forget dispatches via waitUntil and returns fast.
//   2. Any isolate can die at any time — INCLUDING the caller's: when the
//      dispatching worker's isolate is reclaimed, its in-flight fetch to the
//      generate endpoint is cancelled and the callee dies mid-part. So
//      generate.js checkpoints every finished part to D1, and the GitHub
//      Actions runner itself drives generation per stuck order (a stable
//      client holding the connection open keeps the generate isolate alive;
//      proven: direct 147s call completes). Each drive resumes from the last
//      checkpoint — progress is monotonic, repeated drives converge to ready.
//
// The sweep therefore has two quick passes (both far under the edge budget):
//   PASS 1 — fire-and-forget dispatch for rows stuck in paid/generating > 8
//            min (best-effort bonus) AND return their tokens so the workflow
//            can drive generation directly as the stable caller.
//   PASS 2 — send the buyer email exactly once for ready-but-unemailed rows
//            (atomic email_sent_at claim; claim released if the send fails).
//
// Auth: Authorization: Bearer <AUDIT_CRON_SECRET> — the shared internal
// automation credential already injected into this worker's env by the
// deploy workflow. No new secrets.
//
// Scope: hustlekit_orders today. To cover another product, add its dispatch
// + email pair next to the HustleKit passes below.

import { sendCloudflareEmail } from "../_shared/cloudflareEmail.js";
import {
  hustlekitBaseUrl,
  hustlekitFromAddress,
  buildHustlekitDeliverableEmail,
  claimHustlekitEmailSent,
} from "../_shared/fulfillHustlekit.js";

const STUCK_MINUTES = 8; // older than this in paid/generating => orphaned run
const MAX_ROWS = 20;

const nowSql = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

// Fire-and-forget generate dispatch. The fetch() call puts the request on the
// wire synchronously; the response is observed in waitUntil (best effort).
// generate.js checkpoints every part, so even if this isolate dies a second
// later, the run continues on its own isolate and the next sweep resumes it.
function dispatchGenerate(waitUntil, base, row) {
  let inputs = {};
  try { inputs = JSON.parse(row.inputs_json || "{}"); } catch {}
  const track = inputs.track || "ai-writing";
  const p = fetch(`${base}/api/hustlekit/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ order_token: row.access_token, track, inputs }),
  })
    .then(async (gr) => {
      const gd = await gr.json().catch(() => ({}));
      if (!gr.ok || !gd.ok) {
        console.error("sweep generate failed", row.id, (gd && gd.error) || gr.status);
      }
    })
    .catch((e) => console.error("sweep generate dispatch threw", row.id, e && e.message));
  if (typeof waitUntil === "function") waitUntil(p);
  // No waitUntil (shouldn't happen on Pages): race a short timeout so we never
  // 524 the caller; the request is already on the wire.
  else p.catch(() => {});
  return track;
}

export async function onRequestPost({ request, env, waitUntil }) {
  const secret = env.AUDIT_CRON_SECRET || "";
  const auth = request.headers.get("authorization") || "";
  if (!secret || auth !== "Bearer " + secret) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  const db = env.LEADS_DB;
  if (!db) return json({ ok: false, error: "no_db" }, 503);
  const base = hustlekitBaseUrl(env);
  const sendEmail = (e, msg) => sendCloudflareEmail(e, msg);

  // ── PASS 1: dispatch generate for stuck rows (fire-and-forget) ──
  // NOTE: 'failed' is deliberately excluded — it means generate itself threw
  // (a content failure, not an orphaned run) and stays buyer-retryable via
  // the success page.
  const cutoff = new Date(Date.now() - STUCK_MINUTES * 60000).toISOString();
  const stuck = await db
    .prepare(
      "SELECT id, access_token, inputs_json FROM hustlekit_orders " +
        "WHERE status IN ('paid','generating') AND (created_at IS NULL OR created_at < ?) " +
        "ORDER BY created_at ASC LIMIT ?"
    )
    .bind(cutoff, MAX_ROWS)
    .all();
  const dispatched = [];
  const drive = []; // tokens for the workflow's stable-caller generate drive
  for (const r of stuck.results || []) {
    dispatchGenerate(waitUntil, base, r);
    dispatched.push(r.id);
    drive.push({ id: r.id, token: r.access_token });
  }

  // ── PASS 2: exactly-once buyer email for ready-but-unemailed rows ──
  const ready = await db
    .prepare(
      "SELECT id, email, access_token, inputs_json FROM hustlekit_orders " +
        "WHERE status='ready' AND email_sent_at IS NULL LIMIT ?"
    )
    .bind(MAX_ROWS)
    .all();
  const emailed = [];
  for (const r of ready.results || []) {
    const claimed = await claimHustlekitEmailSent(db, r.id);
    if (!claimed) {
      emailed.push({ order_id: r.id, email: "already_sent" });
      continue;
    }
    let inputs = {};
    try { inputs = JSON.parse(r.inputs_json || "{}"); } catch {}
    const track = inputs.track || "ai-writing";
    const { from, fromName } = hustlekitFromAddress(env);
    const { subject, text, html } = buildHustlekitDeliverableEmail({
      base,
      accessToken: r.access_token,
      track,
      fromName,
    });
    const result = await sendEmail(env, {
      from,
      fromName,
      to: r.email,
      replyTo: "info@mehyar.us",
      subject,
      text,
      html,
    });
    if (result.ok) {
      emailed.push({ order_id: r.id, email: "sent:" + result.status });
    } else {
      // Release the claim so a later sweep retries the send.
      await db
        .prepare("UPDATE hustlekit_orders SET email_sent_at=NULL WHERE id=?")
        .bind(r.id)
        .run()
        .catch(() => {});
      emailed.push({ order_id: r.id, email: "failed:" + String(result.error).slice(0, 120) });
    }
  }

  return json({ ok: true, stuck_minutes: STUCK_MINUTES, dispatched, drive, emailed });
}
