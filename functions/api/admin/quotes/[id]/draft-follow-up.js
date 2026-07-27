// POST /api/admin/quotes/:id/draft-follow-up
//
// Creates a reviewable prospect_drafts row for an open quote follow-up.
// It does not send anything. Owner review/approval still happens through
// /admin/money?focus=<draft_id> and /api/mayor/draft/:id/approve.

import { verifyAdminToken, json, corsHeaders } from "../../../_shared/adminAuth.js";
import { ensureMayorTasksSchema } from "../../../_shared/mayorTasks.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestPost({ request, env, params }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  const id = String(params?.id || "").slice(0, 96);
  if (!id) return json({ ok: false, error: "missing_quote_id" }, 400, request, env);

  let body = {};
  try { body = await request.json(); } catch {}
  await ensureMayorTasksSchema(env);
  const db = env.LEADS_DB;

  const quote = await db.prepare(`
    SELECT q.id, q.quote_number, q.client_name, q.client_email, q.total_usd, q.status,
           q.lead_id, q.lead_kind, q.public_slug, q.created_at, q.updated_at,
           date(q.created_at, '+' || COALESCE(q.due_days, 15) || ' days') AS due_date,
           p.id AS prospect_id, p.business_name, p.email, p.root_domain, p.vertical
    FROM quotes q
    LEFT JOIN prospects p ON p.id = q.lead_id AND q.lead_kind = 'prospect'
    WHERE q.id = ? OR q.public_slug = ?
    LIMIT 1
  `).bind(id, id).first().catch(() => null);
  if (!quote) return json({ ok: false, error: "quote_not_found" }, 404, request, env);
  if (!["quote", "invoice"].includes(String(quote.status || ""))) {
    return json({ ok: false, error: "quote_not_open", status: quote.status }, 409, request, env);
  }
  if (!quote.prospect_id) {
    const prospect = await resolveProspectForQuote(db, quote);
    if (!prospect?.id) return json({ ok: false, error: "quote_missing_prospect" }, 409, request, env);
    quote.prospect_id = prospect.id;
    quote.business_name = prospect.business_name;
    quote.email = prospect.email || quote.client_email;
    quote.root_domain = prospect.root_domain;
  }

  const source = `quote:${quote.id}`;
  let task = await db.prepare(`
    SELECT id, status, due_at, cta_text, value_usd, source, payload_json
    FROM mayor_tasks
    WHERE kind = 'quote_followup' AND source = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).bind(source).first().catch(() => null);

  if (!task) {
    const taskId = crypto.randomUUID();
    const cta = defaultCta(quote);
    const payload = JSON.stringify({
      quote_id: quote.id,
      quote_number: quote.quote_number,
      public_slug: quote.public_slug,
      view_url: `/q/${quote.public_slug}`,
      status: quote.status,
      due_date: quote.due_date,
    }).slice(0, 8000);
    await db.prepare(`
      INSERT INTO mayor_tasks (
        id, kind, prospect_id, reply_id, title, status, priority, due_at,
        cta_text, value_usd, source, payload_json, created_at, updated_at
      )
      VALUES (?, 'quote_followup', ?, NULL, ?, 'open', 78, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).bind(
      taskId,
      quote.prospect_id,
      `Follow up Quote #${quote.quote_number}: ${quote.client_name}`.slice(0, 500),
      new Date().toISOString(),
      cta,
      Number(quote.total_usd || 0),
      source,
      payload
    ).run();
    task = { id: taskId, status: "open", cta_text: cta, value_usd: quote.total_usd, source, payload_json: payload };
  }

  const taskPayload = safeJson(task.payload_json, {});
  if (taskPayload.followup_draft_id) {
    const existing = await db.prepare(`SELECT id, status FROM prospect_drafts WHERE id = ? LIMIT 1`)
      .bind(taskPayload.followup_draft_id)
      .first()
      .catch(() => null);
    if (existing) {
      return json({
        ok: true,
        already_exists: true,
        quote_id: quote.id,
        quote_number: quote.quote_number,
        task_id: task.id,
        draft_id: existing.id,
        draft_status: existing.status,
        review_href: `/admin/money?focus=${encodeURIComponent(existing.id)}`,
      }, 200, request, env);
    }
  }

  const draftId = crypto.randomUUID();
  const subject = String(body?.subject || defaultSubject(quote)).slice(0, 500);
  const bodyText = String(body?.body_text || defaultBody(quote, task)).slice(0, 16000);
  const payload = {
    kind: "quote_followup",
    quote_id: quote.id,
    quote_number: quote.quote_number,
    public_slug: quote.public_slug,
    quote_url: `https://mehyar.us/q/${quote.public_slug}`,
    task_id: task.id,
    total_usd: Number(quote.total_usd || 0),
    status: quote.status,
  };

  try {
    await db.prepare(`
      INSERT INTO prospect_drafts (
        id, prospect_id, sam_id, subject, body_text, body_html,
        cited_signals_json, status, generated_by, model, payload_json, created_at
      )
      VALUES (?, ?, NULL, ?, ?, ?, '[]', 'pending_review', 'rule_quote_followup', 'template', ?, datetime('now'))
    `).bind(
      draftId,
      quote.prospect_id,
      subject,
      bodyText,
      bodyText.replace(/\n/g, "<br/>"),
      JSON.stringify(payload).slice(0, 12000)
    ).run();

    await db.prepare(`
      UPDATE mayor_tasks
      SET prospect_id = COALESCE(prospect_id, ?),
          payload_json = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).bind(
      quote.prospect_id,
      JSON.stringify({ ...taskPayload, ...payload, followup_draft_id: draftId, followup_draft_created_at: new Date().toISOString() }).slice(0, 48000),
      task.id
    ).run();

    await db.prepare(`
      INSERT INTO opportunity_events (id, kind, prospect_id, event_type, actor, payload_json, created_at)
      VALUES (?, 'prospect', ?, 'quote_followup_draft_created', 'owner', ?, datetime('now'))
    `).bind(
      crypto.randomUUID(),
      quote.prospect_id,
      JSON.stringify({ quote_id: quote.id, quote_number: quote.quote_number, task_id: task.id, draft_id: draftId }).slice(0, 4000)
    ).run().catch(() => null);

    await db.prepare(`
      INSERT INTO mayor_events (id, kind, loop, summary, details_json, created_at)
      VALUES (?, 'revenue', 'quote_followup_draft', ?, ?, datetime('now'))
    `).bind(
      crypto.randomUUID(),
      `Quote follow-up draft ready for #${quote.quote_number}: ${quote.client_name}`,
      JSON.stringify({ quote_id: quote.id, quote_number: quote.quote_number, task_id: task.id, draft_id: draftId }).slice(0, 4000)
    ).run().catch(() => null);

    return json({
      ok: true,
      quote_id: quote.id,
      quote_number: quote.quote_number,
      task_id: task.id,
      draft_id: draftId,
      review_href: `/admin/money?focus=${encodeURIComponent(draftId)}`,
      subject,
      body_text: bodyText,
    }, 200, request, env);
  } catch (e) {
    return json({ ok: false, error: "draft_followup_failed", details: String(e?.message || e) }, 500, request, env);
  }
}

