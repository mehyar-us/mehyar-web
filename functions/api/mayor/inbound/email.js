// /api/mayor/inbound/email — POST-only webhook for inbound email.
//
// Auth: ?token=... shared secret OR Authorization: Bearer <token>
//        Configured via wrangler.toml: INBOUND_EMAIL_TOKEN
//
// Body shape (CF Email Routing compatible — wraps MIME in JSON):
//   {
//     "from": "owner@brooklynbakery.com",
//     "to":   "team@mehyar.us",
//     "subject": "Re: Quick question for Brooklyn Bakery",
//     "text": "...raw text body...",
//     "Message-ID": "<...>",
//     "Date": "...",
//     "Spam-Score": ...
//   }
//
// What it does:
//   1. Match the From: address against the prospects.email column.
//   2. If matched, insert prospect_replies row with a classification:
//      - List-Unsubscribe / "unsubscribe" / "stop" → unsubscribe/stop
//      - "auto-reply" / "out of office" header hint → out_of_office
//      - Words: "interested","let's talk","send it","book","schedule" → interest
//      - Words: "not interested","no thanks","remove me" → not_interested
//      - Words: "too expensive","already have","not now","later" → objection
//      - Default: warm (positive but ambiguous)
//   3. If INBOUND_AUTO_REPLY=1, send an auto-reply via CF Email Service.
//      (interest → "great, here's a calendar link"; objection → soft nudge;
//       unsubscribe → silent confirmation; out_of_office → silent)
//
// Returns: { ok, matched_prospect_id?, reply_id?, classification, auto_reply? }

import { verifyAdminToken, json, corsHeaders } from "../../_shared/adminAuth.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

async function bearerAccepted(request, env, body) {
  // Accept either:
  //   Authorization: Bearer <token>
  //   ?token=<token> in URL
  //   { token: "..." } in body (less safe but easy for CF Email Routing)
  const authHeader = request.headers.get("authorization") || "";
  const url = new URL(request.url);
  const urlToken = url.searchParams.get("token");
  const expected = env?.INBOUND_EMAIL_TOKEN;
  if (!expected) return false;
  if (authHeader === `Bearer ${expected}`) return true;
  if (urlToken && urlToken === expected) return true;
  if (body && body.token && body.token === expected) return true;
  // Fallback to admin token (so the dashboard can simulate via the same endpoint)
  if (env?.GOV_INGEST_TOKEN) {
    if (authHeader === `Bearer ${env.GOV_INGEST_TOKEN}`) return true;
    if (urlToken === env.GOV_INGEST_TOKEN) return true;
  }
  const a = await verifyAdminToken(request, env);
  return a.ok;
}

function classify(subject, body) {
  const text = `${subject || ""} ${body || ""}`.toLowerCase();
  if (/\bunsubscribe\b|\bremove me\b|\bstop\b/i.test(text)) return "unsubscribe";
  if (/^out of office|^ooo\b|automated response|auto-?reply/i.test(text)) return "out_of_office";
  if (/\binterested\b|\blet's (talk|chat|meet|do it)\b|\bsend it\b|\bbook(ed|ing)?\b|\bschedule\b|\byes please\b|\bwhen can we\b|\b(i'm|im) the owner\b|\bcall me\b/i.test(text)) return "interest";
  if (/\bnot interested\b|\bno thanks\b|\bremove\b|\bunsubscribe\b|\bstop emailing\b/i.test(text)) return "not_interested";
  if (/\btoo expensive\b|\balready have\b|\bnot now\b|\blater\b|\bbudget\b|\bshopify\b|\bwordpress\b|\bvendor\b/i.test(text)) return "objection";
  return "warm";
}

