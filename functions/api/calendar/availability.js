import { callMehyarsoftAdmin } from "../_shared/upstreamAdmin.js";

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const days = Math.max(1, Math.min(Number(url.searchParams.get("days") || 14), 30));
    const upstream = await callMehyarsoftAdmin(env, `/v1/admin/calendar/availability?days=${days}`);
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": upstream.ok ? "public, max-age=30, s-maxage=30" : "no-store",
      },
    });
  } catch (error) {
    return Response.json({ ok: false, error: "calendar_unavailable", message: String(error?.message || error) }, { status: 503 });
  }
}
