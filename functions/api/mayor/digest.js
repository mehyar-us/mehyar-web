// /api/mayor/digest — Daily + weekly email digest to info@mehyar.us
// Sends a summary of today's mayor activity (discovery, outreach, followups,
// replies, pipeline). Renders as both text + HTML.
//
// Cron: daily at 6 PM ET, weekly on Mon 9 AM ET.

import { verifyAdminToken, json, corsHeaders } from "../_shared/adminAuth.js";
import { ensureMayorSchema, recentEvents, listReplies, getSetting } from "./_shared/mayorDb.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

async function bearerAccepted(request, env) {
  const h = request.headers.get("authorization") || "";
  if (!h.startsWith("Bearer ")) return false;
  const tok = h.slice(7);
  if (tok && env?.GOV_INGEST_TOKEN && tok === env.GOV_INGEST_TOKEN) return true;
  const a = await verifyAdminToken(request, env);
  return a.ok;
}

function escHtml(s) {
  return String(s || "").replace(/[<>&]/g, ch => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[ch]));
}

async function fetchStats(env) {
  if (!env?.LEADS_DB) return {};
  const today = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const out = {};
  try {
    const todaySent = await env.LEADS_DB.prepare(
      `SELECT COUNT(*) AS n FROM prospect_sends WHERE substr(attempted_at,1,10) = ?`
    ).bind(today).first();
    out.today_sent = todaySent?.n || 0;
    const weekSent = await env.LEADS_DB.prepare(
      `SELECT COUNT(*) AS n FROM prospect_sends WHERE attempted_at >= ?`
    ).bind(since).first();
    out.week_sent = weekSent?.n || 0;
    const discovered = await env.LEADS_DB.prepare(
      `SELECT COUNT(*) AS n FROM prospects WHERE substr(created_at,1,10) = ?`
    ).bind(today).first();
    out.today_discovered = discovered?.n || 0;
    const pipeline = await env.LEADS_DB.prepare(
      `SELECT COUNT(*) AS n FROM prospects WHERE status IN ('qualified','engaged','negotiation')`
    ).first();
    out.pipeline_count = pipeline?.n || 0;
    const replied = await env.LEADS_DB.prepare(
      `SELECT COUNT(*) AS n FROM mayor_replies WHERE substr(received_at,1,10) = ?`
    ).bind(today).first();
    out.today_replies = replied?.n || 0;
  } catch (_) { /* tables may not exist yet */ }
  return out;
}

