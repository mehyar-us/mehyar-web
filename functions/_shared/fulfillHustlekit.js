// pwa/fulfill-hustlekit.js
// Standalone ES module: Stripe fulfillment for fulfillment='hustlekit' products.
// Called from the shared /api/pay/webhook in mehyar-web.
// Modeled on fulfillDesignful.js.
//
// Contract: fulfillHustlekit({ db, env, waitUntil, sendEmail }, payment)
//   db        — D1 binding (shared mehyar_leads_prod DB; has hustlekit_orders)
//   env       — worker env (HUSTLEKIT_BASE_URL optional; defaults below)
//   waitUntil — Pages Functions waitUntil (optional; falls back to await)
//   sendEmail — injected mailer: sendEmail(env, {from, fromName, to, replyTo,
//               subject, text, html}) -> {ok, ...}. NEVER sends in local dev:
//               the caller injects a stub. In prod, mehyar-web injects a
//               wrapper around sendCloudflareEmail.
//   payment   — billing_payments row {id, product_id, email, metadata_json}
//               metadata_json = checkout body.params FLAT:
//               {track, skills, hours_per_week, income_goal, experience_level, niche}
//
// Behavior:
//   1. Idempotent: exactly one hustlekit_orders row per payment.id
//      (UNIQUE constraint on payment_id). Replays return early.
//   2. Token unification: UPDATE billing_payments SET access_token=<redacted>
//      <order_token> so ONE token gates every HustleKit surface.
//   3. Background: POST HUSTLEKIT_BASE_URL/api/hustlekit/generate
//      {order_token, track, inputs}; on success mark ready + email the
//      token-gated deliverable link; on failure mark failed (buyer retries
//      from success.html?token=).
//
// Reliability note (2026-09-16): the background generate run takes ~150s of
// mostly-idle Workers AI latency. A single waitUntil() driving it is fragile:
// if the webhook isolate is evicted mid-run, the row is orphaned in
// 'generating' forever (no catch runs — the isolate is gone, not errored).
// So this module is the OPTIMISTIC fast path only. The backstop is
// functions/api/pay/fulfillment-sweep.js (GitHub cron every 5 min): it
// re-arms rows stuck in paid/generating past STUCK_MINUTES, re-drives
// generate (idempotent), and sends the buyer email exactly once via the
// email_sent_at claim below. The two paths are mutually safe: generate is
// idempotent on ready, and the email claim is atomic.

const nowSql = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

const TRACKS = {
  "ai-writing": "AI freelance writing",
  "ai-video": "AI video editing",
  "ai-social": "AI social-media management",
};

function randomToken(bytes = 32) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function hustlekitBaseUrl(env) {
  // NOTE 2026-09-16: hustlekit.mehyar.us is still provisioning on Cloudflare
  // (Pages custom-domain "pending" — does not resolve). Until it goes live,
  // hit the stable production Pages URL so generation + deliverable links
  // actually work. HUSTLEKIT_BASE_URL env overrides when set.
  return String(env.HUSTLEKIT_BASE_URL || "https://hustlekit.pages.dev").replace(/\/+$/, "");
}

export function hustlekitFromAddress(env) {
  // Until the hustlekit subdomain is onboarded on both ESPs (standing rule),
  // send from the proven mehyar.us identity.
  return {
    from: env.HUSTLEKIT_FROM_EMAIL || "team@mehyar.us",
    fromName: "HustleKit",
  };
}

// Shared buyer-email template. Used by the webhook fast path AND the sweep
// backstop so the buyer gets byte-identical mail whichever path wins.
export function buildHustlekitDeliverableEmail({ base, accessToken, track, fromName }) {
  const trackName = TRACKS[track] || track;
  const deliverUrl = `${base}/deliverable.html?token=${accessToken}`;
  const subject = `Your HustleKit playbook is ready`;
  const text =
    `Thanks for your purchase!\n\n` +
    `Your personalized ${trackName} playbook is ready:\n${deliverUrl}\n\n` +
    `Inside: your niche, your offer and pricing, where to find your first clients, word-for-word outreach scripts, and your 30-day action plan.\n\n` +
    `This link is personal to you — keep it somewhere safe. If it ever stops working, just reply to this email and we'll sort it out.\n\n-- ${fromName}`;
  const html =
    `<p>Thanks for your purchase!</p>` +
    `<p>Your personalized <strong>${trackName}</strong> playbook is ready:</p>` +
    `<p><a href="${deliverUrl}" style="display:inline-block;background:#65a30d;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;">Download your playbook</a></p>` +
    `<p style="color:#6b7280;font-size:13px;">Or copy this link:<br><a href="${deliverUrl}">${deliverUrl}</a></p>` +
    `<p style="color:#6b7280;font-size:13px;">Inside: your niche, your offer and pricing, where to find your first clients, word-for-word outreach scripts, and your 30-day action plan. This link is personal to you — keep it somewhere safe.</p>` +
    `<p>-- ${fromName}</p>`;
  return { subject, text, html, deliverUrl };
}

// Exactly-once email claim. The UPDATE is atomic: the first path to flip
// email_sent_at from NULL wins; losers see changes=0 and must not send.
export async function claimHustlekitEmailSent(db, orderId) {
  const r = await db
    .prepare(`UPDATE hustlekit_orders SET email_sent_at=${nowSql} WHERE id=? AND email_sent_at IS NULL`)
    .bind(orderId)
    .run()
    .catch(() => null);
  return r && r.meta && r.meta.changes > 0;
}

// NOTE (2026-09-16): the earlier resumeHustlekitOrder primitive was removed.
// Recovery is now: (1) generate.js checkpoints every part and resumes from
// the last checkpoint, so ANY driver can re-invoke it; (2) the scheduled
// fulfillment-sweep fire-and-forget dispatches generate for stuck rows and
// sends the buyer email exactly once for ready-but-unemailed rows;
// (3) fulfill-backfill's hustlekit branch dispatches the same way. No
// recovery path awaits a ~150s generate body (the edge would 524).
