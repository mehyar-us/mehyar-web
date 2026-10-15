// functions/api/_shared/fulfillMemoir.js
// Fulfillment for Memoir (memoir.mehyar.us): AI-guided memoir interviewer.
//   memoir-digital   $79 one-time  — full 12-chapter interview, 1 storyteller,
//                    compiled digital book (web + PDF) + print-ready PDF.
//   memoir-complete  $149 one-time — up to 3 storytellers, hardcover
//                    print-ready edition + designed cover, gift scheduling.
//                    Print-READY files only — no book is ever mailed.
//
// Contract: fulfillMemoir({ db, env, waitUntil, sendEmail }, payment)
//   payment.metadata_json is FLAT body.params from the centralized
//   checkout: { project_token } — the memoir project created by the
//   free Sample Chapter flow on memoir.mehyar.us.
//
// Behavior:
//   1. Idempotent on payment.id: memoir_projects.payment_id records the
//      fulfilling payment; a replay with the same payment already
//      recorded returns {replay:true} and sends no second email.
//   2. Token unification: billing_payments.access_token := the project
//      token, so one token gates every Memoir buyer surface.
//   3. Emails the buyer their personal memoir link (transactional;
//      sender is the proven team@mehyar.us identity). Never throws
//      out of the hook.

const PRODUCT_NAMES = {
  "memoir-digital": "Memoir — Digital",
  "memoir-complete": "Memoir — Complete",
};

function baseUrl(env) {
  return String(env.MEMOIR_BASE_URL || "https://memoir.mehyar.us").replace(/\/+$/, "");
}
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[m]));
}

export async function fulfillMemoir({ db, env, waitUntil, sendEmail }, payment) {
  if (!db || !payment || !payment.id) throw new Error("fulfillMemoir: bad args");
  const productId = payment.product_id;
  if (!PRODUCT_NAMES[productId]) throw new Error("fulfillMemoir: wrong product " + productId);

  let meta = {};
  try { meta = JSON.parse(payment.metadata_json || "{}"); } catch {}
  const flat = (meta && typeof meta === "object" && meta.inputs) || meta || {};
  const projectToken = String(flat.project_token || flat.projectToken || "").slice(0, 64);
  const buyerEmail = String(payment.email || "").trim().toLowerCase();
  if (!projectToken) {
    console.error("fulfillMemoir: no project_token in metadata for payment", payment.id);
    return { ok: false, error: "missing_project_token" };
  }

  const project = await db
    .prepare("SELECT token, status, sku, payment_id, payer_email, storyteller_name FROM memoir_projects WHERE token = ? AND deleted_at IS NULL")
    .bind(projectToken)
    .first();
  if (!project) {
    console.error("fulfillMemoir: unknown project token for payment", payment.id);
    return { ok: false, error: "unknown_project" };
  }

  // Idempotency: this exact payment already fulfilled.
  if (project.payment_id === payment.id && project.status === "paid") {
    return { ok: true, replay: true, token: projectToken };
  }

  await db
    .prepare(
      "UPDATE memoir_projects SET status='paid', sku=?, payment_id=?, " +
      "payer_email=COALESCE(?, payer_email), " +
      "paid_at=COALESCE(paid_at, strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE token = ?"
    )
    .bind(productId, payment.id, buyerEmail || null, projectToken)
    .run();

  // Token unification — one token gates every Memoir buyer surface.
  await db
    .prepare("UPDATE billing_payments SET access_token=? WHERE id=?")
    .bind(projectToken, payment.id)
    .run();

  if (buyerEmail && typeof sendEmail === "function") {
    const run = async () => {
      try {
        const link = `${baseUrl(env)}/m/${projectToken}`;
        const name = project.storyteller_name ? ` for ${project.storyteller_name}` : "";
        const subject = `Your Memoir is unlocked — all 12 chapters are open${name}`;
        const text =
          `Thank you — your ${PRODUCT_NAMES[productId]} purchase is complete.\n\n` +
          `All 12 interview chapters are now unlocked. Open the memoir here:\n${link}\n\n` +
          `Keep this link — it is the key back in for you and the storyteller. ` +
          `Answer at any pace; the book compiles from the storyteller's own words as chapters are finished, ` +
          `and can be read, shared with family, downloaded, and printed from the book view.\n\n` +
          (productId === "memoir-complete"
            ? `Complete includes up to three storytellers and the hardcover print-ready edition with a designed cover — print-ready files you can send to any printer; no book is mailed.\n\n`
            : `\n`) +
          `Stories stay private behind this link, are never used for marketing, and can be deleted anytime from the memoir page. Purchases are final.\n\n` +
          `Mehyar Soft LLC · info@mehyar.us`;
        const html =
          `<p>Thank you — your <strong>${esc(PRODUCT_NAMES[productId])}</strong> purchase is complete.</p>` +
          `<p>All 12 interview chapters are now unlocked${esc(name)}.</p>` +
          `<p><a href="${esc(link)}" style="display:inline-block;background:#7a4a12;color:#ffffff;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:bold;">Open the memoir</a></p>` +
          `<p style="color:#6b7280;font-size:13px;">Keep this link — it's the key back in:<br><a href="${esc(link)}">${esc(link)}</a></p>` +
          `<p style="color:#6b7280;font-size:13px;">The book compiles from the storyteller's own words as chapters are finished. Stories stay private behind this link, are never used for marketing, and can be deleted anytime from the memoir page. Purchases are final.</p>` +
          `<p>-- Memoir, Mehyar Soft LLC · info@mehyar.us</p>`;
        const result = await sendEmail(env, { from: "team@mehyar.us", fromName: "Memoir", to: buyerEmail, replyTo: "info@mehyar.us", subject, text, html });
        if (!result || !result.ok) console.error("fulfillMemoir email failed", result && result.error);
      } catch (e) {
        console.error("fulfillMemoir email threw", e && e.message);
      }
    };
    if (typeof waitUntil === "function") waitUntil(run()); else await run();
  }

  return { ok: true, token: projectToken, sku: productId };
}
