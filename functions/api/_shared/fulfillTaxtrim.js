// /functions/api/_shared/fulfillTaxtrim.js
// Fulfillment for TaxTrim (taxtrim.mehyar.us): NYC property-tax appeal packets.
//   taxtrim-packet  $39 one-time — comparable-sales appeal packet PDF-ready.
//   taxtrim-renewal $49/year    — annual re-analysis before each March deadline.
//
// Contract: fulfillTaxtrim({ db, env, waitUntil, sendEmail }, payment)
//   db        — D1 binding (mehyar_leads_prod): billing_*, taxtrim_*, email_*
//   env       — Worker env (Cloudflare AI creds, TAXTRIM_BASE_URL)
//   waitUntil — background scheduling
//   sendEmail — injected mailer: sendEmail(env, {from, fromName, to, replyTo,
//               subject, text, html, headers}) wrapper around sendCloudflareEmail.
//
// Token unification: billing_payments.access_token is pointed at the
// taxtrim_orders token, so ONE token opens success.html, status, and packet.
//
// Free-tier emails carry a one-click TaxTrim unsubscribe (per-product
// suppression list taxtrim_suppression + central opt-out via the sync job).

import { chat } from "./llmChat.js";

const PRODUCT_NAMES = {
  "taxtrim-packet": "TaxTrim Appeal Packet",
  "taxtrim-renewal": "TaxTrim Annual Renewal",
};

const NARRATIVE_SYSTEM =
  "You are drafting the statement section of a New York City Tax Commission " +
  "property-tax appeal application for a Class 1 (1-3 family) home. Write in " +
  "plain, formal language suitable for a government filing.\n\n" +
  "HARD RULES:\n" +
  "- Use ONLY the facts supplied in the user message. Never invent addresses, prices, dates, or figures.\n" +
  '- Never promise or predict an outcome. Never use the words "guarantee", "will be reduced", "entitled", or "deserve".\n' +
  "- Do not give legal advice. This is a factual statement of comparable market evidence.\n" +
  "- Keep it under 350 words. Structure: (1) property identification, (2) the assessment being appealed, " +
  "(3) the comparable-sales evidence with specific comps cited, (4) the requested relief stated as a request, not a demand.\n" +
  '- End with: "I respectfully request the Commission review the evidence above."';

const FILING_STEPS = [
  "Gather your documents: this packet, your Notice of Property Value (NOPV), and any photos or repair estimates that support a lower value.",
  "Open the NYC Tax Commission online application portal and start a new Class 1 application for your BBL.",
  "Enter your property details exactly as they appear on your NOPV — BBL, address, and assessed value.",
  "Paste the complaint narrative below into the application's statement section, or attach this packet as a supporting document.",
  "In the comparable-sales section, enter the top 5 comps from the table below (address, sale price, sale date).",
  "Review everything, submit before the deadline, and save your confirmation number — you'll need it at any hearing.",
  "After filing: the Tax Commission reviews your application and may schedule a hearing. Bring this packet. If your assessment is reduced, the savings repeat every year you own the home.",
];

function randomToken(bytes = 32) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}
function baseUrl(env) {
  return String(env.TAXTRIM_BASE_URL || "https://taxtrim.mehyar.us").replace(/\/+$/, "");
}
function fromAddress(env) {
  // Until the taxtrim subdomain is onboarded on both ESPs (standing rule),
  // send from the proven mehyar.us identity.
  return { from: env.TAXTRIM_FROM_EMAIL || "team@mehyar.us", fromName: "TaxTrim" };
}
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[m]));
}
function fmt(n) {
  if (n == null || isNaN(n)) return "—";
  return "$" + Math.round(n).toLocaleString("en-US");
}
function narrativeHtml(narrative) {
  return esc(narrative).split(/\n{2,}|\n/).map((p) => `<p>${p}</p>`).join("");
}