function suggestedReply(classification, prospect, env) {
  const biz = prospect?.business_name || "your business";
  switch (classification) {
    case "interest":
      return `Great — let's set up a 20-minute call. Pick a slot here: https://mehyar.us/booking or reply with 2-3 times that work for you this week. I'll send a 1-page scope doc + audit preview 24h before the call. — Mehyar, MehyarSoft`;
    case "objection":
      return `Got it — sounds like the timing isn't right. I'll move you to a 90-day check-in. If something shifts sooner, just hit reply with "now" and I'll reopen the conversation. — Mehyar`;
    case "not_interested":
      return `Understood — no further emails. If anything changes in the next year, my DMs are open. — Mehyar, MehyarSoft`;
    case "unsubscribe":
    case "stop":
      return null;
    case "out_of_office":
      return null;
    default:
      return `Thanks for the reply — happy to answer anything specific. If you want a 5-minute Loom walking through the three fixes I'd make to ${biz}, just hit reply with "send it." — Mehyar`;
  }
}

async function sendAutoReply(env, from, subject, body, prospect) {
  const acctId = env?.CF_EMAIL_ACCOUNT_ID || env?.CLOUDFLARE_ACCOUNT_ID;
  const globalKey = env?.CF_EMAIL_GLOBAL_KEY || env?.CLOUDFLARE_API_TOKEN;
  if (!acctId || !globalKey) return { ok: false, error: "email_service_offline" };

  const fromEmail = env?.MAYOR_FROM_EMAIL || "team@mehyar.us";
  const replyTo = env?.MAYOR_REPLY_TO || fromEmail;

  try {
    const resp = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acctId}/email/sending/send`, {
      method: "POST",
      headers: {
        "X-Auth-Email": env?.CLOUDFLARE_EMAIL || "mrswelim@gmail.com",
        "X-Auth-Key": globalKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: from }] }],
        from: { email: fromEmail, name: "MehyarSoft" },
        reply_to: { email: replyTo },
        subject: subject.startsWith("Re:") ? subject : `Re: ${subject}`,
        content: [{ type: "text/plain", value: body }],
      }),
    });
    const text = await resp.text();
    let parsed = {};
    try { parsed = JSON.parse(text); } catch {}
    if (resp.ok && parsed?.success) {
      return { ok: true, provider_id: parsed?.result?.id || null, delivered: parsed?.result?.delivered || [] };
    }
    return { ok: false, error: parsed?.errors?.[0]?.message || text.slice(0, 200) };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

export async function onRequestPost({ request, env }) {
  let body = {};
  try { body = await request.json(); } catch {}
  if (!await bearerAccepted(request, env, body)) {
    return json({ ok: false, error: "unauthorized" }, 401, request, env);
  }
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  const from = body?.from || body?.From || body?.sender;
  const subject = body?.subject || body?.Subject || "(no subject)";
  const text = body?.text || body?.text_plain || body?.body || body?.Body || "";
  const messageId = body?.["Message-ID"] || body?.message_id || null;

  if (!from) {
    return json({ ok: false, error: "missing_from", message: "Body must include from address." }, 400, request, env);
  }

  // Extract email from "Name <email@x.com>" format
  const emailMatch = from.match(/<([^>]+)>/) || [null, from];
  const fromEmail = (emailMatch[1] || from).trim().toLowerCase();

  // Match against prospects.email OR derive prospect_id from a custom header
  let prospect = null;
  try {
    // Try direct email match first
    const { results: prsByEmail } = await env.LEADS_DB.prepare(
      `SELECT id, business_name, email FROM prospects WHERE LOWER(email) = ?`
    ).bind(fromEmail).all();
    prospect = prsByEmail?.[0] || null;

    // Fallback: try X-Prospect-Id header / body field
    if (!prospect) {
      const prospectId = body?.prospect_id || body?.["X-Prospect-Id"];
      if (prospectId) {
        const { results: prsById } = await env.LEADS_DB.prepare(
          `SELECT id, business_name, email FROM prospects WHERE id = ?`
        ).bind(prospectId).all();
        prospect = prsById?.[0] || null;
      }
    }
  } catch (e) {
    return json({ ok: false, error: "prospect_lookup_failed", message: String(e?.message || e) }, 500, request, env);
  }

  const classification = classify(subject, text);

  // If no prospect match + classification is unsubscribe, just record a global suppression
  if (!prospect && (classification === "unsubscribe" || classification === "stop")) {
    try {
      await env.LEADS_DB.prepare(`
        INSERT INTO mayor_events (id, kind, loop, summary, details_json, created_at)
        VALUES (?, 'followup', 'global_unsubscribe', ?, ?, datetime('now'))
      `).bind(
        crypto.randomUUID(),
        `Global unsubscribe from ${fromEmail} (no prospect match)`,
        JSON.stringify({ from_email: fromEmail, subject, classification })
      ).run();
    } catch (_) {}
    return json({ ok: true, matched_prospect_id: null, classification, note: "global unsubscribe recorded (no prospect match)" }, 200, request, env);
  }

  if (!prospect) {
    return json({ ok: false, error: "prospect_not_matched", from: fromEmail, message: "No prospect with that email. Pass prospect_id in body to force-attach." }, 404, request, env);
  }

  // Insert prospect_replies row
  const replyId = crypto.randomUUID();
  try {
    await env.LEADS_DB.prepare(`
      INSERT INTO prospect_replies
        (id, prospect_id, send_id, received_at, from_email, subject,
         body_excerpt, classification, manually_synced, created_action)
      VALUES (?, ?, NULL, datetime('now'), ?, ?, ?, ?, 0, ?)
    `).bind(
      replyId,
      prospect.id,
      fromEmail,
      subject,
      (text || "").slice(0, 4000),
      classification,
      classification === "unsubscribe" || classification === "stop" ? "suppression_added" : "note_appended",
    ).run();
  } catch (e) {
    return json({ ok: false, error: "reply_insert_failed", message: String(e?.message || e) }, 500, request, env);
  }

  // Update prospect status
  try {
    if (classification === "interest") {
      await env.LEADS_DB.prepare(`UPDATE prospects SET status = 'replied', updated_at = datetime('now') WHERE id = ?`).bind(prospect.id).run();
    } else if (classification === "unsubscribe" || classification === "stop") {
      await env.LEADS_DB.prepare(`UPDATE prospects SET status = 'unsubscribed', consent_state = 'unsubscribed', updated_at = datetime('now') WHERE id = ?`).bind(prospect.id).run();
    } else if (classification === "not_interested" || classification === "lost") {
      await env.LEADS_DB.prepare(`UPDATE prospects SET status = 'not_interested', updated_at = datetime('now') WHERE id = ?`).bind(prospect.id).run();
    }
  } catch (_) {}

  // Audit event
  try {
    await env.LEADS_DB.prepare(`
      INSERT INTO mayor_events (id, kind, loop, summary, details_json, created_at)
      VALUES (?, 'followup', 'inbound_classified', ?, ?, datetime('now'))
    `).bind(
      crypto.randomUUID(),
      `${classification} reply from ${prospect.business_name} (${fromEmail}): ${subject}`,
      JSON.stringify({ reply_id: replyId, prospect_id: prospect.id, classification, message_id: messageId })
    ).run();
  } catch (_) {}

  // Optional auto-reply
  let autoReply = null;
  if (env?.INBOUND_AUTO_REPLY === "1" || env?.INBOUND_AUTO_REPLY === 1) {
    const replyText = suggestedReply(classification, prospect, env);
    if (replyText) {
      autoReply = await sendAutoReply(env, fromEmail, subject, replyText, prospect);
      if (autoReply?.ok) {
        try {
          await env.LEADS_DB.prepare(`
            INSERT INTO mayor_events (id, kind, loop, summary, details_json, created_at)
            VALUES (?, 'followup', 'auto_reply_sent', ?, ?, datetime('now'))
          `).bind(
            crypto.randomUUID(),
            `Auto-reply sent to ${prospect.business_name} (${fromEmail})`,
            JSON.stringify({ reply_id: replyId, prospect_id: prospect.id, provider_id: autoReply.provider_id })
          ).run();
        } catch (_) {}
      }
    }
  }

  return json({
    ok: true,
    matched_prospect_id: prospect.id,
    prospect_business: prospect.business_name,
    reply_id: replyId,
    classification,
    from_email: fromEmail,
    subject,
    auto_reply: autoReply,
    message_id: messageId,
  }, 200, request, env);
}