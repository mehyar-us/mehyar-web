// functions/api/_shared/sweepProducts.js
// Registry for the all-products fulfillment sweep (POST /api/pay/fulfillment-sweep).
// Added 2026-10-05: every AI-generation product gets the same self-heal habit
// the HustleKit sweep proved — stuck rows are re-driven, ready-but-unemailed
// rows get exactly-once buyer emails, and orphan paid payments (paid in
// billing_payments but no order row) replay their fulfill module.
//
// Each spec:
//   key            — short id used in sweep logs/responses
//   table          — D1 order table
//   fulfillment    — billing_products.fulfillment value (PASS 0 orphan matching)
//   displayName    — product name for buyer emails
//   fromName       — email From name (proven mehyar.us identity convention)
//   base(env)      — product site base URL
//   stuckStatuses  — order statuses treated as "needs a re-drive"
//   generatePath   — product-site generate endpoint (HTTP redrive)
//   generateBody(row) — POST body for the generate endpoint
//   generateHeaders(env, row) — extra headers (e.g. Bearer secrets)
//   localRedrive   — alternative: async ({db,env,sendEmail}, row) for in-worker generation
//   stableDrive    — true: also return the token in `drive` so the GitHub
//                    workflow drives generation as a stable caller (long parts)
//   deliverableUrl(env, row) — token-gated buyer link for the backstop email
//   needsInputs    — parse inputs_json for the generate body (done generically)
//
// Convention notes (verified 2026-10-05 from each fulfill module):
// - Every product-site generate endpoint takes {order_token} at minimum.
// - Server-to-site calls MUST spoof a browser User-Agent (Cloudflare 1010).
// - Buyer emails send from team@mehyar.us with the product brand as From name.

export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const stripSlash = (u) => String(u || "").replace(/\/+$/, "");

function parseInputs(row) {
  try {
    return JSON.parse(row.inputs_json || "{}") || {};
  } catch {
    return {};
  }
}

