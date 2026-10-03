// Legacy cron fallback + future TikTok pollers.
// POST /api/social/ingest {account, kind, author, author_name, text, ref_id}
// Runs the same router + idempotency pipeline as the Meta webhook.
import { processInbound } from "./webhook.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}

export async function onRequestPost({ request, env }) {
  const evt = await request.json().catch(() => null);
  if (!evt || typeof evt !== "object") return json({ ok: false, reason: "bad_json" }, 400);
  const out = await processInbound(env, {
    account: evt.account,
    kind: evt.kind || "dm",
    author: evt.author,
    author_name: evt.author_name,
    text: evt.text,
    ref_id: evt.ref_id,
  });
  return json(out, out.ok ? 200 : 400);
}

export async function onRequestGet() {
  return json({ ok: true, service: "social-inbox-ingest" });
}
