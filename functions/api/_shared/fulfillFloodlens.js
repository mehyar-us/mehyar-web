// functions/api/_shared/fulfillFloodlens.js
// Standalone ES module: Stripe fulfillment for fulfillment='floodlens'.
// SKUs: floodlens-report ($19 one-time → one 10-page PDF report),
//       floodlens-3pack ($39 one-time → one combined 30-page PDF, 10 pages per property).
//
// Contract: fulfillFloodlens({ db, env, waitUntil, sendEmail }, payment)
//   payment — billing_payments row (already marked paid by the webhook).
//           metadata_json = checkout params FLAT: { lookup_token } for the
//           single SKU, { lookup_tokens: "t1,t2,t3" } (or array) for 3-pack.
//
// Behavior:
//   1. Idempotent: exactly one floodlens_orders row per payment.id
//      (UNIQUE payment_id). Replays return {replay:true} and do nothing.
//   2. Creates the order, unifies billing_payments.access_token onto the
//      order token so ONE token gates every buyer surface.
//   3. Background (waitUntil): EXACTLY ONE Workers AI call narrates the
//      report from supplied facts (deterministic tables do the rest),
//      renders the fixed-layout PDF with the dependency-free builder
//      (10 pages per property: 10 for single, 30 for the 3-pack), stores it
//      in the FLOODLENS_REPORTS R2 bucket, marks the order ready, marks the
//      subscriber converted (stops the drip), and emails the buyer the
//      receipt + token-gated download link (with one-click unsubscribe).
//      The receipt email is skipped if the buyer is suppressed (the order
//      itself is still fulfilled; the download link is on the success page).
//   4. On generation failure: mark failed, do NOT email — the buyer's
//      success page polls /api/pay/status and shows live status + retry.
//   5. NEVER throws out of the hook.

import { sendCloudflareEmail } from "./cloudflareEmail.js";
import { chatJson, safeJsonParse } from "./llmChat.js";
import { buildFloodReport } from "./floodlensPdf.js";
import { randomToken, PREMIUM_BANDS, PREMIUM_FOOTNOTE, isFloodlensSuppressed } from "./floodlensCore.js";

const nowSql = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

const PRODUCT_NAMES = {
  "floodlens-report": "FloodLens Flood Zone Report",
  "floodlens-3pack": "FloodLens 3-Property Pack",
};

function fromAddress(env) {
  // Until floodlens.mehyar.us is onboarded on both ESPs (standing rule),
  // send from the proven mehyar.us identity.
  return { from: env.FLOODLENS_FROM_EMAIL || "team@mehyar.us", fromName: "FloodLens" };
}

function toTokenList(v) {
  if (Array.isArray(v)) return v.map(String).filter((t) => t.length >= 16).slice(0, 3);
  if (typeof v === "string") {
    return v.split(/[,\s]+/).map((s) => s.trim()).filter((t) => t.length >= 16).slice(0, 3);
  }
  return [];
}

async function loadLookups(db, tokens) {
  const rows = [];
  for (const t of tokens) {
    // zone IS NOT NULL: failed-attempt rows (rate-limiting sentinels) can
    // never become a purchased report.
    const row = await db
      .prepare("SELECT * FROM floodlens_lookups WHERE token = ? AND zone IS NOT NULL")
      .bind(t)
      .first();
    if (row) rows.push(row);
  }
  return rows;
}

function propFromLookup(row) {
  const band = PREMIUM_BANDS[row.band];
  return {
    address: row.address,
    matched: row.normalized,
    zone: row.zone,
    zone_subtype: row.zone_subtype,
    sfha: Number(row.sfha) === 1,
    risk: row.risk,
    risk_plain: row.risk_plain,
    band: row.band,
    premium_label: band ? band.label : null,
    premium_footnote: PREMIUM_FOOTNOTE,
    bfe: row.bfe,
    depth: null,
    dfirm_id: row.dfirm_id,
    firm_pan: row.firm_pan,
    map_effective: row.data_as_of,
    narration: null,
  };
}

