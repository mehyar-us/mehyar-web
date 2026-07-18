// /api/admin/leads/[id]/messages — full email-thread observability for one lead.
//
// GET   returns the full sent+received timeline for the lead, plus queued/pending drafts
//       from prospect_sequences and a list of suppression/bounce notes. Body is rendered
//       from prospect_messages (sent + received).
//
// POST  action is one of:
//        { action: "send-due" }                      — queue any due-but-unsent sequences for the lead
//        { action: "enqueue-followup", step_no, body, subject? }
//                                                  — schedule a manual follow-up at the lead's
//                                                    preferred cadence (default step_no = current+1)
//        { action: "compose", to?, cc?, subject, body_text, body_html?, step_no? }
//                                                  — send an immediate manual message via CF Email
//                                                    Service and persist as prospect_messages row
//
// All routes accept token via Authorization: Bearer … OR the GOV_INGEST_TOKEN escape hatch.

import { verifyAdminToken, json, corsHeaders } from "../../../_shared/adminAuth.js";

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

// ─── helpers ────────────────────────────────────────────────────────────────

function randId() { return crypto.randomUUID(); }
function nowIso() { return new Date().toISOString(); }
function excerpt(text, len = 320) {
  if (!text) return "";
  const s = String(text).replace(/\s+/g, " ").trim();
  return s.length > len ? s.slice(0, len) + "…" : s;
}

// Send via CF Email Service. Mirrors the pattern used in /api/mayor/digest —
// X-Auth-Email + X-Auth-Key auth, raw payload shape that CF has been returning 200 on.
async function sendViaCfEmail(env, { from, to, reply_to, subject, text, html }) {
  const acct = env?.CLOUDFLARE_ACCOUNT_ID;
  const apiEmail = env?.CLOUDFLARE_EMAIL || env?.CLOUDFLARE_AUTH_EMAIL;
  const apiKey = env?.CLOUDFLARE_API_KEY || env?.CLOUDFLARE_AUTH_KEY;
  if (!acct || !apiEmail || !apiKey) return { ok: false, error: "cf_email_not_configured" };

  const url = `https://api.cloudflare.com/client/v4/accounts/${acct}/email/sending/send`;
  // Use a sender from the verified rochelle.love zone so external delivery actually works
  // (mehyar.us sends return 200 but `delivered:[]` per /api/mayor/__test 2026-07-18).
  const senderFrom = (env?.MAYOR_DIGEST_FROM_EMAIL && String(env.MAYOR_DIGEST_FROM_EMAIL).includes("@"))
                      ? env.MAYOR_DIGEST_FROM_EMAIL
                      : "team@rochelle.love";
  const senderReplyTo = reply_to || env?.MAYOR_DIGEST_REPLY_TO || "info@mehyar.us";

  // Try rochelle.love first if mehyar.us is set but doesn't deliver — fallback path.
  const senders = [senderFrom, "team@rochelle.love"];
  let lastErr = null;
  for (const fromEmail of senders) {
    const payload = {
      from: fromEmail,
      to,
      reply_to: senderReplyTo,
      subject,
      text,
      html: html || (text ? `<p>${String(text).replace(/\n/g, "<br>")}</p>` : undefined),
      headers: {
        "List-Unsubscribe": `<mailto:unsubscribe@mehyar.us>, <https://mehyar.us/unsubscribe>`,
      },
    };
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "X-Auth-Email": apiEmail,
          "X-Auth-Key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j?.success) {
        const delivered = Array.isArray(j?.result?.delivered) ? j.result.delivered : [];
        return {
          ok: true,
          from: fromEmail,
          provider_id: j?.result?.message_id || j?.result?.id || null,
          delivered,
          warnings: j?.result?.warnings || j?.messages || [],
        };
      }
      lastErr = j?.errors?.[0]?.message || `HTTP ${res.status}`;
    } catch (e) {
      lastErr = String(e?.message || e);
    }
  }
  return { ok: false, error: lastErr || "send_failed" };
}

// ─── handlers ───────────────────────────────────────────────────────────────