// One-click unsubscribe token for a buyer (per-product suppression honoring).
async function unsubUrl(db, email) {
  try {
    const token = randomToken(16);
    await db.prepare(
      "INSERT OR REPLACE INTO taxtrim_unsub_tokens (token, email) VALUES (?, ?)"
    ).bind(token, String(email).toLowerCase()).run();
    return `https://taxtrim.mehyar.us/api/unsubscribe?token=${token}`;
  } catch { return "https://taxtrim.mehyar.us/api/unsubscribe"; }
}

function fallbackNarrative(c, comps) {
  return (
    `I am the owner of the Class ${c.tax_class || ""} property at ${c.address || ""}, ` +
    `${c.borough || ""} (BBL ${c.bbl || ""}). I appeal the Department of Finance market-value ` +
    `assessment of ${fmt(c.dof_market)} for this property.\n\n` +
    `Recent arms-length sales of comparable ${c.borough || ""} properties support a lower market value. ` +
    `The median sale price across ${comps.length} comparable sales near the property is ${fmt(c.comp_median)}, ` +
    `which is ${fmt(Math.max(0, c.excess_market || 0))} below the assessed market value. ` +
    `The comparable sales are listed in the evidence table accompanying this application.\n\n` +
    `I respectfully request the Commission review the evidence above.`
  );
}

async function draftNarrative(env, c, comps) {
  const compLines = comps.slice(0, 10).map((r, i) =>
    `${i + 1}. ${r.address || "address withheld"} — sold ${r.sale_date || "date unknown"} ` +
    `for $${Math.round(r.price || 0).toLocaleString()}` +
    `${r.distance_mi != null ? ` (${Number(r.distance_mi).toFixed(2)} mi away)` : ""}`
  ).join("\n");
  const userMsg =
    `Property: ${c.address || ""}, ${c.borough || ""}, BBL ${c.bbl || ""}, Tax Class ${c.tax_class || ""}.\n` +
    `DOF market value under appeal: $${Math.round(c.dof_market || 0).toLocaleString()}. ` +
    `DOF assessed value: $${Math.round(c.dof_assessed || 0).toLocaleString()}.\n` +
    `Median sale price of ${comps.length} comparable sales: $${Math.round(c.comp_median || 0).toLocaleString()}.\n` +
    `Estimated excess market value: $${Math.round(Math.max(0, c.excess_market || 0)).toLocaleString()}.\n` +
    `Comparable sales:\n${compLines}\n\nDraft the statement section now.`;
  try {
    const r = await chat({
      env,
      model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      messages: [
        { role: "system", content: NARRATIVE_SYSTEM },
        { role: "user", content: userMsg },
      ],
      max_tokens: 700,
      temperature: 0.3,
    });
    const text = String(r && r.content ? r.content : "").trim();
    if (r && r.used_llm && text.length >= 120) return { narrative: text, ai: true };
    console.error("fulfillTaxtrim narrative AI fallback:", r && r.error);
  } catch (e) {
    console.error("fulfillTaxtrim narrative AI error:", e && e.message);
  }
  return { narrative: fallbackNarrative(c, comps), ai: false };
}

async function getDeadline(db) {
  try {
    const row = await db.prepare("SELECT v FROM taxtrim_meta WHERE k = 'filing_deadline'").first();
    if (row && row.v) return row.v;
  } catch {}
  return "March 15, 2027";
}