// EXACTLY ONE Workers AI call per report: narrate from supplied facts.
async function narrateReport(env, props) {
  const facts = props
    .map((p, i) =>
      `Property ${i + 1}: ${p.address} | FEMA Zone ${p.zone} | ${p.risk_plain} | ` +
      `SFHA: ${p.sfha ? "yes" : "no"} | Typical NFIP cost: ${p.premium_label || "n/a (no zone pricing)"} | ` +
      `Map effective: ${p.map_effective || "unknown"}${p.bfe != null ? ` | BFE: ${p.bfe} ft` : ""}`
    )
    .join("\n");
  const prompt =
    `You write the "What this means for you" section of a FloodLens flood-zone report. ` +
    `Facts (do NOT invent anything beyond these):\n${facts}\n\n` +
    `Write one short plain-English paragraph per property (120-180 words each), second person, ` +
    `practical homebuyer tone: what the zone implies for insurance cost and lender requirements, ` +
    `one concrete next step. No quotes, no disclaimers, no markdown. ` +
    `Respond as JSON: {"narrations": ["para 1", "para 2", ...]} in the same property order.`;
  try {
    const r = await chatJson({
      env,
      messages: [
        { role: "system", content: "You write concise, practical homebuyer guidance. JSON only." },
        { role: "user", content: prompt },
      ],
      max_tokens: 900,
      temperature: 0.4,
      json_mode: true,
      timeout_ms: 45000,
    });
    if (!r.used_llm || !r.content) return null;
    const parsed = safeJsonParse(r.content, null);
    const narrs = parsed && Array.isArray(parsed.narrations) ? parsed.narrations : null;
    if (!narrs || narrs.length === 0) return null;
    return props.map((_, i) => String(narrs[Math.min(i, narrs.length - 1)] || "").slice(0, 1500) || null);
  } catch {
    return null;
  }
}

