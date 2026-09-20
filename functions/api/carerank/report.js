// functions/api/carerank/report.js
// GET /api/carerank/report?token=... — READ-ONLY paid report fetch.
//
// Verifies the token against a PAID billing_payments row (SKU
// carerank-shortlist) or a carerank_orders row, then returns the buyer's
// report: quiz, top_facilities (ccn+name+score only — the full CMS facts ship
// in the frontend bundle), bullets, data_as_of, created_at.
//
// Bogus token → 404. Non-ready orders return their status so the success
// page can poll (paid/pending/generating) or show retry info (failed).

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function safeParse(s) {
  try {
    return JSON.parse(s || "{}") || {};
  } catch {
    return {};
  }
}

export async function onRequestGet({ request, env }) {
  try {
    const db = env && env.LEADS_DB;
    if (!db || typeof db.prepare !== "function") {
      return json({ ok: false, error: "db_unavailable" }, 500);
    }
    const url = new URL(request.url);
    const token = (url.searchParams.get("token") || "").trim();
    if (!token || token.length < 16) {
      return json({ ok: false, error: "invalid_token" }, 403);
    }

    // Order path first (carerank_orders rows only exist for paid webhooks).
    const order = await db
      .prepare("SELECT id, email, quiz_json, output_json, status, failure_reason, created_at, ready_at FROM carerank_orders WHERE access_token = ?")
      .bind(token)
      .first();
    if (order) {
      const quiz = safeParse(order.quiz_json);
      const output = safeParse(order.output_json);
      const facilities = Array.isArray(output.facilities) ? output.facilities : [];
      const top = facilities.map((f) => ({
        ccn: String(f.ccn || ""),
        name: String(f.name || ""),
        score: typeof f.score === "number" ? f.score : null,
      }));
      return json({
        ok: true,
        status: order.status || "pending",
        email: order.email,
        quiz,
        top_facilities: top,
        bullets: facilities.map((f) => ({
          ccn: String(f.ccn || ""),
          name: String(f.name || ""),
          fit: Array.isArray(f.fit) ? f.fit : [],
          watchout: Array.isArray(f.watchout) ? f.watchout : [],
        })),
        data_as_of: output.data_as_of || null,
        created_at: order.created_at || null,
        ready_at: order.ready_at || null,
        failure_reason: order.status === "failed" ? (order.failure_reason || "generation_failed") : undefined,
      });
    }

    // Payment path: a paid payment whose order row hasn't been created yet
    // (webhook still processing). Pollers see status=paid and keep waiting.
    const pay = await db
      .prepare(
        "SELECT email, metadata_json, paid_at FROM billing_payments " +
        "WHERE access_token = ? AND product_id = 'carerank-shortlist' AND status = 'paid' LIMIT 1"
      )
      .bind(token)
      .first();
    if (pay) {
      const meta = safeParse(pay.metadata_json);
      const quiz = (meta.quiz && typeof meta.quiz === "object") ? meta.quiz
        : (meta.quiz_answers && typeof meta.quiz_answers === "object") ? meta.quiz_answers : {};
      return json({
        ok: true,
        status: "paid",
        email: pay.email,
        quiz,
        top_facilities: [],
        bullets: [],
        data_as_of: null,
        created_at: pay.paid_at || null,
      });
    }

    return json({ ok: false, error: "not_found" }, 404);
  } catch (e) {
    console.error("carerank report failed", e && e.message);
    return json({ ok: false, error: "server_error" }, 500);
  }
}