async function renderDigest(env, { mode = "daily" } = {}) {
  await ensureMayorSchema(env);
  const today = new Date().toISOString().slice(0, 10);
  const events = await recentEvents(env, mode === "weekly" ? 80 : 30);
  const stats = await fetchStats(env);
  const replies = await listReplies(env, { needsAction: true, limit: 5 });

  // Group events by kind
  const groups = { discovery: [], outreach: [], followup: [], pause: [], other: [] };
  for (const e of events) {
    const k = e.kind in groups ? e.kind : "other";
    groups[k].push(e);
  }

  const subj = `[Mayor] ${today} ${mode === "weekly" ? "weekly" : "daily"} digest — ${stats.today_sent || 0} sent${stats.today_replies ? `, ${stats.today_replies} replies` : ""}`;

  // Plain-text body
  const lines = [];
  lines.push(`Mayor ran the ${mode} loops. Here's what happened:`);
  lines.push("");
  if (groups.discovery.length) {
    lines.push("DISCOVERY");
    for (const e of groups.discovery.slice(0, 5)) lines.push(`  • ${e.summary}`);
    lines.push("");
  }
  if (groups.outreach.length) {
    lines.push("OUTREACH");
    for (const e of groups.outreach.slice(0, 5)) lines.push(`  • ${e.summary}`);
    lines.push("");
  }
  if (groups.followup.length) {
    lines.push("FOLLOW-UP");
    for (const e of groups.followup.slice(0, 5)) lines.push(`  • ${e.summary}`);
    lines.push("");
  }
  if (replies.length) {
    lines.push("REPLIES NEEDING ACTION");
    for (const r of replies) lines.push(`  • ${r.from_email}: ${r.classification || "?"} → ${r.recommended_action || "?"}`);
    lines.push("");
  }
  lines.push("PIPELINE");
  lines.push(`  ${stats.pipeline_count || 0} active prospects · ${stats.week_sent || 0} emails this week`);
  lines.push("");
  lines.push(`Open admin → https://mehyar.us/admin/mayor`);
  lines.push("Pause Mayor → POST /api/admin/mayor/pause with bearer token");
  lines.push("");
  lines.push("— Mayor (running on mehyar.us)");
  const text = lines.join("\n");

  // HTML body
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;line-height:1.55;color:#111;max-width:640px;margin:0 auto;padding:16px">
  <h2 style="margin:0 0 8px">🏛 Mayor ${mode} digest</h2>
  <p style="color:#555;margin:0 0 16px">${new Date().toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" })}</p>
  ${groups.discovery.length ? `
  <h3 style="margin:16px 0 6px;border-bottom:1px solid #eee;padding-bottom:4px">🔍 Discovery</h3>
  <ul style="margin:0;padding-left:20px">${groups.discovery.slice(0, 5).map(e => `<li>${escHtml(e.summary)}</li>`).join("")}</ul>` : ""}
  ${groups.outreach.length ? `
  <h3 style="margin:16px 0 6px;border-bottom:1px solid #eee;padding-bottom:4px">✉ Outreach</h3>
  <ul style="margin:0;padding-left:20px">${groups.outreach.slice(0, 5).map(e => `<li>${escHtml(e.summary)}</li>`).join("")}</ul>` : ""}
  ${groups.followup.length ? `
  <h3 style="margin:16px 0 6px;border-bottom:1px solid #eee;padding-bottom:4px">↪ Follow-up</h3>
  <ul style="margin:0;padding-left:20px">${groups.followup.slice(0, 5).map(e => `<li>${escHtml(e.summary)}</li>`).join("")}</ul>` : ""}
  ${replies.length ? `
  <h3 style="margin:16px 0 6px;border-bottom:1px solid #eee;padding-bottom:4px">💬 Replies needing action</h3>
  <ul style="margin:0;padding-left:20px">${replies.map(r => `<li><strong>${escHtml(r.from_email)}</strong>: ${escHtml(r.classification || "?")} → ${escHtml(r.recommended_action || "?")}</li>`).join("")}</ul>` : ""}
  <h3 style="margin:16px 0 6px;border-bottom:1px solid #eee;padding-bottom:4px">📊 Pipeline</h3>
  <p>${stats.pipeline_count || 0} active prospects · ${stats.today_sent || 0} emails today · ${stats.week_sent || 0} this week</p>
  <p style="margin-top:24px">
    <a href="https://mehyar.us/admin/mayor" style="display:inline-block;background:#0d9488;color:white;padding:10px 16px;border-radius:6px;text-decoration:none">Open Mayor Console</a>
  </p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
  <p style="color:#888;font-size:12px">Mayor is running on mehyar.us. Replies to this email go to info@mehyar.us.</p>
</div>`;

  return { subject: subj, text, html, stats, event_count: events.length };
}

async function dispatchDigest(env, rendered, to = "info@mehyar.us") {
  // Public account id — safe to default since it isn't a credential.
  const accountId = env?.CF_EMAIL_ACCOUNT_ID || "621600637337cc1c9ecb7095508bc732";
  // Try the dedicated send-token first (40-char scoped), fall back to Global Key pair.
  const sendToken = env?.CF_EMAIL_SEND_TOKEN || env?.CF_EMAIL_API_KEY;
  const apiEmail  = env?.CLOUDFLARE_EMAIL || env?.CF_EMAIL_API_EMAIL || "";
  const apiKey    = env?.CLOUDFLARE_API_KEY || env?.CF_EMAIL_API_KEY || "";
  if (!sendToken && (!apiEmail || !apiKey)) {
    return { ok: false, error: "email_service_not_configured",
             diagnostic: { accountId_set: !!env?.CF_EMAIL_ACCOUNT_ID,
                           sendToken_set: !!sendToken,
                           apiEmail_set: !!apiEmail,
                           apiKey_set: !!apiKey,
                           env_keys_relevant: Object.keys(env).filter(k => /email|cloud/i.test(k)).slice(0,12) } };
  }
  const authHeader = sendToken
    ? { "Authorization": `Bearer ${sendToken}` }
    : { "X-Auth-Email": apiEmail, "X-Auth-Key": apiKey };
  // Per-zone gate: external sends only deliver from team@rochelle.love today.
  // mehyar.us returns 200 OK but delivered:[], meaning DNS/SPF/DKIM not yet propagated
  // post-onboard. Use rochelle.love as the live sender; override via MAYOR_DIGEST_FROM_EMAIL.
  const fromEmail = env?.MAYOR_DIGEST_FROM_EMAIL || "team@rochelle.love";
  const replyTo   = env?.MAYOR_DIGEST_REPLY_TO   || "info@mehyar.us";
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/send`;
  // CF Email Service payload (verified 2026-07-17/18). Both flat-string and array shapes work.
  const payload = {
    from: fromEmail,
    to: to,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    reply_to: replyTo,
  };
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader },
      body: JSON.stringify(payload),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data?.success === false) {
      const err = data?.errors?.[0];
      return { ok: false, error: err?.message || `HTTP ${resp.status}`,
               code: err?.code || resp.status,
               delivered: data?.result?.delivered || [],
               permanent_bounces: data?.result?.permanent_bounces || [] };
    }
    return { ok: true, provider_id: data?.result?.message_id || null,
             delivered: data?.result?.delivered || [],
             queued: data?.result?.queued || [] };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

export async function onRequestPost({ request, env }) {
  if (!await bearerAccepted(request, env)) {
    return json({ ok: false, error: "unauthorized" }, 401, request, env);
  }
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") || "daily";
  const rendered = await renderDigest(env, { mode });
  const result = await dispatchDigest(env, rendered, url.searchParams.get("to") || "info@mehyar.us");
  if (result.ok) {
    const kind = mode === "weekly" ? "weekly_digest" : "digest";
    await env.LEADS_DB.prepare(
      `INSERT INTO mayor_events (id, kind, loop, summary, details_json, digest_sent)
       VALUES (?, ?, ?, ?, ?, 1)`
    ).bind(
      crypto.randomUUID(), kind, "digest",
      `Digest sent (${rendered.event_count} events)`,
      JSON.stringify({ provider_id: result.provider_id, mode }),
    ).run();
  }
  return json({ ok: result.ok, error: result.error || null, ...rendered.stats }, result.ok ? 200 : 500, request, env);
}

// Preview the digest HTML/text without sending (handy for testing)
export async function onRequestGet({ request, env }) {
  if (!await bearerAccepted(request, env)) {
    return json({ ok: false, error: "unauthorized" }, 401, request, env);
  }
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") || "daily";
  const rendered = await renderDigest(env, { mode });
  return json({ ok: true, mode, ...rendered }, 200, request, env);
}