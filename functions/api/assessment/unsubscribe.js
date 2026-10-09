// functions/api/assessment/unsubscribe.js
// GET /api/assessment/unsubscribe?token=act_...
// One-click unsubscribe (CAN-SPAM) for assessment-call marketing follow-ups.
// The prefill token doubles as the authenticator — no login needed.
// Idempotent; renders a plain confirmation page.

import { sha256hex } from "../_shared/assessmentDiagnose.js";

const CONFIRM_HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Unsubscribed</title></head>
<body style="font-family:system-ui,sans-serif;max-width:560px;margin:48px auto;padding:0 20px;color:#1a1a1a">
<h1>You're unsubscribed</h1>
<p>You won't receive any more marketing follow-ups about the Audit My Business assessment.</p>
<p>Transactional emails about a purchase you made are unaffected.</p>
<p><a href="https://mehyar.us/privacy-policy/">Privacy policy</a> · <a href="https://mehyar.us/terms/">Terms</a></p>
</body></html>`;

export async function onRequestGet({ request, env }) {
  try {
    const token = new URL(request.url).searchParams.get("token") || "";
    if (token.startsWith("act_") && env?.LEADS_DB) {
      const tokenHash = await sha256hex("assessment-prefill|" + token);
      const tok = await env.LEADS_DB.prepare(
        "SELECT session_id FROM assessment_prefill_tokens WHERE token_hash = ?"
      ).bind(tokenHash).first();
      if (tok?.session_id) {
        await env.LEADS_DB.prepare(
          "UPDATE assessment_sessions SET marketing_opt_out = 1, updated_at = ? WHERE id = ?"
        ).bind(new Date().toISOString(), tok.session_id).run();
      }
    }
    return new Response(CONFIRM_HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
  } catch (e) {
    console.error("[assessment/unsubscribe]", e?.message);
    return new Response(CONFIRM_HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
  }
}
