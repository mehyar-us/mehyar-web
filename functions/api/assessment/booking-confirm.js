// GET /api/assessment/booking-confirm?token=abt_... — Mayor's one-click APPROVE.
import { decideBooking, decidePage } from "../_shared/assessmentBookingDecide.js";

export async function onRequestGet({ request, env }) {
  try {
    if (!env?.LEADS_DB) return decidePage("Unavailable", "<p>Service temporarily unavailable.</p>");
    return await decideBooking(env, new URL(request.url).searchParams.get("token") || "", true);
  } catch (e) {
    console.error("[booking-confirm]", e?.message);
    return decidePage("Error", "<p>Something went wrong — the slot is still held. Please try again.</p>");
  }
}
