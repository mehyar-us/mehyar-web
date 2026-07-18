// /api/mayor/__test — diagnostic endpoint. Always returns ok with timestamp + env var state.
// Used to verify the deployed function bundle is actually current.
export async function onRequestGet({ request, env }) {
  const env_keys = Object.keys(env || {});
  const email_related = env_keys.filter(k => /email|cloud|api|key|token|cf/i.test(k));
  const data = {
    ok: true,
    test: "mayor_test_endpoint",
    deployed_at: "2026-07-18T17:11Z",
    build: "DIGEST_FIX_V3",
    env_total_keys: env_keys.length,
    env_email_related_keys: email_related.slice(0, 30),
    cf_email_account_id: !!env?.CF_EMAIL_ACCOUNT_ID,
    cf_email_api_key_len: (env?.CF_EMAIL_API_KEY || '').length,
    cloudflare_email_len: (env?.CLOUDFLARE_EMAIL || '').length,
    cloudflare_api_key_len: (env?.CLOUDFLARE_API_KEY || '').length,
    cloudflare_api_token_len: (env?.CLOUDFLARE_API_TOKEN || '').length,
    gov_ingest_token_len: (env?.GOV_INGEST_TOKEN || '').length,
    mayor_digest_from_email: env?.MAYOR_DIGEST_FROM_EMAIL || '(unset)',
  };
  return new Response(JSON.stringify(data, null, 2), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
