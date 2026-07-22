// GET  /api/admin/outreach/send-due  — return prospects whose next step is due (never auto-sends; returns pending queue)
// POST /api/admin/outreach/send-due  — approve + dispatch a specific prospect step (requires explicit approval)

import { verifyAdminToken, json, corsHeaders } from "./_adminAuth_local.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

// GET — enumerate send-due prospects (read-only; never auto-sends)
export async function onRequestGet({ request, env }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  const url = new URL(request.url);
  const sourceId = url.searchParams.get("source_id") || "";

  try {
    // Find prospects in 'queued' status whose next step is due.
    // Build the SQL first; only call .bind() if we actually have a parameter.
    // (D1 throws D1_TYPE_ERROR if you call .bind(undefined).)
    const sql = `
      SELECT
        p.id                           AS prospect_id,
        p.business_name,
        p.root_domain,
        p.email,
        p.vertical,
        p.city,
        p.region,
        p.last_sent_at,
        p.last_contact_at,
        p.created_at,
        p.stage,
        s.id                           AS source_id,
        s.name                         AS source_name,
        s.tag                          AS source_tag,
        s.dedup_days,
        s.enforce_30day,
        os.step_order,
        os.delay_days,
        os.require_manual_approval,
        os.skip_if_replied,
        os.subject_template,
        os.body_template,
        os.from_name,
        os.from_email,
        os.type                         AS step_type,
        os.id                          AS step_id,
        os.name                        AS step_name
      FROM prospects p
      JOIN prospect_sources s ON s.id = p.source AND s.active = 1
      JOIN outreach_steps   os ON os.source_id = s.id
        AND os.step_order = (
          SELECT MIN(os2.step_order)
          FROM outreach_steps os2
          WHERE os2.source_id = s.id
            AND os2.active = 1
            AND os2.require_manual_approval = 1
            AND NOT EXISTS (
              SELECT 1 FROM prospect_sends ps
              WHERE ps.prospect_id = p.id
                AND ps.draft_id = os2.id
                AND ps.status IN ('sent','delivered','replied')
            )
        )
      WHERE p.status = 'queued'
        AND os.active = 1
        AND (s.enforce_30day = 0 OR datetime(p.created_at) <= datetime('now', '-30 days'))
        AND (p.last_contact_at IS NULL
             OR datetime(p.last_contact_at) <= datetime('now', '-' || s.dedup_days || ' days'))
        AND (os.skip_if_replied = 0 OR NOT EXISTS (
          SELECT 1 FROM prospect_replies pr
          JOIN reply_classifications rc ON rc.reply_id = pr.id
          WHERE pr.prospect_id = p.id AND rc.label IN ('interest','warm','replied')
        ))
        AND (
          p.last_sent_at IS NULL
          OR datetime(p.last_sent_at, '+' || os.delay_days || ' days') <= datetime('now')
        )
        ${sourceId ? "AND s.id = ?" : ""}
      ORDER BY s.id, os.step_order, p.created_at
    `;
    const stmt = env.LEADS_DB.prepare(sql);
    const bound = sourceId ? stmt.bind(sourceId) : stmt;
    const sendDueRows = await bound.all();
    const rows = sendDueRows.results || [];

    const items = rows.map((r) => ({
      prospect_id: r.prospect_id,
      business_name: r.business_name,
      root_domain: r.root_domain,
      email: r.email,
      vertical: r.vertical,
      city: r.city,
      region: r.region,
      step_order: r.step_order,
      step_type: r.step_type,
      step_id: r.step_id,
      step_name: r.step_name,
      source_id: r.source_id,
      source_name: r.source_name,
      source_tag: r.source_tag,
      subject_template: r.subject_template,
      body_template: r.body_template,
      from_name: r.from_name,
      from_email: r.from_email,
      require_manual_approval: !!r.require_manual_approval,
      last_sent_at: r.last_sent_at,
      last_contact_at: r.last_contact_at,
      created_at: r.created_at,
      delay_days: r.delay_days,
      enforce_30day: !!r.enforce_30day,
      dedup_days: r.dedup_days,
    }));

    return json({ ok: true, items, total: items.length, updatedAt: new Date().toISOString() }, 200, request, env);
  } catch (e) {
    console.error("send-due error", e);
    return json({ ok: false, error: "query_failed", details: String(e?.message || e) }, 500, request, env);
  }
}

