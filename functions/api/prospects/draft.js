// POST /api/prospects/draft  { prospect_id }
// Uses OpenAI-compatible API (defaults to OpenAI; env vars may repoint to OpenRouter/Anthropic-gateway/etc).
// Falls back to a deterministic signal-templated draft when no LLM_API_KEY configured.
//
// Person who reads the email: owner/manager of a local-services business. Doesn't care about tech jargon.
// We do NOT mention "tooling for tooling's sake". Each line cites a real leak we detected.

import { verifyAdminToken, json, corsHeaders } from "../_shared/adminAuth.js";

const SIGNAL_VERBIAGE = {
  no_https:        "your site isn't using HTTPS",
  slow_load:       "your homepage takes more than 3 seconds to load",
  heavy_page:      "your homepage is over 2.5 MB",
  no_viewport:     "your site doesn't have a mobile viewport meta tag",
  no_booking_cta:  "your homepage doesn't ask visitors to book, schedule, or take a next step",
  no_phone_link:   "your phone number isn't clickable to call on a phone",
  no_form_action:  "your site doesn't have a working form for inquiries",
  no_email_link:   "your site doesn't expose an email contact",
  no_address:      "your site doesn't show a physical address (a Google ranking + trust killer)",
  platform_generic: "your site looks like an unmoved Wix or Squarespace default",
  fetch_failed:    "your homepage failed to load when I checked",
};

const SUBJECT_OPENERS = [
  "small thing I noticed on {name}'s site",
  "30-second review of {name}'s homepage",
  "one leak at {name}",
  "a quick finding on {name}",
  "{name} — what I'd fix this week",
];

function nowIso() { return new Date().toISOString(); }

async function readBodyCap(request, maxBytes = 8 * 1024) {
  const reader = request.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) { try { await reader.cancel(); } catch {}; throw new Error("payload_too_large"); }
    chunks.push(value);
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: false }).decode(out);
}

function cap(value, max) {
  return (value || "").length > max ? value.slice(0, max) : value;
}

async function loadProspectSignals(env, prospectId) {
  const prospect = await env.LEADS_DB.prepare(
    `SELECT id, business_name, root_domain, website, vertical, city, last_drafted_at
     FROM prospects WHERE id = ? LIMIT 1`
  ).bind(prospectId).first();
  if (!prospect) return null;
  const signals = await env.LEADS_DB.prepare(
    `SELECT leak_signals_json, leak_score, title, detected_platform, page_weight_kb, load_time_ms, http_ok, https_ok, has_booking_cta, has_phone_click_to_call, has_form_action, has_email_link, has_address, has_viewport
     FROM prospect_signals WHERE prospect_id = ? ORDER BY scanned_at DESC LIMIT 1`
  ).bind(prospectId).first();
  return { prospect, signals };
}

function templateFallback({ prospect, signals }) {
  const leakList = JSON.parse(signals?.leak_signals_json || "[]");
  const name = prospect.business_name || prospect.root_domain || "your business";
  const domain = prospect.root_domain || "";
  const cited = leakList
    .filter(s => s in SIGNAL_VERBIAGE)
    .map(s => SIGNAL_VERBIAGE[s]);
  const top3 = cited.slice(0, 3);
  const leakLine = top3.length
    ? top3.join("; ").replace(/; ([^;]*)$/, ", and $1")
    : "some small friction points in the booking path";

  const opener = SUBJECT_OPENERS[Math.floor(Math.random() * SUBJECT_OPENERS.length)].replace("{name}", name);
  const subject = cap(`${opener}`, 140);

  const body = [
    `Hi ${name} team,`,
    "",
    `I run MehyarSoft LLC — founder-led consulting that helps local and service businesses stop losing customers to weak websites and slow follow-up. I'm a Senior software engineer in NYC.`,
    "",
    `I checked ${domain} briefly and noticed ${leakLine}.`,
    `If those sound like the kind of small leaks that quietly cost calls, leads, or bookings, that's the exact kind of audit I do for $150 — a written leak map with the smallest useful next step, no agency theater.`,
    "",
    `Want me to send the report? Happy to share the PDF and a few screenshots.`,
    "",
    `— Mehyar Swelim`,
    `MehyarSoft LLC`,
    `https://mehyar.us · info@mehyar.us`,
    `Unsub: https://mehyar.us/unsubscribe`,
  ].join("\n");

  return { subject, body, cited_signals: leakList.slice(0, 5) };
}

