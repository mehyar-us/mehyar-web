// POST /api/moonroom/fulfill-callback
// Called by the Moonroom Pages project when a paid pack finishes generating
// (see moonroom worker generate-fulfill.js). Secret-guarded via the shared
// MOONROOM_FULFILL_SECRET. Marks the order ready/failed and sends the buyer
// the deliverable email. Idempotent: replays on a final order are no-ops.
//
// Redeploy trigger: CF_EMAIL_ACCOUNT_ID added 2026-10-09.
// Body: { order_token, status: "ready"|"failed", manifest? }

import { sendCloudflareEmail } from "../_shared/cloudflareEmail.js";

const nowSql = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const GALLERY_URL = "https://moonroom.mehyar.us/gallery.html";

function j(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function onRequestPost({ request, env }) {
  const db = env.LEADS_DB;
  if (!db) return j({ ok: false, error: "no_db" }, 500);

  const secret = request.headers.get("x-moonroom-secret");
  if (!secret || secret !== env.MOONROOM_FULFILL_SECRET) {
    return j({ ok: false, error: "unauthorized" }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return j({ ok: false, error: "invalid JSON" }, 400);
  }
  const { order_token, status, manifest } = body || {};
  if (!order_token || !["ready", "failed"].includes(status)) {
    return j({ ok: false, error: "order_token and valid status required" }, 400);
  }

  const order = await db
    .prepare(
      "SELECT id, product_id, email, access_token, status, email_sent_at FROM moonroom_orders WHERE access_token = ?"
    )
    .bind(order_token)
    .first();
  if (!order) return j({ ok: false, error: "order not found" }, 404);

  // Idempotent: a final order stays final — but the worker marks ready in D1
  // directly before POSTing this callback, so "already ready" must NOT skip
  // the email. Gate the early return on email_sent_at; the send block below
  // already guards on !order.email_sent_at, so replays can't double-send.
  if ((order.status === "ready" || order.status === "failed") && order.email_sent_at) {
    return j({ ok: true, replay: true, status: order.status });
  }

  if (status === "ready") {
    await db
      .prepare(
        `UPDATE moonroom_orders SET status='ready', output_json=?, ready_at=${nowSql}, updated_at=${nowSql} WHERE id=?`
      )
      .bind(JSON.stringify(manifest || {}), order.id)
      .run();
  } else {
    await db
      .prepare(
        `UPDATE moonroom_orders SET status='failed', failure_reason=?, updated_at=${nowSql} WHERE id=?`
      )
      .bind(String((manifest && manifest.error) || "generation failed").slice(0, 300), order.id)
      .run();
  }

  // Buyer email (only once — email_sent_at guard).
  let emailOk = false;
  if (!order.email_sent_at && order.email) {
    const galleryUrl = `${GALLERY_URL}?token=${order.access_token}`;
    const packName =
      order.product_id === "moonroom-product-studio"
        ? "Product Studio pack"
        : order.product_id === "moonroom-theme-pack"
          ? "Theme Pack"
          : "Headshot Pack";
    const subject =
      status === "ready"
        ? `Your Moonroom ${packName} is ready`
        : `Your Moonroom ${packName} — we hit a snag`;
    const text =
      status === "ready"
        ? `Thanks for your purchase!\n\nYour Moonroom ${packName} is ready — open your gallery to download your portraits:\n${galleryUrl}\n\n` +
          `This link is personal to you — keep it somewhere safe. If it ever stops working, just reply to this email and we'll sort it out.\n\n-- Moonroom`
        : `Thanks for your purchase!\n\nWe hit a snag generating your Moonroom ${packName}. Nothing was lost — just reply to this email and we'll get it sorted right away.\n\nYou can also check your order status here:\n${galleryUrl}\n\n-- Moonroom`;
    const html =
      `<p>Thanks for your purchase!</p>` +
      (status === "ready"
        ? `<p>Your <strong>Moonroom ${packName}</strong> is ready — open your gallery to download your portraits:</p>` +
          `<p><a href="${galleryUrl}" style="display:inline-block;background:#e6c98a;color:#141021;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:bold;">Open your gallery</a></p>` +
          `<p style="color:#6b7280;font-size:13px;">Or copy this link:<br><a href="${galleryUrl}">${galleryUrl}</a></p>` +
          `<p style="color:#6b7280;font-size:13px;">This link is personal to you — keep it somewhere safe. If it ever stops working, just reply to this email and we'll sort it out.</p>`
        : `<p>We hit a snag generating your <strong>Moonroom ${packName}</strong>. Nothing was lost — just reply to this email and we'll get it sorted right away.</p>` +
          `<p style="color:#6b7280;font-size:13px;">Order status:<br><a href="${galleryUrl}">${galleryUrl}</a></p>`) +
      `<p>-- Moonroom</p>`;
    const result = await sendCloudflareEmail(env, {
      from: "team@mehyar.us",
      fromName: "Moonroom",
      to: order.email,
      replyTo: "info@mehyar.us",
      subject,
      text,
      html,
    });
    emailOk = !!result.ok;
    if (!result.ok) console.error("moonroom fulfill-callback email failed", order.id, result.error);
    else {
      await db
        .prepare(`UPDATE moonroom_orders SET email_sent_at=${nowSql} WHERE id=?`)
        .bind(order.id)
        .run();
    }
  }

  return j({ ok: true, status, email_ok: emailOk });
}
