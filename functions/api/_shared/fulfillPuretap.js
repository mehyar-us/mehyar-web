// functions/api/_shared/fulfillPuretap.js
// Stripe fulfillment for fulfillment='puretap' products:
//   puretap-report ($19 one-time) — full decoded EPA water report.
//
// Contract: fulfillPuretap({ db, env, waitUntil, sendEmail }, payment, sess)
//   db        — D1 binding (shared mehyar-jobs DB; puretap_* tables)
//   env       — worker env (PURETAP_BASE_URL optional, defaults to the
//               production PureTap site)
//   waitUntil — Pages Functions waitUntil (optional; falls back to await)
//   sendEmail — injected mailer: sendEmail(env, {from, fromName, to, replyTo,
//               subject, text, html}) -> {ok, ...}. NEVER sends in local dev.
//   payment   — billing_payments row {id, product_id, email, metadata_json}
//   sess      — Stripe checkout session object (unused; one-time product)
//
// Behavior:
//   1. Idempotent: exactly one puretap_orders row per payment.id (UNIQUE on
//      payment_id). Replays return {replay:true} and do nothing (no second
//      generation, no second email).
//   2. The buyer is recorded in puretap_subscribers (brand list) AND
//      subscribers_global (brand='puretap'). A suppressed address can still
//      buy and receive its PAID report (transactional), but stays on the
//      do-not-mail list for marketing.
//   3. Report generation runs on the PureTap site itself
//      (POST {PURETAP_BASE_URL}/api/report/generate {order_token}); the
//      generate endpoint re-reads the shared order row (same LEADS_DB), so no
//      cross-service secret is needed. Order marked 'ready' only on success.
//   4. The buyer is emailed the token-gated report link with a one-click
//      unsubscribe URL. On generation failure the order is marked 'failed'
//      and NO email goes out (buyer retries from success.html polling).
//   5. Never throws out of the hook.

const nowSql = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

function randomToken(bytes = 32) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function baseUrl(env) {
  return String(env.PURETAP_BASE_URL || "https://puretap.mehyar.us").replace(/\/+$/, "");
}

function fromAddress(env) {
  // Until puretap.mehyar.us is onboarded on BOTH ESPs (standing rule),
  // send from the proven mehyar.us identity.
  return { from: env.PURETAP_FROM_EMAIL || "team@mehyar.us", fromName: "PureTap" };
}

async function ensureTables(db) {
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS puretap_orders (id INTEGER PRIMARY KEY AUTOINCREMENT, payment_id INTEGER NOT NULL, " +
      "product_id TEXT NOT NULL, email TEXT NOT NULL, inputs_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'paid', " +
      "access_token TEXT NOT NULL, ready_at TEXT, created_at TEXT NOT NULL DEFAULT (" + nowSql + "))"
  ).run();
  await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_puretap_orders_payment ON puretap_orders(payment_id)").run();
  await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_puretap_orders_token ON puretap_orders(access_token)").run();
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS puretap_subscribers (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, " +
      "zip TEXT, pwsid TEXT, source TEXT NOT NULL DEFAULT 'free-verdict', status TEXT NOT NULL DEFAULT 'active', " +
      "created_at TEXT NOT NULL DEFAULT (" + nowSql + "))"
  ).run();
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS puretap_suppressions (email TEXT PRIMARY KEY, reason TEXT NOT NULL DEFAULT 'one-click', " +
      "source TEXT NOT NULL DEFAULT 'api', created_at TEXT NOT NULL DEFAULT (" + nowSql + "))"
  ).run();
}

function readInputs(meta) {
  const m = (meta && typeof meta === "object") ? meta : {};
  const inner = (m.inputs && typeof m.inputs === "object") ? m.inputs : {};
  const flat = { ...inner, ...m };
  delete flat.inputs;
  const zip = String(flat.zip || "").trim();
  const pwsid = String(flat.pwsid || "").trim();
  return { zip: /^\d{5}$/.test(zip) ? zip : null, pwsid: pwsid || null };
}

async function isSuppressed(db, email) {
  try {
    const r = await db.prepare("SELECT email FROM puretap_suppressions WHERE email = ?").bind(email).first();
    return !!r;
  } catch { return false; }
}

async function recordSubscriber(db, email, inputs, source) {
  try {
    await db.prepare(
      "INSERT INTO puretap_subscribers (email, zip, pwsid, source, status) VALUES (?, ?, ?, ?, 'active') " +
        "ON CONFLICT(email) DO UPDATE SET zip=COALESCE(excluded.zip, puretap_subscribers.zip), " +
        "pwsid=COALESCE(excluded.pwsid, puretap_subscribers.pwsid), status='active'"
    ).bind(email, inputs.zip, inputs.pwsid, source).run();
  } catch (e) { console.error("fulfillPuretap puretap_subscribers upsert failed", e && e.message); }
  try {
    await db.prepare(
      "INSERT INTO subscribers_global (email, brand, status, unsubscribed) VALUES (?, 'puretap', 'active', 0) " +
        "ON CONFLICT(email, brand) DO UPDATE SET unsubscribed=0, updated_at=" + nowSql
    ).bind(email).run();
  } catch (e) { console.error("fulfillPuretap subscribers_global upsert failed", e && e.message); }
}

