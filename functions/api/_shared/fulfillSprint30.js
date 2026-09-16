// functions/api/_shared/fulfillSprint30.js
// Standalone ES module: Stripe fulfillment for fulfillment='sprint30' products.
// Called from the shared /api/pay/webhook in mehyar-web.
//
// Contract: fulfillSprint30({ db, env, waitUntil, sendEmail }, payment)
//   db        — D1 binding (shared mehyar-jobs DB; has sprint30_enrollments)
//   env       — worker env (needs SPRINT30_BASE_URL)
//   waitUntil — Pages Functions waitUntil (unused here; kept for contract parity)
//   sendEmail — injected mailer: sendEmail(env, {from, fromName, to, replyTo,
//               subject, text, html}) -> {ok, ...}. NEVER sends in local dev:
//               the caller injects a stub. In prod, mehyar-web injects a
//               wrapper around sendCloudflareEmail.
//   payment   — billing_payments row {id, product_id, email, metadata_json}
//
// Behavior:
//   1. Idempotent: exactly one sprint30_enrollments row per payment.id
//      (UNIQUE index idx_sprint30_enrollments_payment). Replays return early
//      with {replay:true} and send nothing.
//   2. Creates the enrollment (day 1 starts at purchase), unifies the token
//      (billing_payments.access_token := enrollment token) so the Stripe
//      success_url token gates the buyer dashboard too.
//   3. Sends the Day-1 challenge email IMMEDIATELY via sendEmail.
//      Days 2-30 are sent by the daily scheduler (VM cron → SMTP2GO/Brevo),
//      which is idempotent on sprint30_sends(enrollment_id, day_no).
//   4. Never throws: on email failure the enrollment is still created and
//      the day-1 send is left unrecorded so the daily scheduler retries it.

const nowSql = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

function randomToken(bytes = 32) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function baseUrl(env) {
  return String(env.SPRINT30_BASE_URL || "https://sprint30.mehyar.us").replace(/\/+$/, "");
}

function fromAddress(env) {
  // Until the sprint30 subdomain is onboarded on both ESPs (standing rule),
  // send from the proven mehyar.us identity.
  return {
    from: env.SPRINT30_FROM_EMAIL || "team@mehyar.us",
    fromName: "Sprint30",
  };
}

function dayOneEmail({ dashboardUrl, fromName, accessToken }) {
  const unsubUrl = `https://sprint30.mehyar.us/api/sprint30/unsubscribe?token=${accessToken}`;
  const subject = "Day 1 of 30: inventory every skill you have";
  const text =
    `Your Sprint30 starts today. 30 days, one mission a day, one goal: a real side-income stream built on skills you already have.\n\n` +
    `YOUR DASHBOARD (bookmark this — it's your mission control for the next 30 days):\n${dashboardUrl}\n\n` +
    `── DAY 1 MISSION: INVENTORY EVERY SKILL YOU HAVE ──\n\n` +
    `Open a blank doc and list 10 things people already ask you for help with — spreadsheets, cooking, resumes, car repairs, photo edits, anything. Star the three you could do for money without learning anything new. This list is your raw material; every day after today works off it.\n\n` +
    `Do this today: write down 10 skills and star 3.\n\n` +
    `REPLY TO THIS EMAIL with your answer to this: what's your #1 starred skill — and why is it obvious to you that people would pay for it? I read every reply — and tomorrow's mission builds directly on it.\n\n` +
    `Day 2 lands tomorrow morning: pick one lane, kill the rest.\n\n` +
    `-- ${fromName}\n` +
    `P.S. Your dashboard tracks all 30 days and your progress checklist: ${dashboardUrl}\n\n` +
    `Don't want these emails? Unsubscribe in one click: ${unsubUrl}`;
  const html =
    `<p>Your Sprint30 starts today. 30 days, one mission a day, one goal: a real side-income stream built on skills you already have.</p>` +
    `<p><a href="${dashboardUrl}" style="display:inline-block;background:#111827;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;">Open your dashboard</a></p>` +
    `<p style="color:#6b7280;font-size:13px;">Or copy this link:<br><a href="${dashboardUrl}">${dashboardUrl}</a></p>` +
    `<h2 style="font-size:20px;margin:24px 0 8px;">Day 1 mission: inventory every skill you have</h2>` +
    `<p>Open a blank doc and list <strong>10 things people already ask you for help with</strong> — spreadsheets, cooking, resumes, car repairs, photo edits, anything. Star the <strong>three you could do for money</strong> without learning anything new. This list is your raw material; every day after today works off it.</p>` +
    `<p><strong>Do this today:</strong> write down 10 skills and star 3.</p>` +
    `<p><strong>Reply to this email</strong> with your answer: what's your #1 starred skill — and why is it obvious to you that people would pay for it? Every reply gets read — and tomorrow's mission builds directly on it.</p>` +
    `<p>Day 2 lands tomorrow morning: pick one lane, kill the rest.</p>` +
    `<p>-- ${fromName}</p>` +
    `<p style="color:#9aa4b2;font-size:12px;">Don't want these emails? <a href="${unsubUrl}">Unsubscribe</a></p>`;
  return { subject, text, html, unsubUrl };
}