async function emailReceipt(env, sendEmail, payment, productName, orderToken, subToken) {
  const { from, fromName } = fromAddress(env);
  const downloadUrl = `https://mehyar.us/api/floodlens/download?token=${orderToken}`;
  const unsubUrl = `https://mehyar.us/api/floodlens/unsubscribe?token=${subToken}`;
  const subject = `Your ${productName} is ready`;
  const text =
    `Thanks for your purchase!\n\n` +
    `Your ${productName} is ready — download your PDF:\n${downloadUrl}\n\n` +
    `This link is personal to you — keep it somewhere safe. If it ever stops working, just reply to this email and we'll sort it out.\n\n` +
    `Not an official flood determination. See the disclaimer inside the report.\n\n` +
    `No longer want FloodLens emails? Unsubscribe in one click: ${unsubUrl}\n\n-- ${fromName}`;
  const html =
    `<p>Thanks for your purchase!</p>` +
    `<p>Your <strong>${productName}</strong> is ready:</p>` +
    `<p><a href="${downloadUrl}" style="display:inline-block;background:#0a5cc2;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;">Download your report (PDF)</a></p>` +
    `<p style="color:#6b7280;font-size:13px;">Or copy this link:<br><a href="${downloadUrl}">${downloadUrl}</a></p>` +
    `<p style="color:#6b7280;font-size:13px;">This link is personal to you — keep it somewhere safe. If it ever stops working, just reply to this email and we'll sort it out.</p>` +
    `<p style="color:#6b7280;font-size:13px;">Not an official flood determination. See the disclaimer inside the report.</p>` +
    `<p style="color:#9aa3b2;font-size:12px;"><a href="${unsubUrl}" style="color:#9aa3b2;">Unsubscribe</a> from FloodLens emails.</p>` +
    `<p>-- ${fromName}</p>`;
  return sendEmail(env, {
    from, fromName, to: payment.email, replyTo: "info@mehyar.us", subject, text, html,
    headers: {
      "List-Unsubscribe": `<${unsubUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });
}

export async function fulfillFloodlens({ db, env, waitUntil, sendEmail }, payment) {
  const fail = async (orderId, reason) => {
    try {
      if (orderId) {
        await db.prepare(`UPDATE floodlens_orders SET status='failed' WHERE id=? AND status IN ('paid','generating')`)
          .bind(orderId).run();
      }
    } catch {}
    return { ok: false, error: reason };
  };
  try {
    if (!db || !payment || !payment.id) throw new Error("bad_args");
    const paymentId = String(payment.id);

    const productId = payment.product_id;
    const productName = PRODUCT_NAMES[productId] || productId;
    const is3Pack = productId === "floodlens-3pack";

    // ── idempotent order create ──
    const existing = await db
      .prepare("SELECT id, token, status FROM floodlens_orders WHERE payment_id = ?")
      .bind(paymentId)
      .first();
    if (existing) {
      return { ok: true, replay: true, order_id: existing.id, status: existing.status };
    }

    let meta = {};
    try { meta = JSON.parse(payment.metadata_json || "{}"); } catch {}
    const intake = (meta && typeof meta === "object" && meta.inputs) || meta || {};
    const tokens = is3Pack
      ? toTokenList(intake.lookup_tokens)
      : toTokenList(intake.lookup_token ? [intake.lookup_token] : []);
    if (tokens.length === 0) {
      // No lookup to generate from — record the failure, never invent content.
      const ins = await db.prepare(
        "INSERT INTO floodlens_orders (payment_id, token, product_id, email, status, inputs_json) VALUES (?, ?, ?, ?, 'failed', ?)"
      ).bind(paymentId, randomToken(32), productId, payment.email, JSON.stringify({ error: "missing_lookup_token" })).run();
      return { ok: false, order_id: ins.meta.last_row_id, error: "missing_lookup_token" };
    }
    const lookups = await loadLookups(db, tokens);
    // 3-pack requires 3 DISTINCT valid lookups; single requires exactly 1.
    // Checkout already enforces this, but the webhook must not trust metadata
    // blindly — malformed or partial paid metadata fails loudly, never
    // inventing a report.
    const need = is3Pack ? 3 : 1;
    const distinct = new Set(lookups.map((l) => l.token)).size;
    if (lookups.length < need || distinct < need) {
      const ins = await db.prepare(
        "INSERT INTO floodlens_orders (payment_id, token, product_id, email, status, inputs_json) VALUES (?, ?, ?, ?, 'failed', ?)"
      ).bind(paymentId, randomToken(32), productId, payment.email, JSON.stringify({ error: "lookup_not_found", need, found: lookups.length })).run();
      return { ok: false, order_id: ins.meta.last_row_id, error: "lookup_not_found" };
    }

    const orderToken = randomToken(32);
    const first = lookups[0];
    const ins = await db.prepare(
      "INSERT INTO floodlens_orders (payment_id, token, product_id, email, lookup_token, address, zone, status, inputs_json) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, 'paid', ?)"
    ).bind(
      paymentId, orderToken, productId, payment.email,
      lookups.map((l) => l.token).join(","), first.address, first.zone,
      JSON.stringify({ lookup_tokens: lookups.map((l) => l.token) })
    ).run();
    const orderId = ins.meta.last_row_id;

    // Token unification: one token gates every buyer surface.
    await db.prepare("UPDATE billing_payments SET access_token = ? WHERE id = ?")
      .bind(orderToken, payment.id).run();

    const run = async () => {
      try {
        await db.prepare("UPDATE floodlens_orders SET status='generating' WHERE id=? AND status='paid'")
          .bind(orderId).run();

        const props = lookups.map(propFromLookup);

        // EXACTLY ONE Workers AI call for narration.
        const narrations = await narrateReport(env, props);
        if (narrations) props.forEach((p, i) => { p.narration = narrations[i]; });

        const now = new Date().toISOString();
        const { bytes, pages } = buildFloodReport(props, {
          generated_at: now,
          data_checked_at: first.queried_at || now,
          degraded: Number(first.degraded) === 1,
          report_id: `FL-${orderId}`,
        });

        if (!env.FLOODLENS_REPORTS) throw new Error("r2_binding_missing");
        const r2Key = `reports/${orderToken}.pdf`;
        await env.FLOODLENS_REPORTS.put(r2Key, bytes, {
          httpMetadata: { contentType: "application/pdf" },
        });

        await db.prepare(
          `UPDATE floodlens_orders SET status='ready', r2_key=?, ready_at=${nowSql} WHERE id=? AND status!='ready'`
        ).bind(r2Key, orderId).run();

        // Stop the free→paid drip for this buyer (drip-campaign.md).
        try {
          await db.prepare("UPDATE floodlens_subscribers SET converted=1 WHERE email=?")
            .bind(String(payment.email).toLowerCase()).run();
        } catch {}

        // Ensure the buyer has a subscriber row so the receipt's one-click
        // unsubscribe always works.
        const emailLc = String(payment.email).toLowerCase();
        let sub = await db.prepare("SELECT confirm_token FROM floodlens_subscribers WHERE email=?")
          .bind(emailLc).first();
        if (!sub) {
          const subToken = randomToken(32);
          await db.prepare(
            "INSERT INTO floodlens_subscribers (email, status, brand, lookup_token, confirm_token, source, converted) " +
            "VALUES (?, 'purchased', 'floodlens', ?, ?, 'purchase', 1) " +
            "ON CONFLICT(email) DO UPDATE SET converted=1"
          ).bind(emailLc, lookups[0].token, subToken).run();
          sub = { confirm_token: subToken };
        }

        const result = (await isFloodlensSuppressed(db, payment.email))
          ? { ok: false, error: "suppressed" }
          : await emailReceipt(env, sendEmail, payment, productName, orderToken, sub.confirm_token);
        if (!result.ok && result.error !== "suppressed") console.error("fulfillFloodlens receipt email failed", productId, result.error);
        return { ok: true, order_id: orderId, pages, email_ok: !!result.ok };
      } catch (e) {
        console.error("fulfillFloodlens background generate failed", productId, e && e.message);
        await fail(orderId, String((e && e.message) || e).slice(0, 120));
        // No email on failure: the buyer lands on success.html?token= from
        // Stripe, which polls /api/pay/status and shows live status + retry.
        return { ok: false, order_id: orderId };
      }
    };

    if (typeof waitUntil === "function") waitUntil(run());
    else await run();

    return { ok: true, order_id: orderId, mode: is3Pack ? "3pack" : "single" };
  } catch (e) {
    console.error("fulfillFloodlens threw", e && e.message);
    return { ok: false, error: String((e && e.message) || e).slice(0, 120) };
  }
}
