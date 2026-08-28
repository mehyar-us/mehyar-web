import { callMehyarsoftAdmin } from "../_shared/upstreamAdmin.js";

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const days = Math.max(1, Math.min(Number(url.searchParams.get("days") || 14), 30));
    const upstream = await callMehyarsoftAdmin(env, `/v1/admin/calendar/availability?days=${days}`);
    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok || payload?.ok === false) {
      return Response.json(
        { ok: false, error: "calendar_unavailable", message: "Live availability is temporarily unavailable. Please try again shortly or email info@mehyar.us." },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    }
    return Response.json(
      {
        ok: true,
        timezone: payload.timezone,
        duration_minutes: payload.duration_minutes,
        buffer_minutes: payload.buffer_minutes,
        min_notice_hours: payload.min_notice_hours,
        work_hours: payload.work_hours,
        slots: Array.isArray(payload.slots) ? payload.slots : [],
      },
      { headers: { "cache-control": "public, max-age=30, s-maxage=30" } },
    );
  } catch (error) {
    return Response.json(
      { ok: false, error: "calendar_unavailable", message: "Live availability is temporarily unavailable. Please try again shortly or email info@mehyar.us." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