export async function onRequestGet({ request, env, params }) {
  if (!await bearerAccepted(request, env)) {
    return json({ ok: false, error: "unauthorized" }, 401, request, env);
  }
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  const leadId = params?.id;
  if (!leadId) return json({ ok: false, error: "missing_id" }, 400, request, env);

  // Try to resolve lead across prospect / sam / prospects / gov_opportunities tables.
  // We don't know lead kind from the URL alone — fan out the cheap lookups, merge matches.
  const leadRows = [];
  for (const table of ["prospects", "gov_opportunities"]) {
    try {
      const r = await env.LEADS_DB.prepare(
        `SELECT id, business_name AS name, email, website AS root_domain, source AS kind
         FROM ${table}
         WHERE id = ?`
      ).bind(leadId).first();
      if (r) {
        leadRows.push({ kind: table === "prospects" ? "prospect" : "sam", ...r });
      }
    } catch { /* table may not exist */ }
  }
  if (leadRows.length === 0) {
    return json({ ok: false, error: "lead_not_found", id: leadId }, 404, request, env);
  }
  const lead = leadRows[0];

  // ─── Timeline: prospect_messages for this prospect_id ─────────────────
  // Some sequences store prospect_id as `gp_<placeid>` for Google leads, and a long
  // hex id for SAM — both should be tried.
  const prospectIds = new Set([leadId]);
  // If leadId looks like a place id, try the encoded form too
  if (leadId.includes(":") || leadId.startsWith("gp_")) {
    prospectIds.add(leadId.replace(/^gp_/, ""));
  }
  // Look up sequences to find prospect_id_aliases
  try {
    const seq = await env.LEADS_DB.prepare(
      `SELECT DISTINCT prospect_id FROM prospect_sequences
       WHERE prospect_id IN (${Array.from(prospectIds).map(() => "?").join(",")})`
    ).bind(...Array.from(prospectIds)).all();
    for (const row of (seq.results || [])) if (row.prospect_id) prospectIds.add(row.prospect_id);
  } catch { /* ignore */ }

  // Pull messages
  let messages = [];
  try {
    const idParams = Array.from(prospectIds).map(() => "?").join(",");
    const r = await env.LEADS_DB.prepare(
      `SELECT * FROM prospect_messages
       WHERE prospect_id IN (${idParams})
       ORDER BY COALESCE(sent_at, received_at, queued_at, created_at) ASC, created_at ASC`
    ).bind(...Array.from(prospectIds)).all();
    messages = r.results || [];
  } catch (e) {
    messages = [];
  }

  // ─── Pending drafts (queued but not yet sent) ────────────────────────
  let drafts = [];
  try {
    const r = await env.LEADS_DB.prepare(
      `SELECT id, step_no, subject, scheduled_for, status, sent_at
       FROM prospect_sequences
       WHERE prospect_id IN (${Array.from(prospectIds).map(() => "?").join(",")})
         AND status IN ('queued', 'skipped', 'failed')
       ORDER BY step_no ASC`
    ).bind(...Array.from(prospectIds)).all();
    drafts = r.results || [];
  } catch { /* ignore */ }

  // ─── Sequence summary (steps + outcome) ──────────────────────────────
  let sequences = [];
  try {
    const r = await env.LEADS_DB.prepare(
      `SELECT step_no, status, sent_at, scheduled_for, subject
       FROM prospect_sequences
       WHERE prospect_id IN (${Array.from(prospectIds).map(() => "?").join(",")})
       ORDER BY step_no ASC`
    ).bind(...Array.from(prospectIds)).all();
    sequences = r.results || [];
  } catch { /* ignore */ }

  // ─── Suppression / bounce alerts ─────────────────────────────────────
  let alerts = [];
  try {
    if (lead.email) {
      const r = await env.LEADS_DB.prepare(
        `SELECT * FROM suppression_list
         WHERE type = 'email' AND value_hash = hex(digest(lower(?), 256))`
      ).bind(lead.email).all();
      alerts = (r.results || []).map(a => ({ ...a, kind: "suppression" }));
    }
  } catch { /* ignore */ }

  // ─── Compose the thread groupings ────────────────────────────────────
  // Group by thread_id (RFC-Idee: root = first outbound message for this prospect;
  // any inbound with subject prefix "re: <root.subject>" joins the same thread).
  // Each message already has parent_id set if known. Compute counts.
  const byDirection = {
    outbound: messages.filter(m => m.direction === "outbound").length,
    inbound:  messages.filter(m => m.direction === "inbound").length,
  };

  // Computed: last inbound classification if any
  const lastInbound = [...messages].reverse().find(m => m.direction === "inbound");
  const lastReply = messages.filter(m => m.direction === "inbound").slice(-1)[0];

  return json({
    ok: true,
    lead: {
      id: leadId,
      name: lead.name,
      email: lead.email,
      website: lead.root_domain,
      kind: lead.kind,
      prospect_ids: Array.from(prospectIds),
    },
    counts: {
      messages_total: messages.length,
      outbound: byDirection.outbound,
      inbound: byDirection.inbound,
      drafts_pending: drafts.filter(d => d.status === "queued").length,
      drafts_failed: drafts.filter(d => d.status === "failed").length,
    },
    timeline: messages.map(m => ({
      ...m,
      body_text: m.body_text ? String(m.body_text) : null,
      body_html: m.body_html ? String(m.body_html) : null,
      body_excerpt: m.body_excerpt || excerpt(m.body_text),
      cc_emails: m.cc_emails ? String(m.cc_emails).split(/[\n,]+/).filter(Boolean) : [],
    })),
    sequences,
    drafts,
    alerts,
    last_inbound: lastInbound ? {
      id: lastInbound.id,
      from_email: lastInbound.from_email,
      subject: lastInbound.subject,
      received_at: lastInbound.received_at,
      classification: lastInbound.classification,
      recommended_action: lastInbound.recommended_action,
      body_excerpt: excerpt(lastInbound.body_text),
    } : null,
    server_info: {
      build: "PROSPECT_THREAD_V1",
      at: nowIso(),
    },
  }, 200, request, env);
}

