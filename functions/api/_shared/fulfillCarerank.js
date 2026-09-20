// functions/api/_shared/fulfillCarerank.js
// Standalone ES module: Stripe fulfillment for fulfillment='carerank'
// products (CareRank — nursing-home shortlist reports, SKU carerank-shortlist).
// Called from the shared /api/pay/webhook in mehyar-web.
//
// Contract: fulfillCarerank({ db, env, waitUntil, sendEmail }, payment)
//   db        — D1 binding (shared mehyar_leads_prod; owns carerank_orders)
//   env       — worker env (CARERANK_UNSUB_SECRET; optional AI binding)
//   waitUntil — Pages Functions waitUntil (optional; falls back to await)
//   sendEmail — injected mailer: sendEmail(env, {from, fromName, to, replyTo,
//               subject, text, html, headers}) -> {ok, ...}. NEVER sends in
//               local dev: the caller injects a stub. In prod, mehyar-web
//               injects a wrapper around sendCloudflareEmail.
//   payment   — billing_payments row {id, product_id, email, metadata_json}.
//               metadata_json carries the quiz answers + the PWA's deterministic
//               CMS-data scoring: { quiz: {...}, top_facilities: [...] }.
//               Checkout stores body.params FLAT, so we also accept a wrapped
//               {inputs:{...}} shape (see checkout.js).
//
// Behavior:
//   1. Idempotent: exactly one carerank_orders row per payment.id (UNIQUE
//      index idx_carerank_orders_payment). Replays of a READY order return
//      {replay:true} with no second order and no second email. A replay of a
//      FAILED order retries generation instead.
//   2. Token unification: UPDATE billing_payments SET access_token=<order
//      token> so the token in success_url_template gates every buyer surface
//      (success page, /api/carerank/report).
//   3. Bullets: per-facility fit/watch-out bullets generated from the SUPPLIED
//      CMS facts only. Workers AI (env.AI) is used ONLY when bound, with a
//      strictly-grounded prompt ("write only from these facts, never invent
//      ratings"); AI errors fall back to deterministic template bullets.
//      Every deterministic bullet traces to a supplied fact — no invented
//      ratings, ever.
//   4. On generation failure: order marked 'failed', NO email is sent; the
//      buyer's success page polls /api/carerank/report and shows retry info.
//   5. On success: the buyer is emailed (from team@mehyar.us until
//      carerank.mehyar.us is onboarded on both ESPs — standing rule) the
//      token-gated report link + receipt, with a one-click unsubscribe link
//      in the footer and RFC 8058 List-Unsubscribe headers.

import {
  carerankUnsubSecret,
  carerankUnsubUrl,
  carerankListUnsubscribeHeaders,
} from "./carerankUnsub.js";

const nowSql = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

const PRODUCT_NAMES = {
  "carerank-shortlist": "CareRank Shortlist Report",
};

const BASE_URL = "https://carerank.mehyar.us";
const DATA_AS_OF_DEFAULT = "CMS provider data";

function randomToken(bytes = 32) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function safeParse(s) {
  try {
    return JSON.parse(s || "{}") || {};
  } catch {
    return {};
  }
}

function isNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}

// ── Deterministic bullet generation (facts only) ─────────────────────────
// Each bullet traces to a supplied fact. Rating semantics below are the CMS
// five-star definitions themselves (a 4–5 star rating IS above-average care
// by construction; 1–2 IS below the midpoint).