async function resolveProspectForQuote(db, quote) {
  const email = String(quote.client_email || "").trim().toLowerCase();
  if (email) {
    const existingByEmail = await db.prepare(`
      SELECT id, business_name, email, root_domain
      FROM prospects
      WHERE LOWER(email) = ?
      LIMIT 1
    `).bind(email).first().catch(() => null);
    if (existingByEmail) {
      await db.prepare(`UPDATE quotes SET lead_id = ?, lead_kind = 'prospect', updated_at = datetime('now') WHERE id = ?`)
        .bind(existingByEmail.id, quote.id)
        .run()
        .catch(() => null);
      return existingByEmail;
    }
  }

  const domain = rootDomainForQuote(quote);
  const existingByDomain = await db.prepare(`
    SELECT id, business_name, email, root_domain
    FROM prospects
    WHERE root_domain = ?
    LIMIT 1
  `).bind(domain).first().catch(() => null);
  if (existingByDomain) {
    await db.prepare(`UPDATE quotes SET lead_id = ?, lead_kind = 'prospect', updated_at = datetime('now') WHERE id = ?`)
      .bind(existingByDomain.id, quote.id)
      .run()
      .catch(() => null);
    return existingByDomain;
  }

  const prospectId = crypto.randomUUID();
  const businessName = String(quote.client_name || `Quote #${quote.quote_number} client`).slice(0, 200);
  await db.prepare(`
    INSERT INTO prospects (
      id, source, source_ref, business_name, website, root_domain, email,
      email_source, vertical, city, region, country, status, consent_state,
      meta_json, created_at, updated_at
    )
    VALUES (?, 'quote', ?, ?, NULL, ?, ?, 'quote', NULL, NULL, NULL, 'US', 'ready', 'business_interest_b2b', ?, datetime('now'), datetime('now'))
  `).bind(
    prospectId,
    quote.id,
    businessName,
    domain,
    email || null,
    JSON.stringify({ quote_id: quote.id, quote_number: quote.quote_number, client_name: quote.client_name }).slice(0, 4000)
  ).run().catch(() => null);

  const created = await db.prepare(`
    SELECT id, business_name, email, root_domain
    FROM prospects
    WHERE id = ? OR root_domain = ?
    ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END
    LIMIT 1
  `).bind(prospectId, domain, prospectId).first().catch(() => null);
  if (created?.id) {
    await db.prepare(`UPDATE quotes SET lead_id = ?, lead_kind = 'prospect', updated_at = datetime('now') WHERE id = ?`)
      .bind(created.id, quote.id)
      .run()
      .catch(() => null);
  }
  return created;
}