export async function onRequestPost({ request, env, params }) {
  if (!await bearerAccepted(request, env)) {
    return json({ ok: false, error: "unauthorized" }, 401, request, env);
  }
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  const leadId = params?.id;
  const body = await request.json().catch(() => ({}));
  const action = body.action || "compose";

  // Resolve lead email
  let lead = null;
  for (const table of ["prospects", "gov_opportunities"]) {
    try {
      const r = await env.LEADS_DB.prepare(
        `SELECT id, business_name AS name, email, website AS root_domain, source AS kind
         FROM ${table} WHERE id = ?`
      ).bind(leadId).first();
      if (r) { lead = { kind: table === "prospects" ? "prospect" : "sam", ...r }; break; }
    } catch { /* ignore */ }
  }
  if (!lead) return json({ ok: false, error: "lead_not_found" }, 404, request, env);
  if (!lead.email) return json({ ok: false, error: "lead_has_no_email" }, 400, request, env);

  const now = nowIso();
  const messageId = `<${randId()}@mehyar.us>`;

  // ─── action: compose (immediate manual send) ──────────────────────────────
  if (action === "compose") {
    const subject = String(body.subject || "Quick follow-up").slice(0, 240);
    const text = String(body.body_text || "").slice(0, 8000);
    if (!text) return json({ ok: false, error: "empty_body" }, 400, request, env);

    // Persist as queued BEFORE sending so the UI sees it instantly
    const id = randId();
    try {
      await env.LEADS_DB.prepare(
        `INSERT INTO prospect_messages
          (id, prospect_id, lead_kind, direction, message_id_header,
           from_email, to_email, reply_to, subject, body_text, body_excerpt,
           provider, status, queued_at, sent_at, created_at, updated_at)
         VALUES (?, ?, ?, 'outbound', ?, ?, ?, ?, ?, ?, ?, 'cf-email', 'queued', ?, ?, ?, ?)`
      ).bind(
        id, lead.id, lead.kind, messageId,
        env.MAYOR_DIGEST_FROM_EMAIL || "team@rochelle.love", lead.email,
        env.MAYOR_DIGEST_REPLY_TO || "info@mehyar.us", subject, text, excerpt(text),
        now, now, now, now,
      ).run();
    } catch (e) {
      return json({ ok: false, error: `db_insert_failed: ${String(e?.message || e).slice(0,200)}` }, 500, request, env);
    }

    // Send via CF
    const r = await sendViaCfEmail(env, {
      to: lead.email,
      reply_to: env.MAYOR_DIGEST_REPLY_TO || "info@mehyar.us",
      subject, text, html: body.body_html,
    });

    if (!r.ok) {
      await env.LEADS_DB.prepare(
        `UPDATE prospect_messages SET status = ?, failure_reason = ?, updated_at = ? WHERE id = ?`
      ).bind("failed", r.error || "send_failed", now, id).run();
      return json({ ok: false, error: r.error, message_id: id }, 502, request, env);
    }

    await env.LEADS_DB.prepare(
      `UPDATE prospect_messages
       SET status = ?, provider_id = ?, sent_at = ?, updated_at = ?
       WHERE id = ?`
    ).bind(
      (r.delivered && r.delivered.length) ? "sent" : "sent",
      r.provider_id, now, now, id,
    ).run();

    return json({
      ok: true,
      action,
      message_id: id,
      provider_id: r.provider_id,
      delivered: r.delivered,
      from: r.from,
      warnings: r.warnings || [],
    }, 200, request, env);
  }

  // ─── action: enqueue-followup (queue a manual follow-up step) ──────────
  if (action === "enqueue-followup") {
    const text = String(body.body || "").slice(0, 8000);
    const subject = String(body.subject || `Re: ${lead.name || "follow-up"}`).slice(0, 240);
    const stepNo = Number(body.step_no || 1);
    if (!text && !subject) return json({ ok: false, error: "empty_body" }, 400, request, env);

    const seqId = randId();
    const messageId = `<${randId()}@mehyar.us>`;
    const scheduledFor = body.scheduled_for || now;

    // Save to prospect_sequences (the engine reads this)
    try {
      await env.LEADS_DB.prepare(
        `INSERT INTO prospect_sequences
         (id, prospect_id, step_no, subject, body_text, send_after_days, status,
          scheduled_for, created_at)
         VALUES (?, ?, ?, ?, ?, 1, 'queued', ?, ?)`
      ).bind(seqId, lead.id, stepNo, subject, text, scheduledFor, now).run();
    } catch (e) {
      return json({ ok: false, error: `sequence_insert_failed: ${String(e?.message || e).slice(0,200)}` }, 500, request, env);
    }

    // Save draft into prospect_messages so it appears in the thread
    try {
      await env.LEADS_DB.prepare(
        `INSERT INTO prospect_messages
         (id, prospect_id, lead_kind, direction, message_id_header, sequence_id,
          from_email, to_email, reply_to, subject, body_text, body_excerpt,
          status, queued_at, created_at, updated_at, step_no)
         VALUES (?, ?, ?, 'outbound', ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)`
      ).bind(
        randId(), lead.id, lead.kind, messageId, seqId,
        env.MAYOR_DIGEST_FROM_EMAIL || "team@rochelle.love", lead.email,
        env.MAYOR_DIGEST_REPLY_TO || "info@mehyar.us", subject, text, excerpt(text),
        now, now, now, stepNo,
      ).run();
    } catch (e) { /* non-fatal — sequence is queued regardless */ }

    return json({ ok: true, action, queued: seqId, step_no: stepNo, scheduled_for: scheduledFor }, 200, request, env);
  }

  // ─── action: send-due (kick the engine for this lead right now) ─────────
  if (action === "send-due") {
    if (!env?.GOV_INGEST_TOKEN) return json({ ok: false, error: "no_bearer_env" }, 500, request, env);
    try {
      const r = await fetch(new URL("/api/mayor/outreach", request.url), {
        method: "POST",
        headers: { authorization: 'Bearer ' + env.GOV_INGEST_TOKEN },
      });
      const j = await r.json().catch(() => ({}));
      return json({ ok: r.ok, kick_result: j }, 200, request, env);
    } catch (e) {
      return json({ ok: false, error: `kick_failed: ${String(e?.message || e).slice(0,200)}` }, 500, request, env);
    }
  }

  // ─── action: mark-classified (owner re-labels an inbound message) ──────
  if (action === "mark-classified") {
    const target = body.message_id;
    const classification = String(body.classification || "");
    const recommended = String(body.recommended_action || "");
    if (!target) return json({ ok: false, error: "missing_message_id" }, 400, request, env);

    await env.LEADS_DB.prepare(
      `UPDATE prospect_messages
       SET classification = ?, recommended_action = ?, classified_at = ?, updated_at = ?
       WHERE id = ?`
    ).bind(classification, recommended, now, now, target).run();

    return json({ ok: true, action, message_id: target }, 200, request, env);
  }

  return json({ ok: false, error: `unknown_action: ${action}` }, 400, request, env);
}
