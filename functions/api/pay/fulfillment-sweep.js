// functions/api/pay/fulfillment-sweep.js
// POST /api/pay/fulfillment-sweep — recovery backstop for stuck AI-fulfillment
// orders, ALL products. Runs on a schedule (GitHub Actions cron, every 5 min).
// Fully automatic: no human touch, no buyer action required.
//
// 2026-10-05: generalized from HustleKit-only to every AI-generation product
// (registry in ../_shared/sweepProducts.js). The habit, in code, everywhere:
//   PASS 0 — orphan paid payments: billing_payments rows paid > 8 min with NO
//            order row → replay the product's fulfill module (idempotent on
//            payment_id, so replays are safe).
//   PASS 1 — stuck rows (paid/generating/failed > 8 min, drive_attempts < 8):
//            re-drive generation — HTTP POST to the product's generate
//            endpoint, or the in-worker generator where one is exported.
//   PASS 2 — ready rows with email_sent_at NULL: exactly-once buyer email
//            (atomic claim; claim released if the send fails).
//
// Why it exists (2026-09-16): the webhook's optimistic fast path drives
// generation inside waitUntil(). If that isolate is evicted mid-run, the order
// is orphaned in 'generating' forever — no catch runs, because the isolate is
// gone, not errored. A failed generation must NEVER silently strand a buyer.
//
// HustleKit keeps its proven dedicated path below (the workflow's
// stable-caller drive depends on its `drive` response shape).

import { sendCloudflareEmail } from "../_shared/cloudflareEmail.js";
import {
  SWEEP_PRODUCTS,
  BROWSER_UA,
  buildBackstopEmail,
} from "../_shared/sweepProducts.js";
import { runSproutscoreGeneration } from "../_shared/fulfillSproutscore.js";
import { generateTaxTrimPacket } from "../_shared/fulfillTaxtrim.js";
// PASS 0 orphan-replay modules (all idempotent on payment_id).
import { fulfillDesignful } from "../_shared/fulfillDesignful.js";
import { fulfillPrepguide } from "../_shared/fulfillPrepguide.js";
import { fulfillPromptpack } from "../_shared/fulfillPromptpack.js";
import { fulfillTiktokgrowth } from "../_shared/fulfillTiktokgrowth.js";
import { fulfillBizbuilder } from "../_shared/fulfillBizbuilder.js";
import { fulfillCreditfixkit } from "../_shared/fulfillCreditfixkit.js";
import { fulfillTruesketch } from "../_shared/fulfillTruesketch.js";
import { fulfillSproutscore } from "../_shared/fulfillSproutscore.js";
import { fulfillPuretap } from "../_shared/fulfillPuretap.js";
import { fulfillTicketBeat } from "../_shared/fulfillTicketBeat.js";
import { fulfillTaxtrim } from "../_shared/fulfillTaxtrim.js";
import {
  hustlekitBaseUrl,
  hustlekitFromAddress,
  buildHustlekitDeliverableEmail,
  claimHustlekitEmailSent,
} from "../_shared/fulfillHustlekit.js";

const STUCK_MINUTES = 8; // older than this in paid/generating/failed => orphaned run
const MAX_ROWS = 20;
const MAX_DRIVE_ATTEMPTS = 8; // cap sweeper retries per order (poison-row guard)
// PASS 2 backstop emails only cover rows created after the v2 deploy, or rows
// this sweep itself re-drove — so the first v2 run never mass-emails history.
const SWEEP_EPOCH = "2026-10-05T00:00:00Z";
// PASS 0 orphan replay only for recent payments (inputs schemas are current).
const ORPHAN_SINCE = "2026-09-01T00:00:00Z";

const nowSql = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

const FULFILL_MODULES = {
  designful: fulfillDesignful,
  prepguide: fulfillPrepguide,
  promptpack: fulfillPromptpack,
  tiktokgrowth: fulfillTiktokgrowth,
  bizbuilder: fulfillBizbuilder,
  creditfixkit: fulfillCreditfixkit,
  truesketch: fulfillTruesketch,
  sproutscore: fulfillSproutscore,
  puretap: fulfillPuretap,
  ticketbeat: fulfillTicketBeat,
  taxtrim: fulfillTaxtrim,
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function tableExists(db, table) {
  try {
    await db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).all();
    return true;
  } catch {
    return false;
  }
}

// Fire-and-forget generate dispatch. The fetch() call puts the request on the
// wire synchronously; the response is observed in waitUntil (best effort).
// Browser UA: mehyar.us bot protection (Cloudflare 1010) blocks non-browser
// server-to-site clients even with valid credentials.
function dispatchGenerate(waitUntil, url, body, extraHeaders, rowId, key) {
  const p = fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": BROWSER_UA,
      ...(extraHeaders || {}),
    },
    body: JSON.stringify(body),
  })
    .then(async (gr) => {
      const gd = await gr.json().catch(() => ({}));
      if (!gr.ok || gd.ok === false) {
        console.error("sweep generate failed", key, rowId, (gd && gd.error) || gr.status);
      }
    })
    .catch((e) => console.error("sweep generate dispatch threw", key, rowId, e && e.message));
  if (typeof waitUntil === "function") waitUntil(p);
  else p.catch(() => {});
}