export const SWEEP_PRODUCTS = [
  {
    key: "designful",
    table: "designful_orders",
    fulfillment: "designful",
    displayName: "Designful",
    fromName: "Designful",
    base: (env) => stripSlash(env.DESIGNFUL_BASE_URL || "https://designful.mehyar.us"),
    stuckStatuses: ["paid", "generating", "failed"],
    generatePath: "/api/designful/generate",
    generateBody: (row) => {
      const j = parseInputs(row);
      return { order_token: row.access_token, feature: j.feature || null, inputs: j.inputs || {} };
    },
    deliverableUrl: (env, row) => {
      const b = stripSlash(env.DESIGNFUL_BASE_URL || "https://designful.mehyar.us");
      const page = row.bundle_slots ? "success.html" : "deliverable.html";
      return `${b}/${page}?token=${row.access_token}`;
    },
  },
  {
    key: "prepguide",
    table: "prepguide_orders",
    fulfillment: "prepguide",
    displayName: "PrepGuide",
    fromName: "PrepGuide",
    base: (env) => stripSlash(env.PREPGUIDE_BASE_URL || "https://prepguide.mehyar.us"),
    stuckStatuses: ["paid", "generating", "failed"],
    generatePath: "/api/prepguide/generate",
    generateBody: (row) => ({ order_token: row.access_token }),
    deliverableUrl: (env, row) =>
      `${stripSlash(env.PREPGUIDE_BASE_URL || "https://prepguide.mehyar.us")}/success?token=${row.access_token}`,
  },
  {
    key: "promptpack",
    table: "promptpack_orders",
    fulfillment: "promptpack",
    displayName: "PromptPack Pro",
    fromName: "PromptPack",
    base: () => "https://promptpack.mehyar.us",
    stuckStatuses: ["paid", "generating", "failed"],
    generatePath: "/api/promptpack/generate",
    generateBody: (row) => ({ order_token: row.access_token }),
    deliverableUrl: (env, row) =>
      `https://promptpack.mehyar.us/deliverable.html?token=${row.access_token}`,
  },
  {
    key: "tiktokgrowth",
    table: "tiktokgrowth_orders",
    fulfillment: "tiktokgrowth",
    displayName: "TikTok Growth System",
    fromName: "TikTok Growth",
    base: (env) => stripSlash(env.TIKTOKGROWTH_BASE_URL || "https://tiktokgrowth.mehyar.us"),
    stuckStatuses: ["paid", "generating", "failed"],
    // /api/tiktok/drive is one bounded request by design — safe to re-drive
    // every sweep; the order converges as drives accumulate.
    generatePath: "/api/tiktok/drive",
    generateBody: (row) => ({ order_token: row.access_token }),
    deliverableUrl: (env, row) =>
      `${stripSlash(env.TIKTOKGROWTH_BASE_URL || "https://tiktokgrowth.mehyar.us")}/deliverable.html?token=${row.access_token}`,
  },
  {
    key: "bizbuilder",
    table: "bizbuilder_orders",
    fulfillment: "bizbuilder",
    displayName: "BizBuilder",
    fromName: "BizBuilder",
    base: (env) => stripSlash(env.BIZBUILDER_BASE_URL || "https://bizbuilder.mehyar.us"),
    stuckStatuses: ["paid", "generating", "failed"],
    generatePath: "/api/bizbuilder/generate",
    generateBody: (row) => ({ order_token: row.access_token, inputs: parseInputs(row).inputs || {} }),
    deliverableUrl: (env, row) =>
      `${stripSlash(env.BIZBUILDER_BASE_URL || "https://bizbuilder.mehyar.us")}/deliverable.html?token=${row.access_token}`,
  },
  {
    key: "creditfixkit",
    table: "creditfixkit_orders",
    fulfillment: "creditfixkit",
    displayName: "CreditFix Kit",
    fromName: "CreditFix Kit",
    base: (env) => stripSlash(env.CREDITFIXKIT_BASE_URL || "https://creditfixkit.mehyar.us"),
    stuckStatuses: ["paid", "generating", "failed"],
    generatePath: "/api/creditfix/generate",
    generateBody: (row) => ({ order_token: row.access_token, inputs: parseInputs(row).inputs || {} }),
    deliverableUrl: (env, row) =>
      `${stripSlash(env.CREDITFIXKIT_BASE_URL || "https://creditfixkit.mehyar.us")}/deliverable.html?token=${row.access_token}`,
  },
  {
    key: "truesketch",
    table: "truesketch_orders",
    fulfillment: "truesketch",
    displayName: "TrueSketch",
    fromName: "TrueSketch",
    base: (env) => stripSlash(env.TRUESKETCH_BASE_URL || "https://truesketch.mehyar.us"),
    // truesketch_orders defaults to 'generating' at insert; stuck = still
    // generating/failed (or paid) past the cutoff.
    stuckStatuses: ["paid", "generating", "failed"],
    generatePath: "/api/generate",
    generateBody: (row) => ({
      payment_id: row.payment_id,
      access_token: row.access_token,
      email: row.email,
      product_id: row.product_id || "truesketch-reading",
      intake_id: row.intake_id || null,
    }),
    generateHeaders: (env) =>
      env.TRUESKETCH_GENERATE_SECRET
        ? { authorization: "Bearer " + env.TRUESKETCH_GENERATE_SECRET }
        : {},
    deliverableUrl: (env, row) =>
      `${stripSlash(env.TRUESKETCH_BASE_URL || "https://truesketch.mehyar.us")}/gallery.html?token=${row.access_token}`,
  },
  {
    key: "puretap",
    table: "puretap_orders",
    fulfillment: "puretap",
    displayName: "PureTap",
    fromName: "PureTap",
    base: () => "https://puretap.mehyar.us",
    stuckStatuses: ["paid", "generating", "failed"],
    generatePath: "/api/report/generate",
    generateBody: (row) => {
      const j = parseInputs(row);
      const flat = j.inputs || j;
      return {
        order_token: row.access_token,
        zip: flat.zip || undefined,
        email: row.email || undefined,
      };
    },
    deliverableUrl: (env, row) =>
      `https://puretap.mehyar.us/api/report?token=${encodeURIComponent(row.access_token)}`,
  },
  {
    key: "ticketbeat",
    table: "ticketbeat_orders",
    fulfillment: "ticketbeat",
    displayName: "TicketBeat",
    fromName: "TicketBeat",
    base: (env) => stripSlash(env.TICKETBEAT_BASE_URL || "https://ticketbeat.mehyar.us"),
    stuckStatuses: ["paid", "generating", "failed"],
    generatePath: "/api/letter/generate",
    generateBody: (row) => ({ order_token: row.access_token, inputs: parseInputs(row).inputs || {} }),
    deliverableUrl: (env, row) =>
      row.letter_url ||
      row.pdf_url ||
      `${stripSlash(env.TICKETBEAT_BASE_URL || "https://ticketbeat.mehyar.us")}/letter.html?token=${row.access_token}`,
  },
  {
    key: "sproutscore",
    table: "sproutscore_orders",
    fulfillment: "sproutscore",
    displayName: "SproutScore",
    fromName: "SproutScore",
    base: (env) => stripSlash(env.SPROUTSCORE_BASE_URL || "https://sproutscore.mehyar.us"),
    stuckStatuses: ["paid", "generating", "failed"],
    // In-worker generation (exported by fulfillSproutscore.js) — no HTTP hop.
    // Returns {ok, awaiting_center} when the buyer hasn't picked a center yet;
    // that is NOT a failure: the success page acts as the picker.
    localRedrive: "sproutscore",
    deliverableUrl: (env, row) =>
      `${stripSlash(env.SPROUTSCORE_BASE_URL || "https://sproutscore.mehyar.us")}/report.html?token=${row.access_token}`,
  },
  {
    key: "taxtrim",
    table: "taxtrim_orders",
    fulfillment: "taxtrim",
    displayName: "TaxTrim",
    fromName: "TaxTrim",
    base: (env) => stripSlash(env.TAXTRIM_BASE_URL || "https://taxtrim.mehyar.us"),
    stuckStatuses: ["paid", "generating", "failed"],
    // In-worker generation (exported by fulfillTaxtrim.js).
    // Table is created at runtime by the fulfill module; skip if absent.
    localRedrive: "taxtrim",
    skipIfMissingTable: true,
    deliverableUrl: (env, row) =>
      `${stripSlash(env.TAXTRIM_BASE_URL || "https://taxtrim.mehyar.us")}/success.html?token=${row.access_token}`,
  },
  {
    key: "floodlens",
    table: "floodlens_orders",
    fulfillment: "floodlens",
    displayName: "FloodLens Flood Zone Report",
    fromName: "FloodLens",
    base: (env) => "https://mehyar.us",
    stuckStatuses: ["paid", "generating", "failed"],
    // In-worker generation (exported by fulfillFloodlens.js): narrates via
    // Workers AI, builds the 10-page PDF, stores to R2, marks ready, and
    // sends the branded receipt email exactly-once. Added 2026-10-05 after
    // floodlens_orders row 5 sat in 'generating' 3+ hours (isolate eviction).
    localRedrive: "floodlens",
    deliverableUrl: (env, row) =>
      `https://mehyar.us/api/floodlens/download?token=${row.token}`,
  },
];

/** Generic backstop buyer email: "your deliverable is ready" with the
 *  token-gated link. Used only for rows the webhook's own email missed. */
export function buildBackstopEmail({ fromName, displayName, deliverableUrl }) {
  const subject = `Your ${displayName} is ready`;
  const text =
    `Thanks for your purchase!\n\n` +
    `Your ${displayName} is ready:\n${deliverableUrl}\n\n` +
    `This link is personal to you — keep it somewhere safe. If it ever stops working, just reply to this email and we'll sort it out.\n\n` +
    `-- ${fromName}`;
  const html =
    `<p>Thanks for your purchase!</p>` +
    `<p>Your <strong>${displayName}</strong> is ready:</p>` +
    `<p><a href="${deliverableUrl}" style="display:inline-block;background:#111827;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;">Open your ${displayName}</a></p>` +
    `<p style="color:#6b7280;font-size:13px;">Or copy this link:<br><a href="${deliverableUrl}">${deliverableUrl}</a></p>` +
    `<p style="color:#6b7280;font-size:13px;">This link is personal to you — keep it somewhere safe. If it ever stops working, just reply to this email and we'll sort it out.</p>` +
    `<p>-- ${fromName}</p>`;
  return { subject, text, html };
}