function rootDomainForQuote(quote) {
  const email = String(quote.client_email || "").trim().toLowerCase();
  const emailDomain = email.includes("@") ? email.split("@").pop().replace(/[^a-z0-9.-]/g, "") : "";
  if (emailDomain && emailDomain.includes(".") && !emailDomain.endsWith(".invalid")) return emailDomain.slice(0, 200);
  return `quote-${quote.quote_number}-${String(quote.id || "").slice(0, 8).toLowerCase()}.mehyar.local`;
}

function defaultSubject(quote) {
  return quote.status === "invoice"
    ? `Invoice #${quote.quote_number} follow-up`
    : `Quote #${quote.quote_number} follow-up`;
}

function defaultBody(quote, task) {
  const name = quote.business_name || quote.client_name || "there";
  const link = `https://mehyar.us/q/${quote.public_slug}`;
  const amount = Number(quote.total_usd || 0).toLocaleString();
  if (quote.status === "invoice") {
    return `Hi ${name},\n\nQuick follow-up on Invoice #${quote.quote_number} for $${amount}:\n${link}\n\nShould I keep this open for this week, or is there anything blocking payment/kickoff?\n\nMehyar`;
  }
  return `Hi ${name},\n\nQuick follow-up on Quote #${quote.quote_number} for $${amount}:\n${link}\n\nAny questions, or should I convert this to an invoice and get the first sprint scheduled?\n\nMehyar`;
}

function defaultCta(quote) {
  const link = `https://mehyar.us/q/${quote.public_slug}`;
  if (quote.status === "invoice") return `Quick follow-up on Invoice #${quote.quote_number}: ${link}`;
  return `Quick follow-up on Quote #${quote.quote_number}: ${link}`;
}

function safeJson(s, fallback) {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}
