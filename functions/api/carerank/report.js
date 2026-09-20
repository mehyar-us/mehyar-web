// functions/api/carerank/report.js
// GET /api/carerank/report?token=... — READ-ONLY paid report fetch.
//
// Verifies the token against a PAID billing_payments row (SKU
// carerank-shortlist) or a carerank_orders row, then returns the buyer's
// report: the full `report` object the report.html renderer expects
// (quiz, data_as_of, matches[] with facility facts + scores + bullets),
// plus top_facilities / bullets summaries for other consumers.
//
// Bogus token → 404. Non-ready orders return their status so the success
// page can poll (paid/pending/generating) or show retry info (failed).

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...extraHeaders },
  });
}

// CORS for cross-origin brand calls (carerank.mehyar.us -> mehyar.us).
// Only *.mehyar.us origins are reflected; everything else gets no CORS headers.
// (Same pattern as functions/api/pay/checkout.js.)
function corsHeaders(request) {
  const origin = (request.headers.get("Origin") || "").trim();
  if (/^https:\/\/([a-z0-9-]+\.)?mehyar\.us$/i.test(origin)) {
    return { "access-control-allow-origin": origin, vary: "Origin" };
  }
  return {};
}

export async function onRequestOptions({ request }) {
  const cors = corsHeaders(request);
  return new Response(null, {
    status: 204,
    headers: {
      ...cors,
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "86400",
    },
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
    const cors = corsHeaders(request);
    const J = (data, status = 200) => json(data, status, cors);
    const db = env && env.LEADS_DB;
    if (!db || typeof db.prepare !== "function") {
      return J({ ok: false, error: "db_unavailable" }, 500);
    }
    // Ensure the orders table exists (created lazily by the webhook on first
    // paid order; the report endpoint must not 500 before that happens).
    try {
      const { ensureCarerankSchema } = await import("../_shared/fulfillCarerank.js");
      await ensureCarerankSchema(db);
    } catch (e) {
      console.error("carerank report ensureSchema failed", e && e.message);
    }
    const url = new URL(request.url);
    const token = (url.searchParams.get("token") || "").trim();
    if (!token || token.length < 16) {
      return J({ ok: false, error: "invalid_token" }, 403);
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
      // Full report object matching the report.html renderer contract:
      // report.quiz {zip, priorities{staffing,quality,inspection}, needs[], maxDistanceMiles, minOverall},
      // report.data_as_of, report.matches[] {facility{...CMS facts}, score, factors[], ai_fit, ai_watchouts}.
      const qNeeds = quiz && quiz.needs && typeof quiz.needs === "object"
        ? Object.keys(quiz.needs).filter((k) => quiz.needs[k])
        : [];
      const report = {
        quiz: {
          zip: (quiz && (quiz.zip || quiz.zipcode)) || "",
          priorities: (quiz && quiz.priorities && typeof quiz.priorities === "object")
            ? {
                staffing: Number(quiz.priorities.staffing) || 0,
                quality: Number(quiz.priorities.quality) || 0,
                inspection: Number(quiz.priorities.inspection) || 0,
              }
            : { staffing: 0, quality: 0, inspection: 0 },
          needs: qNeeds,
          maxDistanceMiles: Number(quiz && quiz.maxDistanceMiles) || 25,
          minOverall: Number(quiz && quiz.minOverall) || 0,
        },
        data_as_of: output.data_as_of || null,
        matches: facilities.map((f) => {
          const facts = (f.facts && typeof f.facts === "object") ? f.facts : {};
          return {
            facility: {
              name: String(f.name || ""),
              address: null, // CMS provider data does not publish street addresses
              city: f.city || null,
              state: f.state || null,
              zip: f.zip || null,
              phone: f.phone || null,
              ownership: null, // not published in the CMS extract we ship
              beds: typeof facts.beds === "number" ? facts.beds : null,
              overall_rating: typeof facts.overall_rating === "number" ? facts.overall_rating : null,
              staffing_rating: typeof facts.staffing_rating === "number" ? facts.staffing_rating : null,
              quality_rating: typeof facts.quality_rating === "number" ? facts.quality_rating : null,
              health_inspection_rating: typeof facts.health_inspection_rating === "number" ? facts.health_inspection_rating : null,
              _distMiles: typeof facts.distance_miles === "number" ? facts.distance_miles
                : (typeof f.distance_miles === "number" ? f.distance_miles : null),
            },
            score: typeof f.score === "number" ? f.score : null,
            factors: [],
            ai_fit: Array.isArray(f.fit) ? f.fit : [],
            ai_watchouts: Array.isArray(f.watchout) ? f.watchout : [],
          };
        }),
      };
      return J({
        ok: true,
        status: order.status || "pending",
        email: order.email,
        quiz,
        report,
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
      return J({
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

    return J({ ok: false, error: "not_found" }, 404);
  } catch (e) {
    console.error("carerank report failed", e && e.message);
    return J({ ok: false, error: "server_error" }, 500);
  }
}