export async function fulfillSprint30({ db, env, waitUntil, sendEmail }, payment) {
  if (!db || !payment || !payment.id) throw new Error("fulfillSprint30: bad args");

  const productId = payment.product_id || "sprint30-challenge";

  // Belt and suspenders: the migration creates these, but the webhook must
  // never fail on a missing table.
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS sprint30_enrollments (" +
      "id INTEGER PRIMARY KEY AUTOINCREMENT, payment_id INTEGER NOT NULL, " +
      "product_id TEXT NOT NULL DEFAULT 'sprint30-challenge', email TEXT NOT NULL, " +
      "access_token TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', " +
      "started_at TEXT NOT NULL, current_day INTEGER NOT NULL DEFAULT 1, " +
      "progress_json TEXT NOT NULL DEFAULT '{}', " +
      "created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))"
  ).run();
  await db.prepare(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_sprint30_enrollments_payment ON sprint30_enrollments(payment_id)"
  ).run();
  await db.prepare(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_sprint30_enrollments_token ON sprint30_enrollments(access_token)"
  ).run();
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS sprint30_sends (" +
      "id INTEGER PRIMARY KEY AUTOINCREMENT, enrollment_id INTEGER NOT NULL, " +
      "day_no INTEGER NOT NULL, sent_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), " +
      "message_id TEXT, esp TEXT, UNIQUE(enrollment_id, day_no))"
  ).run();

  // ── idempotent enrollment create (one row per payment) ──
  const existing = await db
    .prepare("SELECT id, access_token, status FROM sprint30_enrollments WHERE payment_id = ?")
    .bind(payment.id)
    .first();
  if (existing) {
    return { ok: true, replay: true, enrollment_id: existing.id, status: existing.status };
  }

  // Reuse the checkout-time token: Stripe's success_url is rendered with
  // billing_payments.access_token at session creation, so the enrollment
  // MUST use that same token - minting a new one orphans the success
  // page dashboard link (bug found 2026-09-16 on payment 68).
  const accessToken = payment.access_token;
  if (!accessToken) throw new Error("fulfillSprint30: payment has no access_token");
  const ins = await db
    .prepare(
      `INSERT INTO sprint30_enrollments (payment_id, product_id, email, access_token, status, started_at, current_day) ` +
        `VALUES (?, ?, ?, ?, 'active', ${nowSql}, 1)`
    )
    .bind(payment.id, productId, payment.email, accessToken)
    .run();
  const enrollmentId = ins.meta.last_row_id;

  // Token is already unified: the enrollment reuses payment.access_token,
  // which is exactly what the Stripe success_url_template rendered.

  const { from, fromName } = fromAddress(env);
  const dashboardUrl = `${baseUrl(env)}/dashboard?token=${accessToken}`;

  // ── Day-1 email, sent immediately at fulfillment ──
  const { subject, text, html, unsubUrl } = dayOneEmail({ dashboardUrl, fromName, accessToken });
  let emailOk = false;
  try {
    const result = await sendEmail(env, {
      from,
      fromName,
      to: payment.email,
      replyTo: "info@mehyar.us",
      subject,
      text,
      html,
      headers: {
        "List-Unsubscribe": `<${unsubUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    emailOk = !!(result && result.ok);
    if (!emailOk) console.error("fulfillSprint30 day-1 email failed", productId, result && result.error);
  } catch (e) {
    console.error("fulfillSprint30 day-1 email threw", productId, e && e.message);
  }

  // Record the day-1 send ONLY if it actually went out — otherwise the daily
  // scheduler retries day 1 (idempotent on the UNIQUE index).
  if (emailOk) {
    try {
      await db
        .prepare("INSERT OR IGNORE INTO sprint30_sends (enrollment_id, day_no, esp) VALUES (?, 1, 'cloudflare-email')")
        .bind(enrollmentId)
        .run();
    } catch (e) {
      console.error("fulfillSprint30 day-1 send-record failed", e && e.message);
    }
  }

  return { ok: true, enrollment_id: enrollmentId, day: 1, email_ok: emailOk };
}
