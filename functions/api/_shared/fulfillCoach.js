// functions/api/_shared/fulfillCoach.js
// Fulfillment for Coach (coach.mehyar.us): AI job-search copilot.
//   coach-pro  $19/mo subscription — unlimited resume tailoring (full
//   output + cover letter) and unlimited STAR practice with model answers.
//
// Contract: fulfillCoach({ db, env, waitUntil, sendEmail }, payment)
//   payment.metadata_json is FLAT body.params from the centralized
//   checkout: { session_token } — the free session created by the tailor.
//
// Behavior:
//   1. Idempotent on payment.id: coach_sessions.payment_id records the
//      fulfilling payment; a replay with the same payment already recorded
//      returns {replay:true} and sends no second email.
//   2. Tokens: billing_payments.access_token stays the original checkout
//      token, so the {access_token} in the Stripe success URL (and
//      /api/pay/status) keeps working. The Coach worker unifies tokens:
//      GET /api/session/:token accepts the session token OR the billing
//      access_token (resolved via metadata_json.session_token). The
//      welcome email below carries the session token.
//   3. Emails the buyer their personal Pro link (transactional; sender is
//      the proven team@mehyar.us identity). Never throws out of the hook.

function baseUrl(env) {
  return String(env.COACH_BASE_URL || "https://coach.mehyar.us").replace(/\/+$/, "");
}

export async function fulfillCoach({ db, env, waitUntil, sendEmail }, payment) {
  if (!db || !payment || !payment.id) throw new Error("fulfillCoach: bad args");
  if (payment.product_id !== "coach-pro") throw new Error("fulfillCoach: wrong product " + payment.product_id);

  let meta = {};
  try { meta = JSON.parse(payment.metadata_json || "{}"); } catch {}
  const flat = (meta && typeof meta === "object" && meta.inputs) || meta || {};
  const sessionToken = String(flat.session_token || flat.sessionToken || "").slice(0, 64);
  const buyerEmail = String(payment.email || "").trim().toLowerCase();
  if (!sessionToken) {
    console.error("fulfillCoach: no session_token in metadata for payment", payment.id);
    return { ok: false, error: "missing_session_token" };
  }

  const session = await db
    .prepare("SELECT token, status, payment_id, email FROM coach_sessions WHERE token = ?")
    .bind(sessionToken)
    .first();
  if (!session) {
    console.error("fulfillCoach: unknown session token for payment", payment.id);
    return { ok: false, error: "unknown_session" };
  }

  // Idempotency: this exact payment already fulfilled.
  if (session.payment_id === payment.id && session.status === "pro") {
    return { ok: true, replay: true, token: sessionToken };
  }

  await db
    .prepare(
      "UPDATE coach_sessions SET status='pro', payment_id=?, " +
      "email=COALESCE(?, email), updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE token = ?"
    )
    .bind(payment.id, buyerEmail || null, sessionToken)
    .run();

  // NOTE: billing_payments.access_token is deliberately NOT overwritten.
  // It stays the original checkout token (the one in the buyer's Stripe
  // success URL and /api/pay/status). Token unification lives in the
  // Coach worker: GET /api/session/:token resolves a billing access_token
  // via this payment's metadata_json.session_token. The welcome email
  // below links the session token directly.

  if (buyerEmail && typeof sendEmail === "function") {
    const run = async () => {
      try {
        const link = `${baseUrl(env)}/success?token=${sessionToken}`;
        const subject = "Your Coach Pro is active — your resume unlock is ready";
        const text =
          `Welcome to Coach Pro!\n\n` +
          `Your subscription is active for ${buyerEmail}. Your tailored resume is now fully unlocked — ` +
          `the complete bullet set, cover letter drafts, and unlimited STAR interview practice with model answers.\n\n` +
          `Your personal Pro link (keep it — it's your key back in):\n${link}\n\n` +
          `Manage or cancel anytime: open Coach, scroll to Pricing, and use the Stripe portal button — no emails, no retention maze.\n\n` +
          `Reminder: every Coach draft is AI-generated. Review each line and make it true before you send it — never submit experience you don't have.\n\n` +
          `Mehyar Soft LLC · info@mehyar.us`;
        const html =
          `<p>Welcome to <strong>Coach Pro</strong>!</p>` +
          `<p>Your subscription is active for <strong>${buyerEmail}</strong>. Your tailored resume is fully unlocked — the complete bullet set, cover letter drafts, and unlimited STAR interview practice with model answers.</p>` +
          `<p><a href="${link}" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:bold;">Open my Coach Pro</a></p>` +
          `<p style="color:#6b7280;font-size:13px;">Keep this link — it's your key back in:<br><a href="${link}">${link}</a></p>` +
          `<p style="color:#6b7280;font-size:13px;">Manage or cancel anytime from the Pricing section on coach.mehyar.us (Stripe portal). Every Coach draft is AI-generated — review each line and make it true before you send it.</p>` +
          `<p>-- Coach, Mehyar Soft LLC</p>`;
        const result = await sendEmail(env, { from: "team@mehyar.us", fromName: "Coach", to: payment.email, replyTo: "info@mehyar.us", subject, text, html });
        if (!result.ok) console.error("fulfillCoach welcome email failed", result.error);
      } catch (e) {
        console.error("fulfillCoach welcome email threw", e && e.message);
      }
    };
    if (typeof waitUntil === "function") waitUntil(run()); else await run();
  }

  return { ok: true, token: sessionToken, mode: "subscription" };
}