function deterministicBullets(fac) {
  const facts = (fac && fac.facts && typeof fac.facts === "object") ? fac.facts : {};
  const asOf = String(fac.data_as_of || DATA_AS_OF_DEFAULT);
  const zip = fac._quiz_zip ? ` near ${fac._quiz_zip}` : "";
  const fit = [];
  const watchout = [];

  const r = (k) => (isNum(facts[k]) ? Math.round(facts[k]) : null);

  const overall = r("overall_rating");
  if (overall != null) {
    if (overall >= 4) fit.push(`CMS overall rating of ${overall}/5 — a top-tier score in the federal five-star system (${asOf}).`);
    else if (overall === 3) fit.push(`CMS overall rating of 3/5 — a solid middle-of-the-road score (${asOf}).`);
    else watchout.push(`CMS overall rating is only ${overall}/5 — ask the admissions team what's changed since the last inspection (${asOf}).`);
  }

  const health = r("health_inspection_rating");
  if (health != null) {
    if (health >= 4) fit.push(`Health inspection rating of ${health}/5 — recent surveys found few or no serious deficiencies.`);
    else if (health <= 2) watchout.push(`Health inspection rating of ${health}/5 — read the actual CMS deficiency reports before you decide.`);
  }

  const staffing = r("staffing_rating");
  if (staffing != null) {
    if (staffing >= 4) fit.push(`Staffing rating of ${staffing}/5 — reported nursing hours per resident run above the expected level.`);
    else if (staffing <= 2) watchout.push(`Staffing rating of ${staffing}/5 — ask about current nurse-to-resident ratios when you tour.`);
  }

  const quality = r("quality_rating");
  if (quality != null) {
    if (quality >= 4) fit.push(`Quality measures rating of ${quality}/5 — clinical quality indicators score well.`);
    else if (quality <= 2) watchout.push(`Quality measures rating of ${quality}/5 — ask about their recent clinical quality scores.`);
  }

  const defN = facts.deficiency_count;
  if (isNum(defN)) {
    const n = Math.round(defN);
    if (n === 0) fit.push("Zero health deficiencies on the most recent CMS inspection cycle.");
    else if (n > 0) watchout.push(`${n} health inspection ${n === 1 ? "deficiency" : "deficiencies"} on record — read ${n === 1 ? "it" : "them"} before your visit.`);
  }

  const beds = facts.beds;
  if (isNum(beds)) {
    const b = Math.round(beds);
    if (b > 0 && b <= 60) fit.push(`Small facility (${b} beds) — can mean more personal attention from staff.`);
    else if (b >= 150) watchout.push(`${b} beds — a large facility; ask how units are organized so your loved one doesn't feel lost.`);
  }

  const dist = facts.distance_miles;
  if (isNum(dist)) {
    const d = Math.round(dist * 10) / 10;
    if (d <= 5) fit.push(`${d} miles${zip} — close enough for easy family visits.`);
    else if (d >= 15) watchout.push(`${d} miles away${zip} — factor visit logistics into your decision.`);
  }

  // Guards: every returned bullet must cite a supplied fact. If a facility
  // arrives with no usable facts at all, say so plainly rather than padding.
  if (fit.length === 0 && watchout.length === 0) {
    watchout.push("Limited CMS detail was available for this facility — call and ask for their latest state survey results.");
  }
  return { fit, watchout };
}

// ── Workers AI path (ONLY when env.AI is bound) ──────────────────────────
// Strictly grounded: the prompt forbids invention; failures fall back to the
// deterministic templates above (which never invent).

async function aiBullets(env, fac, quiz) {
  const model = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
  const factsJson = JSON.stringify(fac.facts || {});
  const prompt =
    "You write short factual bullets for a nursing-home shortlist report.\n" +
    "Write ONLY from the facts below. NEVER invent ratings, numbers, dates, " +
    "deficiencies, distances, or claims that are not in the facts. If a fact " +
    "is missing, say nothing about it — do not guess.\n" +
    "Return ONLY valid JSON, no other text: " +
    '{"fit":["..."],"watchout":["..."]} with 2-4 bullets per array, each under 140 characters.\n' +
    `FACILITY: ${String(fac.name || "").slice(0, 120)} (CCN ${String(fac.ccn || "").slice(0, 20)})\n` +
    `FACTS: ${factsJson}\n` +
    `CONTEXT: ${JSON.stringify({ zip: quiz && quiz.zip, care_type: quiz && quiz.care_type }).slice(0, 200)}`;
  const resp = await env.AI.run(model, {
    messages: [
      { role: "system", content: "You are a factual summarizer. You never invent data." },
      { role: "user", content: prompt },
    ],
    max_tokens: 700,
  });
  const text = String((resp && (resp.response || resp.result)) || "").trim();
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("ai_no_json");
  const parsed = JSON.parse(m[0]);
  const fit = Array.isArray(parsed.fit) ? parsed.fit.filter((b) => typeof b === "string").slice(0, 6) : [];
  const watchout = Array.isArray(parsed.watchout) ? parsed.watchout.filter((b) => typeof b === "string").slice(0, 6) : [];
  if (fit.length === 0 && watchout.length === 0) throw new Error("ai_empty");
  return { fit, watchout };
}