export async function onRequestPost({ request, env, waitUntil }) {
  const secret = env.AUDIT_CRON_SECRET || "";
  const auth = request.headers.get("authorization") || "";
  if (!secret || auth !== "Bearer " + secret) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  const db = env.LEADS_DB;
  if (!db) return json({ ok: false, error: "no_db" }, 503);
  const sendEmail = (e, msg) => sendCloudflareEmail(e, msg);

  const cutoff = new Date(Date.now() - STUCK_MINUTES * 60000).toISOString();
  const orphans = [];
  const dispatched = [];
  const drive = []; // tokens for the workflow's stable-caller generate drive (hustlekit)
  const emailed = [];

  // ── PASS 0: orphan paid payments → replay the fulfill module ──
  // (webhook marked the payment paid but the order row was never created,
  // e.g. the hook threw before its idempotent insert).
  for (const spec of SWEEP_PRODUCTS) {
    const hook = FULFILL_MODULES[spec.key];
    if (!hook) continue;
    if (!(await tableExists(db, spec.table))) continue;
    let rows = [];
    try {
      const r = await db
        .prepare(
          "SELECT p.* FROM billing_payments p " +
            "WHERE p.status = 'paid' " +
            "AND p.paid_at > ? AND p.paid_at < ? " +
            "AND p.product_id IN (SELECT id FROM billing_products WHERE fulfillment = ?) " +
            "AND NOT EXISTS (SELECT 1 FROM " + spec.table + " o WHERE o.payment_id = p.id) " +
            "LIMIT ?"
        )
        .bind(ORPHAN_SINCE, cutoff, spec.fulfillment, MAX_ROWS)
        .all();
      rows = r.results || [];
    } catch (e) {
      console.error("sweep pass0 query failed", spec.key, e && e.message);
      continue;
    }
    for (const payment of rows) {
      try {
        const res = await hook({ db, env, waitUntil, sendEmail }, payment);
        orphans.push({ product: spec.key, payment_id: payment.id, ok: !!(res && res.ok) });
      } catch (e) {
        console.error("sweep pass0 replay failed", spec.key, payment.id, e && e.message);
        orphans.push({ product: spec.key, payment_id: payment.id, ok: false });
      }
    }
  }

  // ── PASS 1: re-drive stuck rows ──
  for (const spec of SWEEP_PRODUCTS) {
    if (!(await tableExists(db, spec.table))) continue;
    const statuses = spec.stuckStatuses.map((s) => `'${s}'`).join(",");
    // Designful bundles never generate (buyer picks features); skip them.
    const extraWhere = spec.key === "designful" ? "AND bundle_slots IS NULL" : "";
    let stuck = [];
    try {
      const r = await db
        .prepare(
          `SELECT * FROM ${spec.table} WHERE status IN (${statuses}) ` +
            `AND COALESCE(drive_attempts,0) < ? ` +
            `AND (created_at IS NULL OR created_at < ?) ${extraWhere} ` +
            `ORDER BY created_at ASC LIMIT ?`
        )
        .bind(MAX_DRIVE_ATTEMPTS, cutoff, MAX_ROWS)
        .all();
      stuck = r.results || [];
    } catch (e) {
      console.error("sweep pass1 query failed", spec.key, e && e.message);
      continue;
    }
    for (const row of stuck) {
      try {
        await db
          .prepare(`UPDATE ${spec.table} SET drive_attempts = COALESCE(drive_attempts,0) + 1 WHERE id = ?`)
          .bind(row.id)
          .run();
      } catch {}
      try {
        if (spec.localRedrive === "sproutscore") {
          const run = runSproutscoreGeneration(db, env, sendEmail, row.id);
          if (typeof waitUntil === "function") waitUntil(run.catch((e) => console.error("sweep sproutscore redrive threw", row.id, e && e.message)));
          else await run.catch(() => {});
        } else if (spec.localRedrive === "taxtrim") {
          const run = (async () => {
            try {
              await generateTaxTrimPacket({ db, env }, row);
            } catch (e) {
              console.error("sweep taxtrim redrive failed", row.id, e && e.message);
              try {
                await db.prepare(`UPDATE ${spec.table} SET status='failed', failure_reason=? WHERE id=? AND status!='ready'`)
                  .bind(String((e && e.message) || e).slice(0, 300), row.id).run();
              } catch {}
            }
          })();
          if (typeof waitUntil === "function") waitUntil(run);
          else await run.catch(() => {});
        } else {
          const url = spec.base(env) + spec.generatePath;
          const headers = spec.generateHeaders ? spec.generateHeaders(env) : {};
          dispatchGenerate(waitUntil, url, spec.generateBody(row), headers, row.id, spec.key);
        }
        dispatched.push(`${spec.key}:${row.id}`);
      } catch (e) {
        console.error("sweep pass1 redrive failed", spec.key, row.id, e && e.message);
        try {
          await db.prepare(`UPDATE ${spec.table} SET failure_reason=? WHERE id=?`)
            .bind(String((e && e.message) || e).slice(0, 300), row.id).run();
        } catch {}
      }
    }
  }

  // ── PASS 2: exactly-once backstop email for ready-but-unemailed rows ──
  for (const spec of SWEEP_PRODUCTS) {
    if (!(await tableExists(db, spec.table))) continue;
    let ready = [];
    try {
      const r = await db
        .prepare(
          `SELECT * FROM ${spec.table} WHERE status = 'ready' AND email_sent_at IS NULL ` +
            `AND (created_at > ? OR COALESCE(drive_attempts,0) > 0) LIMIT ?`
        )
        .bind(SWEEP_EPOCH, MAX_ROWS)
        .all();
      ready = r.results || [];
    } catch (e) {
      console.error("sweep pass2 query failed", spec.key, e && e.message);
      continue;
    }
    for (const row of ready) {
      let claimed = false;
      try {
        const c = await db
          .prepare(`UPDATE ${spec.table} SET email_sent_at = ${nowSql} WHERE id = ? AND email_sent_at IS NULL`)
          .bind(row.id)
          .run();
        claimed = c.meta && c.meta.changes > 0;
      } catch {}
      if (!claimed) continue;
      const deliverableUrl = spec.deliverableUrl(env, row);
      const { subject, text, html } = buildBackstopEmail({
        fromName: spec.fromName,
        displayName: spec.displayName,
        deliverableUrl,
      });
      const result = await sendEmail(env, {
        from: "team@mehyar.us",
        fromName: spec.fromName,
        to: row.email,
        replyTo: "info@mehyar.us",
        subject,
        text,
        html,
      });
      if (result.ok) {
        emailed.push({ order_id: `${spec.key}:${row.id}`, email: "sent" });
      } else {
        try {
          await db.prepare(`UPDATE ${spec.table} SET email_sent_at = NULL WHERE id = ?`).bind(row.id).run();
        } catch {}
        emailed.push({ order_id: `${spec.key}:${row.id}`, email: "failed:" + String(result.error).slice(0, 120) });
      }
    }
  }

  // ── HustleKit dedicated path (proven; workflow stable-caller depends on it) ──
  const base = hustlekitBaseUrl(env);
  {
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
    for (const r of stuck.results || []) {
      let inputs = {};
      try { inputs = JSON.parse(r.inputs_json || "{}"); } catch {}
      const track = inputs.track || "ai-writing";
      const p = fetch(`${base}/api/hustlekit/generate`, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": BROWSER_UA },
        body: JSON.stringify({ order_token: r.access_token, track, inputs }),
      })
        .then(async (gr) => {
          const gd = await gr.json().catch(() => ({}));
          if (!gr.ok || !gd.ok) console.error("sweep generate failed", "hustlekit", r.id, (gd && gd.error) || gr.status);
        })
        .catch((e) => console.error("sweep generate dispatch threw", "hustlekit", r.id, e && e.message));
      if (typeof waitUntil === "function") waitUntil(p);
      else p.catch(() => {});
      try {
        await db.prepare("UPDATE hustlekit_orders SET drive_attempts = COALESCE(drive_attempts,0) + 1 WHERE id = ?").bind(r.id).run();
      } catch {}
      dispatched.push(`hustlekit:${r.id}`);
      drive.push({ id: r.id, token: r.access_token });
    }
  }
  {
    const ready = await db
      .prepare("SELECT id, email, access_token, inputs_json FROM hustlekit_orders WHERE status='ready' AND email_sent_at IS NULL LIMIT ?")
      .bind(MAX_ROWS)
      .all();
    for (const r of ready.results || []) {
      const claimed = await claimHustlekitEmailSent(db, r.id);
      if (!claimed) continue;
      let inputs = {};
      try { inputs = JSON.parse(r.inputs_json || "{}"); } catch {}
      const track = inputs.track || "ai-writing";
      const { from, fromName } = hustlekitFromAddress(env);
      const { subject, text, html } = buildHustlekitDeliverableEmail({ base, accessToken: r.access_token, track, fromName });
      const result = await sendEmail(env, { from, fromName, to: r.email, replyTo: "info@mehyar.us", subject, text, html });
      if (result.ok) {
        emailed.push({ order_id: `hustlekit:${r.id}`, email: "sent" });
      } else {
        await db.prepare("UPDATE hustlekit_orders SET email_sent_at=NULL WHERE id=?").bind(r.id).run().catch(() => {});
        emailed.push({ order_id: `hustlekit:${r.id}`, email: "failed:" + String(result.error).slice(0, 120) });
      }
    }
  }

  return json({ ok: true, stuck_minutes: STUCK_MINUTES, orphans, dispatched, drive, emailed });
}