async function emailReportReady(sendEmail, env, to, reportUrl, pdfUrl, unsubUrl, suppressed) {
  const { from, fromName } = fromAddress(env);
  const subject = "Your PureTap decoded report is ready \uD83D\uDCA7";
  const text =
    "Thanks for your purchase!\n\n" +
    "Your full decoded water report is ready:\n" + reportUrl + "\n\n" +
    "Prefer a file? Print-optimized page (use your browser's Print \u2192 Save as PDF):\n" + pdfUrl + "\n\n" +
    "This link is personal to you \u2014 keep it somewhere safe.\n\n" +
    "PureTap decodes U.S. EPA public drinking-water records. Informational only \u2014 not medical or legal advice.\n\n" +
    "-- " + fromName + "\n\n" +
    "No longer want PureTap emails? Unsubscribe in one click (your paid report link keeps working):\n" + unsubUrl + "\n";
  const html =
    "<p>Thanks for your purchase!</p>" +
    "<p><a href=\"" + reportUrl + "\" style=\"display:inline-block;background:#1e9eed;color:#fff;padding:14px 30px;border-radius:10px;text-decoration:none;font-weight:bold;\">\uD83D\uDCA7 Read my decoded report</a></p>" +
    "<p style=\"color:#6b7280;font-size:13px;\">Or copy this link:<br><a href=\"" + reportUrl + "\">" + reportUrl + "</a></p>" +
    "<p style=\"color:#6b7280;font-size:13px;\">Prefer a file? <a href=\"" + pdfUrl + "\">Print-optimized page</a> \u2014 use your browser's Print \u2192 Save as PDF.</p>" +
    "<p style=\"color:#6b7280;font-size:13px;\">This link is personal to you \u2014 keep it somewhere safe.</p>" +
    "<p style=\"color:#6b7280;font-size:12px;\">PureTap decodes U.S. EPA public drinking-water records. Informational only \u2014 not medical or legal advice.</p>" +
    "<p style=\"color:#9aa7b8;font-size:12px;\">No longer want PureTap emails? <a href=\"" + unsubUrl + "\">Unsubscribe in one click</a> (your paid report link keeps working).</p>" +
    "<p>-- " + fromName + "</p>";
  return sendEmail(env, { from, fromName, to, replyTo: "info@mehyar.us", subject, text, html });
}

// ── Main entry ─────────────────────────────────────────────────────────
export async function fulfillPuretap({ db, env, waitUntil, sendEmail }, payment, sess) {
  try {
    if (!db || !payment || !payment.id) throw new Error("fulfillPuretap: bad args");
    await ensureTables(db);

    let meta = {};
    try { meta = JSON.parse(payment.metadata_json || "{}"); } catch {}
    const inputs = readInputs(meta);
    const email = String(payment.email || "").toLowerCase().trim();

    // Idempotent order row (one per payment).
    const existing = await db.prepare(
      "SELECT id, access_token, status FROM puretap_orders WHERE payment_id = ?"
    ).bind(payment.id).first();
    if (existing) return { ok: true, replay: true, order_id: existing.id, status: existing.status };

    const accessToken = randomToken(32);
    const ins = await db.prepare(
      "INSERT INTO puretap_orders (payment_id, product_id, email, inputs_json, status, access_token, created_at) " +
      "VALUES (?, ?, ?, ?, 'paid', ?, " + nowSql + ")"
    ).bind(payment.id, payment.product_id, email, JSON.stringify(inputs)).run();
    const orderId = ins.meta.last_row_id;

    // Token unification: every PureTap surface gates on the order token.
    await db.prepare("UPDATE billing_payments SET access_token = ? WHERE id = ?")
      .bind(accessToken, payment.id).run();

    await recordSubscriber(db, email, inputs, "paid-checkout");
    const suppressed = await isSuppressed(db, email);

    // Generate on the PureTap site (it owns the EPA/AI pipeline and the
    // token-gated serving endpoints). Same shared LEADS_DB, so the generate
    // endpoint authenticates by reading this very order row.
    const run = async () => {
      const genUrl = baseUrl(env) + "/api/report/generate";
      try {
        const res = await fetch(genUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ order_token: accessToken }),
          signal: AbortSignal.timeout(240000),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error("generate:" + (data.error || res.status));
        await db.prepare(
          "UPDATE puretap_orders SET status='ready', ready_at=" + nowSql + " WHERE id=? AND status != 'ready'"
        ).bind(orderId).run();
        // Transactional delivery email (the buyer's paid goods). The
        // one-click unsubscribe covers marketing; the report link always works.
        const result = await emailReportReady(
          sendEmail, env, email, data.report_url, data.pdf_url, data.unsubscribe_url, suppressed
        );
        if (!result.ok) console.error("fulfillPuretap report email failed", payment.product_id, result.error);
        return { ok: true, email_ok: !!result.ok };
      } catch (e) {
        console.error("fulfillPuretap background generate failed", payment.product_id, e && e.message);
        try {
          await db.prepare("UPDATE puretap_orders SET status='failed' WHERE id=? AND status IN ('paid','generating')")
            .bind(orderId).run();
        } catch {}
        // No email on failure: buyer lands on success.html?token= from
        // Stripe; the page polls status and shows a retry path.
        return { ok: false, error: String((e && e.message) || e).slice(0, 120) };
      }
    };
    if (typeof waitUntil === "function") waitUntil(run());
    else await run();

    return { ok: true, order_id: orderId, mode: "report" };
  } catch (e) {
    // Never throw out of the hook — the webhook catches, but a throw risks a 500.
    console.error("fulfillPuretap failed", e && e.message);
    return { ok: false, error: String((e && e.message) || e).slice(0, 120) };
  }
}