async function buildBullets(env, facilities, quiz) {
  const out = [];
  for (const fac of facilities) {
    let bullets;
    if (env && env.AI) {
      try {
        bullets = await aiBullets(env, fac, quiz);
      } catch (e) {
        console.error("fulfillCarerank AI bullets failed, falling back to templates", e && e.message);
        bullets = deterministicBullets(fac);
      }
    } else {
      bullets = deterministicBullets(fac);
    }
    out.push({ ccn: String(fac.ccn || ""), name: String(fac.name || ""), fit: bullets.fit, watchout: bullets.watchout });
  }
  return out;
}

function readIntake(payment) {
  const meta = safeParse(payment.metadata_json);
  // NOTE: the centralized /api/pay/checkout stores body.params FLAT as
  // metadata_json. Accept both the flat shape and a wrapped {inputs:{...}} shape.
  const intake = (meta && typeof meta === "object" && meta.inputs && typeof meta.inputs === "object") ? meta.inputs : meta;
  const params = (intake.params && typeof intake.params === "object") ? intake.params : {};
  const facilities = intake.top_facilities || intake.facilities || [];
  return { quizRaw: params.quiz !== undefined ? params.quiz : (intake.quiz !== undefined ? intake.quiz : null),
           facilities: Array.isArray(facilities) ? facilities : [] };
}

// Compact quiz encoding sent by the PWA (see web/assets/app.js compactQuiz):
// { z, p:[staffing,quality,inspection], n:"dryvb", d:maxDistanceMiles, m:minOverall }
const NEED_LETTERS = { d: "dementia", r: "rehab", v: "ventilator", b: "bariatric", y: "dialysis" };

function expandCompactQuiz(c) {
  const needs = {};
  for (const L of String((c && c.n) || "")) if (NEED_LETTERS[L]) needs[NEED_LETTERS[L]] = true;
  const p = (c && Array.isArray(c.p)) ? c.p : [];
  return {
    zip: c && c.z != null ? String(c.z) : "",
    priorities: {
      staffing: Number(p[0]) || 0,
      quality: Number(p[1]) || 0,
      inspection: Number(p[2]) || 0,
    },
    needs,
    maxDistanceMiles: Number(c && c.d) || 25,
    minOverall: Number(c && c.m) || 0,
  };
}

// The PWA sends ONLY the compact quiz in checkout params (<=2KB limit) — never
// the facility list. So the webhook scores deterministically server-side from
// the bundled CMS data (carerankData.js, lazy import). If a future client sends
// top_facilities, we still honor it.
async function resolveFacilities(quizRaw, legacyFacilities) {
  const usable = (legacyFacilities || []).filter((f) => f && (f.ccn || f.name));
  if (usable.length > 0) {
    return usable.map((f) => ({
      ccn: String(f.ccn || ""),
      name: String(f.name || ""),
      score: isNum(f.score) ? Math.round(f.score) : null,
      distance_miles: isNum(f.distance_miles) ? f.distance_miles : null,
      data_as_of: f.data_as_of || null,
      city: f.city || null,
      state: f.state || null,
      zip: f.zip || null,
      phone: f.phone || null,
      facts: (f.facts && typeof f.facts === "object") ? f.facts : {},
    }));
  }
  let quiz = quizRaw;
  if (typeof quiz === "string") quiz = safeParse(quiz);
  if (!quiz || typeof quiz !== "object") throw new Error("no_quiz_in_intake");
  const answers = (quiz.z !== undefined) ? expandCompactQuiz(quiz) : quiz;
  if (!answers.zip) throw new Error("no_quiz_in_intake");
  const { rankTop } = await import("./carerankData.js");
  const top = rankTop(answers, 10);
  if (!top.length) throw new Error("no_matches_for_quiz");
  return top.map((t) => ({
    ccn: t.ccn,
    name: t.name,
    score: t.score,
    distance_miles: t.distance_miles,
    data_as_of: t.data_as_of,
    city: t.city || null,
    state: t.state || null,
    zip: t.zip || null,
    phone: t.phone || null,
    facts: t.facts || {},
  }));
}

