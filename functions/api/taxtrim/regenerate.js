// /api/taxtrim/regenerate — buyer-initiated TaxTrim packet rebuild.
// POST { token } where token = taxtrim_orders.access_token (==
// billing_payments.access_token after webhook token unification). The token
// itself is the capability: unguessable, per-order, no other auth needed.
//
// Looks up the order, re-runs the shared generateTaxTrimPacket core, and
// returns { ok, status }. Used by taxtrim.mehyar.us /api/kit/retry.

import { generateTaxTrimPacket } from "../_shared/fulfillTaxtrim.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json().catch(() => ({}));
    const token = String(body.token || "");
    if (!token || token.length < 16) return json({ ok: false, error: "not_found" }, 404);
    const db = env.LEADS_DB || env.DB;
    if (!db) return json({ ok: false, error: "service_unavailable" }, 503);

    const order = await db.prepare(
      "SELECT id, product_id, email, case_token, status, access_token FROM taxtrim_orders WHERE access_token = ?"
    ).bind(token).first();
    if (!order) return json({ ok: false, error: "not_found" }, 404);
    if (order.status === "ready") return json({ ok: true, status: "ready" });
    if (order.product_id !== "taxtrim-packet") {
      return json({ ok: false, error: "not_a_packet" }, 400);
    }

    await db.prepare("UPDATE taxtrim_orders SET status = 'paid' WHERE id = ?")
      .bind(order.id).run();
    try {
      await generateTaxTrimPacket({ db, env }, order);
      return json({ ok: true, status: "ready" });
    } catch (e) {
      console.error("taxtrim/regenerate generate failed", e && e.message);
      await db.prepare("UPDATE taxtrim_orders SET status = 'failed' WHERE id = ?")
        .bind(order.id).run().catch(() => {});
      return json({ ok: false, error: "generate_failed" }, 500);
    }
  } catch (e) {
    console.error("api/taxtrim/regenerate error", e && e.message);
    return json({ ok: false, error: "regenerate_failed" }, 500);
  }
}