// POST — record that owner manually approved + dispatched a send.
// This just records the send in prospect_sends; actual email dispatch
// is handled by the external Resend integration.
export async function onRequestPost({ request, env }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400, request, env);
  }

  const { prospect_id, step_id, subject, body_text, to_email } = body || {};
  if (!prospect_id || !step_id) {
    return json({ ok: false, error: "prospect_id_and_step_id_required" }, 400, request, env);
  }

  // Fetch step details
  let step;
  try {
    step = await env.LEADS_DB.prepare("SELECT * FROM outreach_steps WHERE id = ?").bind(step_id).first();
  } catch (e) {
    return json({ ok: false, error: "step_query_failed" }, 500, request, env);
  }
  if (!step) return json({ ok: false, error: "step_not_found" }, 404, request, env);

  // Fetch prospect
  let prospect;
  try {
    prospect = await env.LEADS_DB.prepare("SELECT * FROM prospects WHERE id = ?").bind(prospect_id).first();
  } catch (e) {
    return json({ ok: false, error: "prospect_query_failed" }, 500, request, env);
  }
  if (!prospect) return json({ ok: false, error: "prospect_not_found" }, 404, request, env);

  const sendId = crypto.randomUUID();
  const now = new Date().toISOString();

  // Resolve templates
  const resolvedSubject = resolveTemplate(String(subject || step.subject_template || ""), prospect);
  const resolvedBody = resolveTemplate(String(body_text || step.body_template || ""), prospect);

  try {
    await env.LEADS_DB.prepare(`
      INSERT INTO prospect_sends
        (id, prospect_id, draft_id, created_at, scheduled_for, attempted_at, provider, to_email,
         from_email, reply_to, subject, list_unsub_header, physical_address, status, test_only)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0)
    `).bind(
      sendId,
      prospect_id,
      step_id,
      now,
      null,
      null,
      "manual_approval",
      String(to_email || prospect.email || "").slice(0, 254),
      String(step.from_email || "hello@mehyar.us").slice(0, 254),
      String(step.from_email || "hello@mehyar.us").slice(0, 254),
      resolvedSubject.slice(0, 500),
      `mailto:unsubscribe@mehyar.us?subject=unsubscribe%3A${encodeURIComponent(prospect.root_domain || "")}`,
      "123 Main St, Suite 100, New York, NY 10001",
    ).run();

    // Update prospect last_contact_at + last_sent_at
    await env.LEADS_DB.prepare(`
      UPDATE prospects SET last_contact_at = ?, last_sent_at = ?, last_touched_at = ?, updated_at = ? WHERE id = ?
    `).bind(now, now, now, now, prospect_id).run();

  } catch (e) {
    return json({ ok: false, error: "send_queue_insert_failed", details: String(e?.message || e) }, 500, request, env);
  }

  return json({ ok: true, send_id: sendId, status: "queued", resolvedSubject, resolvedBody }, 200, request, env);
}

function resolveTemplate(template, prospect) {
  return template
    .replace(/\{\{business_name\}\}/g, prospect.business_name || "")
    .replace(/\{\{first_name\}\}/g, (prospect.business_name || "").split(" ")[0] || "")
    .replace(/\{\{city\}\}/g, prospect.city || "")
    .replace(/\{\{region\}\}/g, prospect.region || "")
    .replace(/\{\{vertical\}\}/g, prospect.vertical || "")
    .replace(/\{\{email\}\}/g, prospect.email || "")
    .replace(/\{\{root_domain\}\}/g, prospect.root_domain || "")
    .replace(/\{\{phone\}\}/g, prospect.phone || "")
    .replace(/\{\{country\}\}/g, prospect.country || "");
}
