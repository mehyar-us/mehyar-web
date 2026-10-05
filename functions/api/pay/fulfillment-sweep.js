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
//   PASS 1 — fire-and-forget dispatch for rows stuck in paid/generating/
//            failed > 8 min (best-effort bonus) AND return their tokens so the
//            workflow can drive generation directly as the stable caller.
//            'failed' rows are included (capped by drive_attempts): most
//            failures are transient infra throws, not content failures.
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
  buildFloodlensReceiptEmail,
  claimFloodlensEmailSent,
  PRODUCT_NAMES as FLOODLENS_PRODUCT_NAMES,
} from "../_shared/fulfillFloodlens.js";
import { randomToken } from "../_shared/floodlensCore.js";
import {
  hustlekitBaseUrl,
  hustlekitFromAddress,
  buildHustlekitDeliverableEmail,
  claimHustlekitEmailSent,
} from "../_shared/fulfillHustlekit.js";

const STUCK_MINUTES = 8; // older than this in paid/generating/failed => orphaned run
const MAX_ROWS = 20;
const MAX_DRIVE_ATTEMPTS = 8; // cap sweeper retries per order (poison-row guard)

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

  // ── FLOODLENS passes: stuck-row drive list + exactly-once receipt emails.
  //    Runs every sweep tick (GitHub Actions, every 5 min) — this is the
  //    standing habit so no paid order ever sits unfulfilled again.
  let driveFloodlens = [], emailedFloodlens = [];
  try {
    const fl = await sweepFloodlens(db, env, sendEmail);
    driveFloodlens = fl.driveFloodlens;
    emailedFloodlens = fl.emailedFloodlens;
  } catch (e) {
    console.error("sweep floodlens passes failed", e && e.message);
  }

  // ── PASS 1: dispatch generate for stuck rows (fire-and-forget) ──
  // 'failed' is INCLUDED on purpose: generate.js marks a row failed on ANY
  // throw — including transient infra failures (isolate eviction mid-run),
  // not just content failures — and generate.js re-arms failed rows on the
  // next attempt. drive_attempts caps sweeper retries so a genuine poison
  // row ages out; the buyer retry button stays available regardless.
  const cutoff = new Date(Date.now() - STUCK_MINUTES * 60000).toISOString();
  const stuck = await db
    .prepare(
      "SELECT id, access_token, inputs_json FROM hustlekit_orders " +
        "WHERE status IN ('paid','generating','failed') " +
        "AND COALESCE(drive_attempts,0) < ? " +
        "AND (created_at IS NULL OR created_at < ?) " +
        "ORDER BY created_at ASC LIMIT ?"
    )
    .bind(MAX_DRIVE_ATTEMPTS, cutoff, MAX_ROWS)
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

  return json({ ok: true, stuck_minutes: STUCK_MINUTES, dispatched, drive, emailed,
    drive_floodlens: driveFloodlens, emailed_floodlens: emailedFloodlens });
}

// ── FLOODLENS passes (2026-10-05): the same orphan class that left
//    floodlens_orders row 5 (payment 231, $9) stuck in 'generating' for 3+
//    hours — its waitUntil() isolate was evicted mid-run, so no catch ran and
//    nothing ever retried. The sweep is the standing habit: every 5 minutes
//    (GitHub Actions cron) it finds stuck FloodLens rows and hands them to
//    the workflow, which drives POST /api/floodlens/retry as the stable
//    caller (one generation path: generateFloodlensOrder).
async function sweepFloodlens(db, env, sendEmail) {
  const cutoff = new Date(Date.now() - STUCK_MINUTES * 60000).toISOString();
  const driveFloodlens = [];
  const emailedFloodlens = [];

  // PASS FL-1: stuck rows -> workflow drives generation via /api/floodlens/retry
  let stuck;
  try {
    stuck = await db
      .prepare(
        "SELECT id, token FROM floodlens_orders " +
          "WHERE status IN ('paid','generating','failed') " +
          "AND COALESCE(drive_attempts,0) < ? " +
          "AND (created_at IS NULL OR created_at < ?) " +
          "ORDER BY created_at ASC LIMIT ?"
      )
      .bind(MAX_DRIVE_ATTEMPTS, cutoff, MAX_ROWS)
      .all();
  } catch (e) {
    // Pre-migration 0034 (no drive_attempts column): skip rather than fail
    // the whole sweep.
    console.error("sweep floodlens stuck query failed", e && e.message);
    stuck = { results: [] };
  }
  for (const r of stuck.results || []) {
    driveFloodlens.push({ id: r.id, token: r.token });
  }

  // PASS FL-2: exactly-once receipt email for ready-but-unemailed rows.
  let ready;
  try {
    ready = await db
      .prepare(
        "SELECT id, email, token, product_id, lookup_token FROM floodlens_orders " +
          "WHERE status='ready' AND email_sent_at IS NULL LIMIT ?"
      )
      .bind(MAX_ROWS)
      .all();
  } catch (e) {
    console.error("sweep floodlens email query failed", e && e.message);
    ready = { results: [] };
  }
  for (const r of ready.results || []) {
    const claimed = await claimFloodlensEmailSent(db, r.id);
    if (!claimed) {
      emailedFloodlens.push({ order_id: r.id, email: "already_sent" });
      continue;
    }
    const emailLc = String(r.email).toLowerCase();
    let sub = null;
    try {
      sub = await db.prepare("SELECT confirm_token FROM floodlens_subscribers WHERE email=?")
        .bind(emailLc).first();
      if (!sub) {
        const subToken = randomToken(32);
        await db.prepare(
          "INSERT INTO floodlens_subscribers (email, status, brand, lookup_token, confirm_token, source, converted) " +
          "VALUES (?, 'purchased', 'floodlens', ?, ?, 'purchase', 1) " +
          "ON CONFLICT(email) DO UPDATE SET converted=1"
        ).bind(emailLc, r.lookup_token || "", subToken).run();
        sub = { confirm_token: subToken };
      }
    } catch (e) {
      console.error("sweep floodlens subscriber ensure failed", r.id, e && e.message);
      await db.prepare("UPDATE floodlens_orders SET email_sent_at=NULL WHERE id=?").bind(r.id).run().catch(() => {});
      emailedFloodlens.push({ order_id: r.id, email: "failed:subscriber" });
      continue;
    }
    const productName = (FLOODLENS_PRODUCT_NAMES && FLOODLENS_PRODUCT_NAMES[r.product_id]) || r.product_id;
    const { subject, text, html, unsubUrl } = buildFloodlensReceiptEmail(productName, r.token, sub.confirm_token);
    const { from, fromName } = { from: env.FLOODLENS_FROM_EMAIL || "team@mehyar.us", fromName: "FloodLens" };
    const result = await sendEmail(env, {
      from, fromName, to: r.email, replyTo: "info@mehyar.us", subject, text, html,
      headers: {
        "List-Unsubscribe": `<${unsubUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    if (result.ok) {
      emailedFloodlens.push({ order_id: r.id, email: "sent:" + result.status });
    } else {
      await db.prepare("UPDATE floodlens_orders SET email_sent_at=NULL WHERE id=?").bind(r.id).run().catch(() => {});
      emailedFloodlens.push({ order_id: r.id, email: "failed:" + String(result.error).slice(0, 120) });
    }
  }

  return { driveFloodlens, emailedFloodlens };
}

