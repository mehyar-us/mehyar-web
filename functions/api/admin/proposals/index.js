import { verifyAdminToken, json } from "../../_shared/adminAuth.js";
import { callProposalStudio } from "../../_shared/proposalStudio.js";

export async function onRequestGet({ request, env }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  try {
    const response = await callProposalStudio(env, "/v1/admin/proposals");
    return new Response(response.body, { status: response.status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  } catch (error) {
    return json({ ok: false, error: "proposal_studio_unavailable", message: String(error?.message || error) }, 503, request, env);
  }
}

export async function onRequestPost({ request, env }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  const body = await request.text();
  try {
    const response = await callProposalStudio(env, "/v1/admin/proposals", { method: "POST", body });
    return new Response(response.body, { status: response.status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  } catch (error) {
    return json({ ok: false, error: "proposal_studio_unavailable", message: String(error?.message || error) }, 503, request, env);
  }
}