function fromAddress() {
  // Until carerank.mehyar.us is onboarded on both ESPs (standing rule),
  // send from the proven mehyar.us identity.
  return { from: "team@mehyar.us", fromName: "CareRank" };
}

async function ensureSchema(db) {
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS carerank_orders (" +
    "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
    "payment_id INTEGER NOT NULL, " +
    "product_id TEXT NOT NULL, " +
    "email TEXT NOT NULL, " +
    "quiz_json TEXT, " +
    "output_json TEXT, " +
    "status TEXT NOT NULL DEFAULT 'pending', " +
    "access_token TEXT, " +
    "failure_reason TEXT, " +
    "created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), " +
    "ready_at TEXT)"
  ).run();
  await db.prepare(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_carerank_orders_payment ON carerank_orders(payment_id)"
  ).run();
}

export async function fulfillCarerank({ db, env, waitUntil, sendEmail }, payment) {
  if (!db || !payment || !payment.id) throw new Error("fulfillCarerank: bad args");
  await ensureSchema(db);

  const productId = payment.product_id || "carerank-shortlist";
  const productName = PRODUCT_NAMES[productId] || productId;

  // ── idempotent order create (one row per payment) ──
  let order = await db
    .prepare("SELECT id, access_token, status, email FROM carerank_orders WHERE payment_id = ?")
    .bind(payment.id)
    .first();

  if (order && order.status === "ready") {
    // Replay of a delivered order: nothing more to do.
    return { ok: true, replay: true, order_id: order.id, status: order.status };
  }
  if (order && (order.status === "pending" || order.status === "paid" || order.status === "generating")) {
    // A generation is already in flight (concurrent duplicate delivery).
    return { ok: true, replay: true, order_id: order.id, status: order.status };
  }

  let orderId;
  let accessToken;
  if (!order) {
    accessToken = randomToken(32);
    const { quizRaw } = readIntake(payment);
    const quizForRow = typeof quizRaw === "string" ? safeParse(quizRaw) : (quizRaw || {});
    try {
      const ins = await db
        .prepare(
          "INSERT INTO carerank_orders (payment_id, product_id, email, quiz_json, status, access_token) " +
          "VALUES (?, ?, ?, ?, 'pending', ?)"
        )
        .bind(payment.id, productId, payment.email, JSON.stringify(quizForRow), accessToken)
        .run();
      orderId = ins && ins.meta && ins.meta.last_row_id;
    } catch (e) {
      // Race: a concurrent delivery inserted first. Treat as replay.
      if (/UNIQUE/i.test(String((e && e.message) || e))) {
        const winner = await db
          .prepare("SELECT id, access_token, status FROM carerank_orders WHERE payment_id = ?")
          .bind(payment.id)
          .first();
        return { ok: true, replay: true, order_id: winner && winner.id, status: winner && winner.status };
      }
      throw e;
    }
  } else {
    // Failed order being retried: reuse its row + token.
    orderId = order.id;
    accessToken = order.access_token;
  }

  // Token unification: success_url_template receives billing_payments.access_token,
  // and every CareRank surface gates on the order token. ONE token everywhere.
  await db
    .prepare("UPDATE billing_payments SET access_token = ? WHERE id = ?")
    .bind(accessToken, payment.id)
    .run();

  const { from, fromName } = fromAddress();

  const run = async () => {
    try {
      await db.prepare("UPDATE carerank_orders SET status='generating' WHERE id=?").bind(orderId).run();
      const { quizRaw, facilities: legacyFacilities } = readIntake(payment);
      let quiz = quizRaw; if (typeof quiz === "string") quiz = safeParse(quiz);
      if (!quiz || typeof quiz !== "object") quiz = {};
      if (quiz.z !== undefined) quiz = expandCompactQuiz(quiz); // compact -> answers
      const facilities = await resolveFacilities(quizRaw, legacyFacilities);
      const usable = facilities.filter((f) => f && (f.ccn || f.name));
      if (usable.length === 0) {
        throw new Error("no_facilities_in_intake");
      }
      // Stamp quiz zip onto each facility for distance phrasing.
      const zip = quiz && (quiz.zip || quiz.zipcode);
      const stamped = usable.map((f) => (zip ? { ...f, _quiz_zip: String(zip).slice(0, 10) } : f));
      const bullets = await buildBullets(env, stamped.slice(0, 10), quiz);

      const dataAsOf = String(
        (stamped[0] && stamped[0].data_as_of) || DATA_AS_OF_DEFAULT
      );
      const output = {
        data_as_of: dataAsOf,
        facilities: stamped.map((f, i) => ({
          ccn: String(f.ccn || ""),
          name: String(f.name || ""),
          score: isNum(f.score) ? Math.round(f.score) : null,
          city: f.city || null,
          state: f.state || null,
          zip: f.zip || null,
          phone: f.phone || null,
          distance_miles: isNum(f.distance_miles) ? f.distance_miles : null,
          facts: f.facts && typeof f.facts === "object" ? f.facts : {},
          fit: bullets[i].fit,
          watchout: bullets[i].watchout,
        })),
      };
      await db
        .prepare(`UPDATE carerank_orders SET status='ready', output_json=?, ready_at=${nowSql} WHERE id=?`)
        .bind(JSON.stringify(output), orderId)
        .run();

      const reportUrl = `${BASE_URL}/success.html?token=${accessToken}`;
      const apiUrl = `https://mehyar.us/api/carerank/report?token=${accessToken}`;
      const unsubUrl = await carerankUnsubUrl(env, payment.email);
      if (!unsubUrl) console.error("fulfillCarerank: CARERANK_UNSUB_SECRET missing — email sent without one-click link");
      const receipt = `$${((payment.amount_cents || 2900) / 100).toFixed(2)}`;
      const subject = `Your ${productName} is ready`;
      const text =
        `Thanks for your purchase!\n\n` +
        `Your ${productName} (${receipt}) is ready. Your personalized shortlist of top nursing homes${zip ? " near " + zip : ""}:\n${reportUrl}\n\n` +
        `Each home comes with a fit score plus exactly what to look for — and what to watch out for — based on federal CMS data.\n\n` +
        `This link is personal to you — keep it somewhere safe. If it ever stops working, just reply to this email and we'll sort it out.\n\n` +
        `-- CareRank\n\n` +
        `---\nDon't want CareRank emails? Unsubscribe in one click: ${unsubUrl || "reply STOP"}`;
      const html =
        `<p>Thanks for your purchase!</p>` +
        `<p>Your <strong>${productName}</strong> (${receipt}) is ready. Your personalized shortlist of top nursing homes${zip ? " near " + String(zip).slice(0, 10) : ""}:</p>` +
        `<p><a href="${reportUrl}" style="display:inline-block;background:#0e7c61;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;">View your shortlist report</a></p>` +
        `<p style="color:#6b7280;font-size:13px;">Or copy this link:<br><a href="${reportUrl}">${reportUrl}</a></p>` +
        `<p style="color:#6b7280;font-size:13px;">Each home comes with a fit score plus exactly what to look for — and what to watch out for — based on federal CMS data. This link is personal to you — keep it somewhere safe. If it ever stops working, just reply to this email and we'll sort it out.</p>` +
        `<p>-- CareRank</p>` +
        `<hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">` +
        `<p style="color:#9ca3af;font-size:12px;">Don't want CareRank emails? ` +
        (unsubUrl ? `<a href="${unsubUrl}">Unsubscribe in one click</a>.` : `Reply STOP and we'll remove you.`) + `</p>`;
      const result = await sendEmail(env, {
        from,
        fromName,
        to: payment.email,
        replyTo: "info@mehyar.us",
        subject,
        text,
        html,
        headers: carerankListUnsubscribeHeaders(unsubUrl),
      });
      if (!result.ok) console.error("fulfillCarerank deliverable email failed", productId, result.error);
      return { emailed: !!result.ok };
    } catch (e) {
      // Generation failure: mark failed, do NOT email. The buyer's success
      // page polls /api/carerank/report, sees status=failed, and shows retry
      // info (a Stripe redelivery re-runs generation; ready orders replay).
      console.error("fulfillCarerank generation failed", productId, e && e.message);
      try {
        await db
          .prepare("UPDATE carerank_orders SET status='failed', failure_reason=? WHERE id=?")
          .bind(String((e && e.message) || e).slice(0, 200), orderId)
          .run();
      } catch {}
    }
  };

  if (typeof waitUntil === "function") waitUntil(run());
  else await run();

  return { ok: true, order_id: orderId, token: accessToken };
}
