// GET /api/assessment/booking-decline?token=abt_... — Mayor's one-click DECLINE.
import { decideBooking, decidePage } from "../_shared/assessmentBookingDecide.js";

export async function onRequestGet({ request, env }) {
  try {
    if (!env?.LEADS_DB) return decidePage("Unavailable", "<p>Service temporarily unavailable.</p>");
    return await decideBooking(env, new URL(request.url).searchParams.get("token") || "", false);
  } catch (e) {
    console.error("[booking-decline]", e?.message);
    return decidePage("Error", "<p>Something went wrong. Please try again.</p>");
  }
}