// Core packet builder — shared by the webhook path and POST /api/taxtrim/regenerate.
export async function generateTaxTrimPacket({ db, env }, order) {
  const c = order.case_token
    ? await db.prepare(
        "SELECT case_token, bbl, address, borough, tax_class, dof_market, dof_assessed, " +
        "comp_median, comp_count, block_median_market, verdict, excess_market, excess_assessed, " +
        "annual_overpay, percentile, data_vintage, comps_json FROM taxtrim_cases WHERE case_token = ?"
      ).bind(order.case_token).first()
    : null;
  if (!c) throw new Error("generateTaxTrimPacket: unknown case");

  let comps = [];
  try { comps = JSON.parse(c.comps_json || "[]"); } catch {}
  if (!Array.isArray(comps)) comps = [];

  const { narrative, ai } = await draftNarrative(env, c, comps);
  const deadline = await getDeadline(db);
  let vintage = {};
  try { vintage = JSON.parse(c.data_vintage || "{}"); } catch {}

  const manifest = {
    order_token: order.access_token,
    product_id: order.product_id,
    prepared_at: new Date().toISOString().slice(0, 10),
    deadline,
    narrative_ai: ai,
    narrative_html: narrativeHtml(narrative),
    filing_steps: FILING_STEPS.slice(),
    vintage,
    case: {
      case_token: c.case_token, bbl: c.bbl, address: c.address, borough: c.borough,
      tax_class: c.tax_class, dof_market: c.dof_market, dof_assessed: c.dof_assessed,
      comp_median: c.comp_median, comp_count: c.comp_count,
      block_median_market: c.block_median_market, verdict: c.verdict,
      excess_market: c.excess_market, excess_assessed: c.excess_assessed,
      annual_overpay: c.annual_overpay, percentile: c.percentile,
    },
    comps: comps.map((r) => ({
      address: r.address || null, price: r.price, sale_date: r.sale_date,
      distance_mi: r.distance_mi,
    })),
  };

  await db.prepare(
    "UPDATE taxtrim_orders SET status = 'ready', output_json = ?, " +
    "ready_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND status != 'ready'"
  ).bind(JSON.stringify(manifest), order.id).run();

  return manifest;
}

