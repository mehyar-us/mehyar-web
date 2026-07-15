// /api/admin/leads/draft-from-eval
//
// POST /api/admin/leads/draft-from-eval
//
// Generate an outreach draft (saved to prospect_drafts / prospect_sends pipeline)
// seeded from a deep-evaluation pricing tier. Owner-only.
//
// Body:
//   {
//     lead_kind:    "sam" | "prospect"
//     lead_id:      uuid
//     service:      string
//     tier_name:    "Starter" | "Growth" | "Scale" | ...
//     tier_min:     number
//     tier_max:     number
//     scope:        string[]
//   }
//
// Response: { ok, draft_id, send_id, queued_for_review: bool, used_llm, error }

import { verifyAdminToken, json, corsHeaders } from "../../_shared/adminAuth.js";
import { chatJson } from "../../_shared/llmChat.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestPost({ request, env }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "invalid_json" }, 400, request, env); }

  const { lead_kind, lead_id, service, tier_name, tier_min, tier_max, scope } = body || {};
  if (!lead_kind || !lead_id) return json({ ok: false, error: "missing_lead_ref" }, 400, request, env);
  if (!["sam", "prospect"].includes(lead_kind)) return json({ ok: false, error: "bad_lead_kind" }, 400, request, env);

  // Resolve the lead to its business name + email + contact
  let lead = null;
  if (lead_kind === "sam") {
    // gov_opportunities has no contact_email column — extract from raw_json if present
    lead = await env.LEADS_DB.prepare(`SELECT id, title, agency, source_url, response_deadline, summary, raw_json FROM gov_opportunities WHERE id = ?`).bind(lead_id).first().catch(() => null);
    if (lead) {
      try {
        const raw = lead.raw_json ? JSON.parse(lead.raw_json) : {};
        lead.contact_email = raw?.poc?.[0]?.email || raw?.contact_email || raw?.email || null;
      } catch { lead.contact_email = null; }
    }
  } else {
    // prospects has email, contact_name doesn't exist — use meta_json as fallback
    lead = await env.LEADS_DB.prepare(`SELECT id, business_name, website, root_domain, email, city, vertical FROM prospects WHERE id = ?`).bind(lead_id).first().catch(() => null);
    if (lead) {
      try {
        const meta = lead.meta_json ? JSON.parse(lead.meta_json) : {};
        lead.contact_name = meta?.contact_name || meta?.name || null;
        lead.industry = lead.vertical || meta?.industry || null;
      } catch { lead.contact_name = null; lead.industry = lead.vertical || null; }
    }
  }
  if (!lead) return json({ ok: false, error: "lead_not_found" }, 404, request, env);

  // Build the email body via LLM (or fallback template)
  const businessName = lead_kind === "sam" ? (lead.agency || lead.title || "your team") : (lead.business_name || lead.root_domain || "your team");
  const contactName = lead.contact_name || "there";
  const contactEmail = lead_kind === "prospect" ? lead.email : (lead.contact_email || null);
  const priceStr = (Number(tier_min || 0)).toLocaleString() + "–" + (Number(tier_max || 0)).toLocaleString();
  const tierStr = tier_name || "Recommended";
  const svcStr = service || "AI consulting engagement";
  const scopeList = (Array.isArray(scope) ? scope : []).slice(0, 6);

  const systemPrompt = `You are Mehyar, writing a SHORT cold-outreach email on behalf of MehyarSoft (a one-person software/cloud/AI consultancy run by Mehyar Swelim).

The prospect is a business that has clear growth potential based on AI scanning their web presence or government-contract fit.

Output ONLY valid JSON with keys: subject (string), body (string, 4-6 short lines, no marketing fluff, very human).

Rules:
- Subject must be ≤ 60 chars and reference something specific about them.
- Body must be ≤ 120 words, conversational, with a concrete observation (1 line), a 1-line value prop tied to their domain, the specific offer/price tier, and a single CTA ("Book a 15-min call: https://mehyar.us/book").
- Don't promise things you can't deliver.
- Do not include greeting signature line (added separately).
- Tone: confident, peer-to-peer, not salesy. Mehyar wrote this himself.`;

  const userPrompt = `Write a cold-outreach email.

Prospect: ${businessName}
Industry/agency: ${lead.industry || lead_kind}
${lead.root_domain ? `Website: ${lead.root_domain}` : ""}
${lead.city ? `Location: ${lead.city}` : ""}
${lead.summary ? `Brief: ${String(lead.summary).slice(0, 300)}` : ""}

Offer: ${svcStr}
Tier: ${tierStr} ($${priceStr} USD, one-time)
Scope of work:
${scopeList.map((s) => `- ${s}`).join("\n")}

Recipient: ${contactName}

JSON only: {"subject": "...", "body": "..."}`;

  let subject = `Quick idea for ${businessName}`;
  let emailBody = `Hi ${contactName},\n\nSaw that ${businessName} ${(lead.root_domain || businessName).includes(".") ? `(${lead.root_domain}) ` : ""}could use a focused ${svcStr.toLowerCase()} — most teams your size see the biggest ROI from exactly this kind of engagement.\n\nI run a one-person software/cloud/AI studio. The ${tierStr} tier ($${priceStr}) covers:\n${scopeList.map((s) => `  • ${s}`).join("\n")}\n\n15 minutes is enough to know if it's a fit: https://mehyar.us/book\n\nMehyar`;

  let used_llm = false;
  let llm_model = null;
  let llm;
  try {
    llm = await chatJson({
      env,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 600,
      temperature: 0.6,
      json_mode: true,
    });
    if (llm.used_llm && llm.content) {
      const parsed = safeJsonParse(llm.content);
      if (parsed?.subject && parsed?.body) {
        subject = String(parsed.subject).slice(0, 200);
        emailBody = String(parsed.body).slice(0, 1600);
        used_llm = true;
        llm_model = llm.model || null;
      }
    }
  } catch (e) {
    // ignore — use fallback
  }

  // Save to prospect_drafts and create a prospect_sends entry queued for review
  const draftId = crypto.randomUUID();
  const sendId = crypto.randomUUID();
  const payload = JSON.stringify({
    subject,
    body: emailBody,
    tier: { name: tierStr, min: tier_min, max: tier_max },
    service: svcStr,
    scope: scopeList,
    lead_kind,
    lead_id,
    used_llm,
    generated_at: new Date().toISOString(),
  }).slice(0, 48000);

  try {
    // Map SAM lead to a prospect row if not present (so we can send via unified queue)
    let prospectId = lead_kind === "prospect" ? lead_id : null;
    if (lead_kind === "sam" && lead.contact_email) {
      // Find existing prospect matching this domain, or create stub
      const domain = (lead.source_url || "").match(/https?:\/\/([^/]+)/i)?.[1] || lead.agency?.toLowerCase().replace(/[^a-z0-9]/g, "") + ".gov";
      const existing = await env.LEADS_DB.prepare(`SELECT id FROM prospects WHERE root_domain = ?`).bind(domain).first().catch(() => null);
      if (existing) {
        prospectId = existing.id;
      } else {
        prospectId = crypto.randomUUID();
        await env.LEADS_DB.prepare(`
          INSERT INTO prospects (id, business_name, root_domain, contact_email, contact_name, source, status, stage, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'sam.gov', 'draft', 'drafting', datetime('now'), datetime('now'))
        `).bind(prospectId, businessName, domain, lead.contact_email || null, null).run().catch(() => null);
      }
    }

    // Save draft
    // Schema columns: id, prospect_id, sam_id, subject, body_text, body_html,
    // cited_signals_json, status, generated_by, model, created_at, updated_at, payload_json
    // (added in migrations 0013). NO 'body' col, NO 'updated_at'/'created_at'
    // auto-defaults — supply explicitly.
    await env.LEADS_DB.prepare(`
      INSERT INTO prospect_drafts (id, prospect_id, sam_id, subject, body_text, body_html,
                                   cited_signals_json, status, generated_by, model,
                                   payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, '[]', 'draft', ?, ?, ?, datetime('now'))
    `).bind(
      draftId,
      lead_kind === "prospect" ? lead_id : null,
      lead_kind === "sam" ? lead_id : null,
      subject,
      emailBody,
      // body_html — simple HTML version with same body (no images for cold email)
      emailBody.replace(/\n/g, "<br/>"),
      llm.used_llm ? "model" : "fallback_template",
      llm_model,
      payload
    ).run();

    // Queue a send entry (only if we have an email)
    // Schema requires: from_email, to_email, subject, physical_address, status, created_at
    if (prospectId && contactEmail) {
      const fromEmail = env.MEHYAR_FROM_EMAIL || env.CONTACT_FROM_EMAIL || "leads@mehyar.us";
      const physicalAddress = env.MEHYAR_PHYSICAL_ADDRESS || "MehyarSwelim LLC · 123 Main St · New York, NY 10001";
      await env.LEADS_DB.prepare(`
        INSERT INTO prospect_sends (id, prospect_id, draft_id, channel, status, scheduled_for,
                                   to_email, from_email, subject, physical_address,
                                   created_at, updated_at)
        VALUES (?, ?, ?, 'email', 'queued_for_review', datetime('now','+1 minute'),
                ?, ?, ?, ?, datetime('now'), datetime('now'))
      `).bind(sendId, prospectId, draftId, contactEmail, fromEmail, subject, physicalAddress).run();
    }

    // Audit
    await env.LEADS_DB.prepare(`
      INSERT INTO opportunity_events (id, kind, prospect_id, sam_id, event_type, actor, payload_json, created_at)
      VALUES (?, ?, ?, ?, 'draft_generated', 'owner', ?, datetime('now'))
    `).bind(crypto.randomUUID(), lead_kind === "sam" ? "sam" : "prospect", lead_kind === "prospect" ? lead_id : null, lead_kind === "sam" ? lead_id : null, payload).run();
  } catch (e) {
    return json({ ok: false, error: "db_save_failed: " + e.message }, 500, request, env);
  }

  return json({
    ok: true,
    draft_id: draftId,
    send_id: contactEmail ? sendId : null,
    queued_for_review: !!contactEmail,
    used_llm,
    subject,
    body: emailBody,
    model: llm_model || null,
    contact_email: contactEmail || null,
    contact_name: contactName,
    business_name: businessName,
    tier: tier_name,
    price_range: priceStr,
  }, 200, request, env);
}

function safeJsonParse(s, fallback = {}) {
  if (!s || typeof s !== "string") return fallback;
  try { return JSON.parse(s); } catch {}
  const m = s.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return fallback;
}
