// GET /api/admin/center/bookings — assessment follow-up booking queue.
//
// Surfaces post-payment follow-up booking requests, with the manual-follow-up
// flag front and center: a booking with status='requested' whose buyer was
// never notified (no BOOKING_NOTIFY_URL delivery) needs a human to reach out.
// Never silently drops a buyer's booking — this queue is the backstop.
//
// Query: ?status=requested|confirmed|declined|expired|cancelled|all (default: all open)
// Response: { ok, bookings: [...], needs_followup_count }
import { guard, onOptions, qAllSoft, json } from "./_lib.js";

export async function onRequestOptions({ request, env }) {
  return onOptions(request, env);
}

const OPEN = ["requested", "confirmed"];

export async function onRequestGet({ request, env }) {
  const g = await guard(request, env);
  if (g.res) return g.res;
  if (!env.LEADS_DB) return json({ ok: false, error: "not_configured" }, 503);

  const url = new URL(request.url);
  const status = (url.searchParams.get("status") || "open").toLowerCase();

  let where = "";
  const params = [];
  if (status === "open") {
    where = `WHERE b.status IN (${OPEN.map(() => "?").join(",")})`;
    params.push(...OPEN);
  } else if (status !== "all") {
    where = "WHERE b.status = ?";
    params.push(status);
  }

  const rows = await qAllSoft(
    env.LEADS_DB,
    `SELECT b.id, b.audit_id, b.business_name, b.slot_start, b.slot_end, b.timezone,
            b.status, b.mayor_notified_at, b.webhook_notified_at, b.buyer_notified_at,
            b.decided_at, b.created_at, b.updated_at,
            (b.status = 'requested' AND b.buyer_notified_at IS NULL
              AND b.webhook_notified_at IS NULL) AS needs_manual_followup
       FROM assessment_bookings b ${where}
      ORDER BY needs_manual_followup DESC, b.created_at DESC
      LIMIT 200`,
    params
  );

  const bookings = (rows || []).map((r) => ({
    ...r,
    needs_manual_followup: r.needs_manual_followup === 1,
  }));
  return json({
    ok: true,
    bookings,
    needs_followup_count: bookings.filter((b) => b.needs_manual_followup).length,
  });
}