export async function fulfillTaxtrim({ db, env, waitUntil, sendEmail }, payment) {
  if (!db || !payment || !payment.id) throw new Error("fulfillTaxtrim: bad args");

  const productId = payment.product_id;
  if (productId !== "taxtrim-packet" && productId !== "taxtrim-renewal") {
    throw new Error("fulfillTaxtrim: wrong product " + productId);
  }
  const productName = PRODUCT_NAMES[productId] || productId;

  let meta = {};
  try { meta = JSON.parse(payment.metadata_json || "{}"); } catch {}
  // Centralized /api/pay/checkout stores body.params FLAT as metadata_json.
  const caseToken = String(meta.case_token || meta.caseToken || "").slice(0, 64) || null;
  const buyerEmail = String(payment.email || "").trim().toLowerCase();

  // ── idempotent order create (one row per payment) ──
  const existing = await db
    .prepare("SELECT id, access_token, status, product_id FROM taxtrim_orders WHERE payment_id = ?")
    .bind(payment.id)
    .first();
  if (existing) {
    return { ok: true, replay: true, order_id: existing.id, status: existing.status };
  }

  const accessToken = randomToken(32);
  const ins = await db
    .prepare(
      "INSERT INTO taxtrim_orders (payment_id, product_id, email, case_token, status, access_token) " +
      "VALUES (?, ?, ?, ?, 'paid', ?)"
    )
    .bind(payment.id, productId, buyerEmail, caseToken, accessToken)
    .run();
  const orderId = ins.meta.last_row_id;

  // Token unification: billing_payments.access_token -> order token, so the
  // Stripe success_url_template token opens every TaxTrim surface.
  await db
    .prepare("UPDATE billing_payments SET access_token = ? WHERE id = ?")
    .bind(accessToken, payment.id)
    .run();

  const { from, fromName } = fromAddress(env);
  const unsub = await unsubUrl(db, buyerEmail);
  const unsubHeader = { "List-Unsubscribe": `<${unsub}>` };
  const footer =
    `\n\nTaxTrim is an informational tool, not legal or tax advice.\n` +
    `Unsubscribe: ${unsub}\nMehyarSoft LLC, 228 Park Ave S #92842, New York, NY 10003`;

  // ── renewal: annual watch, no packet ──
  if (productId === "taxtrim-renewal") {
    await db.prepare(
      "INSERT INTO taxtrim_watch (email, active) VALUES (?, 1) " +
      "ON CONFLICT(email) DO UPDATE SET active = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')"
    ).bind(buyerEmail).run().catch(() => {});
    const subject = "Your TaxTrim Annual Renewal is active";
    const text =
      `Thanks — your TaxTrim Annual Renewal is active.\n\n` +
      `Every January we'll re-run your property-tax analysis against the latest NYC assessment roll ` +
      `and email you a fresh verdict before the March Tax Commission deadline.\n\n` +
      `Manage or cancel anytime from your account page.` + footer;
    const html =
      `<p>Thanks — your <strong>TaxTrim Annual Renewal</strong> is active.</p>` +
      `<p>Every January we'll re-run your property-tax analysis against the latest NYC assessment roll ` +
      `and email you a fresh verdict before the March Tax Commission deadline.</p>` +
      `<p style="color:#6b7280;font-size:13px;">Manage or cancel anytime from your account page.<br>` +
      `<a href="${esc(unsub)}">Unsubscribe</a></p>`;
    const result = await sendEmail(env, {
      from, fromName, to: buyerEmail, replyTo: "info@mehyar.us",
      subject, text, html, headers: unsubHeader,
    });
    if (!result.ok) console.error("fulfillTaxtrim renewal email failed", result.error);
    return { ok: true, order_id: orderId, mode: "renewal", email_ok: !!result.ok };
  }

  // ── packet: background generation, then delivery email ──
  const order = { id: orderId, product_id: productId, case_token: caseToken, access_token: accessToken };
  const run = async () => {
    try {
      await generateTaxTrimPacket({ db, env }, order);
    } catch (e) {
      console.error("fulfillTaxtrim generate failed", e && e.message);
      try {
        await db.prepare("UPDATE taxtrim_orders SET status = 'failed' WHERE id = ?")
          .bind(orderId).run();
      } catch {}
      return { ok: false, error: "generate_failed" };
    }
    const packetUrl = `${baseUrl(env)}/packet.html?token=${accessToken}`;
    const subject = "Your TaxTrim appeal packet is ready";
    const text =
      `Your ${productName} is ready.\n\n` +
      `Open your packet here: ${packetUrl}\n\n` +
      `Inside: your comparable-sales analysis, a pre-filled Tax Commission complaint narrative, ` +
      `step-by-step filing instructions, and a printable PDF-ready page.\n\n` +
      `This link is personal to you — keep it somewhere safe.` + footer;
    const html =
      `<p>Your <strong>${esc(productName)}</strong> is ready.</p>` +
      `<p><a href="${esc(packetUrl)}" style="display:inline-block;background:#0f766e;color:#fff;` +
      `padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;">Open your packet</a></p>` +
      `<p style="color:#6b7280;font-size:13px;">Or copy this link:<br>` +
      `<a href="${esc(packetUrl)}">${esc(packetUrl)}</a></p>` +
      `<p style="color:#6b7280;font-size:13px;">Inside: your comparable-sales analysis, a pre-filled ` +
      `Tax Commission complaint narrative, step-by-step filing instructions, and a printable PDF-ready page. ` +
      `This link is personal to you — keep it somewhere safe.</p>` +
      `<p style="color:#6b7280;font-size:13px;"><a href="${esc(unsub)}">Unsubscribe</a></p>`;
    const result = await sendEmail(env, {
      from, fromName, to: buyerEmail, replyTo: "info@mehyar.us",
      subject, text, html, headers: unsubHeader,
    });
    if (!result.ok) console.error("fulfillTaxtrim packet email failed", result.error);
    return { ok: true, email_ok: !!result.ok };
  };

  try {
    if (waitUntil) waitUntil(run());
    else await run();
  } catch (e) {
    console.error("fulfillTaxtrim background failed", e && e.message);
  }
  return { ok: true, order_id: orderId, mode: "packet", access_token: accessToken };
}
