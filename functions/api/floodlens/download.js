// functions/api/floodlens/download.js
// GET /api/floodlens/download?token= — token-gated PDF download for paid
// FloodLens orders. Tokens < 16 chars → 403; unknown / not-ready → 404.

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function onRequestGet({ request, env }) {
  try {
    if (!env?.LEADS_DB) return json({ ok: false, error: "service_unavailable" }, 503);
    const db = env.LEADS_DB;
    const token = new URL(request.url).searchParams.get("token") || "";
    if (token.length < 16) return json({ ok: false, error: "forbidden" }, 403);

    const order = await db
      .prepare("SELECT id, token, status, r2_key, product_id, address FROM floodlens_orders WHERE token = ?")
      .bind(token)
      .first();
    if (!order || order.status !== "ready" || !order.r2_key) {
      return json({ ok: false, error: order ? "not_ready" : "not_found" }, 404);
    }
    if (!env.FLOODLENS_REPORTS) return json({ ok: false, error: "service_unavailable" }, 503);
    const obj = await env.FLOODLENS_REPORTS.get(order.r2_key);
    if (!obj) return json({ ok: false, error: "not_found" }, 404);

    const safeAddr = String(order.address || "floodlens-report").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "floodlens-report";
    return new Response(obj.body, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${safeAddr}-floodlens-report.pdf"`,
        "cache-control": "private, no-store",
        "content-length": String(obj.size),
      },
    });
  } catch (e) {
    console.error("floodlens download failed", e && e.message);
    return json({ ok: false, error: "download_failed" }, 500);
  }
}