async function callLLM(env, systemPrompt, userPrompt) {
  const url = env.LLM_BASE_URL || "https://api.openai.com/v1/chat/completions";
  const key = env.LLM_API_KEY;
  const model = env.LLM_MODEL || "gpt-4o-mini";
  if (!key) return null;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "authorization": `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      max_tokens: 700,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt },
      ],
    }),
  });
  if (!resp.ok) {
    return { error: `llm_${resp.status}` };
  }
  const data = await resp.json().catch(() => ({}));
  return data?.choices?.[0]?.message?.content?.trim() || null;
}

function parseLLMEmail(raw) {
  // LLM sometimes returns Subject: … \n\n Body...
  const subj = raw.match(/^Subject:\s*(.+)$/im);
  let subject = subj ? subj[1].trim() : "";
  let body = subj ? raw.replace(/^Subject:.*\n+/i, "") : raw;
  if (!subject) {
    // Fall back: first short line
    const first = raw.split("\n").map(l => l.trim()).filter(Boolean)[0] || "Quick note";
    subject = first.length > 140 ? first.slice(0, 137) + "..." : first;
    body = raw.split("\n").slice(1).join("\n").trim();
  }
  return { subject: cap(subject, 140), body: cap(body, 3000) };
}

export async function onRequestPost({ request, env }) {
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);

  let body;
  try {
    const raw = await readBodyCap(request, 8 * 1024);
    body = JSON.parse(raw || "{}");
  } catch { return json({ ok: false, error: "bad_json" }, 400); }

  const prospectId = body.prospect_id;
  if (!prospectId) return json({ ok: false, error: "missing_prospect_id" }, 400);

  const loaded = await loadProspectSignals(env, prospectId).catch(() => null);
  if (!loaded?.signals) return json({ ok: false, error: "no_signals_found_run_scan_first" }, 412);
  const { prospect, signals } = loaded;

  const leakList = JSON.parse(signals.leak_signals_json || "[]");
  const verbiage = leakList.map(s => SIGNAL_VERBIAGE[s]).filter(Boolean);
  const verbiageJoined = verbiage.length ? verbiage.join("; ") : "some small homepage friction points";

  // System prompt anchors brand voice: concise, evidence-first, no objection-bait, no emojis.
  const system = [
    "You write cold outreach emails for MehyarSoft LLC, a founder-led software/systems/AI automation consulting firm in NYC.",
    "Audience: owner/manager of a local-services business (dentist, therapist, HVAC, real estate).",
    "Tone: concise, professional, evidence-first. No emojis. No exclamation. No ALL CAPS.",
    "Hard rules:",
    "- Maximum 140 chars subject.",
    "- Maximum 110 words body, plain text, single signature block.",
    "- Reference at most 3 leak signals concretely (caller passes the list).",
    "- End with one short, low-friction CTA: 'Want me to send the report?' or 'Are you the right person?'",
    "- Never claim results or testimonials we don't have.",
    "- Always include the unsub link https://mehyar.us/unsubscribe at the end.",
    "- Output exactly two fields: 'Subject: …' on line 1, then a blank line, then the email body.",
  ].join("\n");

  const user = [
    `Business: ${prospect.business_name}`,
    `Domain: ${prospect.root_domain}`,
    `Vertical hint: ${prospect.vertical || "local services"}, ${prospect.city || ""}`.trim(),
    `Detected homepage leaks: ${verbiageJoined}`,
    `Scanned: ${leakList.length} signals, score ${signals.leak_score}/100`,
    "",
    "Write the cold outreach email now. Keep the phone in the signature: 'https://mehyar.us · info@mehyar.us'.",
  ].join("\n");

  let usedLLM = false, model = env.LLM_MODEL || "template-fallback";
  const llm = env.LLM_API_KEY ? await callLLM(env, system, user).catch((e) => ({ error: String(e?.message || e) })) : null;

  let draft;
  if (typeof llm === "string" && llm.length > 5) {
    usedLLM = true;
    draft = parseLLMEmail(llm);
  } else {
    const tpl = templateFallback({ prospect, signals });
    draft = { subject: tpl.subject, body: tpl.body };
  }

  // CAN-SPAM footer additions (kept outside the LLM loop so they always render)
  const finalBody = [
    draft.body.trim(),
    "",
    "— Mehyar Swelim",
    "Founder, MehyarSoft LLC",
    "https://mehyar.us · info@mehyar.us",
    "Unsubscribe: https://mehyar.us/unsubscribe",
  ].join("\n");

  // Mark old drafts as superseded, store new one
  await env.LEADS_DB.prepare(
    `UPDATE prospect_drafts SET status = 'superseded' WHERE prospect_id = ? AND status = 'draft'`
  ).bind(prospectId).run();
  const draftId = crypto.randomUUID();
  await env.LEADS_DB.prepare(`
    INSERT INTO prospect_drafts (
      id, prospect_id, generated_by, model, subject, body_text, cited_signals_json, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft')
  `).bind(
    draftId, prospectId,
    usedLLM ? "model" : "fallback_template",
    model,
    draft.subject, finalBody,
    JSON.stringify(leakList.slice(0, 5))
  ).run();
  await env.LEADS_DB.prepare(
    `UPDATE prospects SET last_drafted_at = ?, status = 'drafted', updated_at = ? WHERE id = ?`
  ).bind(nowIso(), nowIso(), prospectId).run();

  return json({ ok: true, draft_id: draftId, used_llm: usedLLM, model, subject: draft.subject, body: finalBody }, 200, request, env);
}

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export const __test = { templateFallback, parseLLMEmail, SIGNAL_VERBIAGE };
