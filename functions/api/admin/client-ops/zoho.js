import { verifyAdminToken, json } from "../../_shared/adminAuth.js";
import { callMehyarsoftAdmin } from "../../_shared/upstreamAdmin.js";

export async function onRequestGet({ request, env }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  const action = new URL(request.url).searchParams.get("action") || "status";
  const path = action === "connect" ? "/v1/integrations/zoho/oauth/start" : "/v1/admin/calendar/status";
  try {
    const upstream = await callMehyarsoftAdmin(env, path);
    const payload = await upstream.json().catch(() => ({}));
    return json(payload, upstream.status, request, env);
  } catch (error) {
    return json({ ok: false, error: "zoho_upstream_unavailable", message: String(error?.message || error) }, 503, request, env);
  }
}
