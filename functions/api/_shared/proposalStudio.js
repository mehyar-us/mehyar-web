export async function callProposalStudio(env, path, init = {}) {
  const base = (env?.PROPOSAL_STUDIO_API_BASE_URL || "https://studio-api.mehyar.us").replace(/\/$/, "");
  if (!env?.PROPOSAL_STUDIO_SERVICE_TOKEN) throw new Error("proposal_studio_service_token_missing");
  const headers = new Headers(init.headers || {});
  headers.set("x-mehyarsoft-service-token", env.PROPOSAL_STUDIO_SERVICE_TOKEN);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return fetch(`${base}${path}`, { ...init, headers, signal: init.signal || AbortSignal.timeout(15_000) });
}
