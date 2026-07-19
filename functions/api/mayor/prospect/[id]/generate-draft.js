// /api/mayor/prospect/[id]/generate-draft — produce a cold outreach draft
// for the prospect, citing the latest leak signals as the reason for outreach.
//
// Heuristic draft (no LLM dependency — works offline + free). When an LLM
// gateway env var is present, that path can be wired in later; the heuristic
// already produces copy that follows the same structure an LLM would.
//
// Body: { tone?: "professional"|"friendly", step_no?: 1|2|3, model?: "heuristic"|"gpt-4o-mini" }
//
// Returns: { ok, draft_id, subject, body_text, cited_signals }

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

const SENDER_NAME = "Mehyar";
const SENDER_TITLE = "MehyarSoft LLC";
const SENDER_PHONE = env => env?.MAYOR_PHONE || "917-555-0100";
const SENDER_EMAIL = env => env?.MAYOR_FROM_EMAIL || "team@mehyar.us";

function draftSubject(prospect, stepNo) {
  const biz = prospect.business_name || "your business";
  switch (stepNo) {
    case 1: return `Quick question for ${biz}`;
    case 2: return `Re: what I noticed on ${(prospect.website || "your site").replace(/^https?:\/\//, "").split("/")[0]}`;
    case 3: return `Following up — and offering a free audit`;
    default: return `Quick question for ${biz}`;
  }
}

function draftBody(prospect, signals, stepNo, env) {
  const biz = prospect.business_name || "your business";
  const domain = (prospect.website || "your site").replace(/^https?:\/\//, "").split("/")[0];
  const vert = prospect.vertical || "local business";
  const city = prospect.city || "your area";
  const sender = `Mehyar\nMehyarSoft LLC · Founder\n${SENDER_EMAIL(env)}\n${SENDER_PHONE(env)}\n\nMehyarSoft LLC · 228 Park Ave S #92842 · New York, NY 10003`;

  // Lead with the strongest signal (most visible leak)
  const lead = signals.no_booking_cta
    ? `I was looking at ${domain} tonight — and I noticed there isn't a clear "Book" or "Schedule" button on the homepage.`
    : signals.no_phone_cta
    ? `I was on ${domain} tonight and noticed the phone number isn't a tap-to-call link on mobile, which usually costs ${vert} businesses a chunk of inbound calls.`
    : signals.no_https
    ? `I noticed ${domain} doesn't have HTTPS — modern browsers flag that as "Not secure" before anyone even lands on the page.`
    : signals.slow_load
    ? `I ran ${domain} through a quick load check — it's coming in over 2.5 seconds on mobile, which usually bounces about half the visitors before the page paints.`
    : signals.large_page
    ? `${domain} is over 200 KB on first paint — that's heavier than it needs to be for a ${vert} site.`
    : `I was on ${domain} tonight and noticed a few things that probably cost you some leads.`;

  const proof = [];
  if (signals.no_booking_cta) proof.push("no clear booking CTA on the homepage");
  if (signals.no_phone_cta)   proof.push("no tap-to-call phone link on mobile");
  if (signals.no_https)       proof.push("no HTTPS (browser warning)");
  if (signals.slow_load)      proof.push(`slow load (~${signals._load_time_ms}ms)`);
  if (signals.no_form_action) proof.push("no working contact form on the homepage");
  if (signals.no_email_link)  proof.push("no visible email link / mailto");
  if (signals.no_address)     proof.push("no street address shown (kills local SEO trust)");
  if (signals.generic_template) proof.push("template still showing placeholder text");

  const proofLine = proof.length
    ? `Specifically: ${proof.slice(0, 3).join(", ")}.`
    : `A few smaller things I'd tighten up.`;

  if (stepNo === 1) {
    return `${lead}

${proofLine}

For a ${vert} in ${city}, these are usually the leaks that quietly cost you booked jobs — the people who close the tab and call the next result instead.

I run a 30-minute free audit for ${vert} businesses: I'll record a 5-minute Loom walking through the three fixes I'd make first, with no follow-up unless you ask.

Want me to send one over for ${domain}?

— ${sender}

---
You're getting this because MehyarSoft helps ${vert} operators in ${city} tighten their websites and intake. If it's not relevant, hit reply with "unsubscribe" and I won't write again.
`.trim();
  }

  if (stepNo === 2) {
    return `Quick follow-up — I sent a note last week about ${domain}.

${proofLine.charAt(0).toUpperCase() + proofLine.slice(1)}

I'm running two free ${vert} audits this week (NYC + Brooklyn only). If you want one before I give the slots away, just hit reply with "send it" and I'll record it over the weekend.

— ${sender}

---
Reply "stop" and I won't write again.
`.trim();
  }

  // step 3 — final nudge, no pressure
  return `Last note from me — I don't want to fill your inbox.

I genuinely think the ${proof[0] || "fixes"} on ${domain} would pay for itself within a month for a ${vert} shop in ${city}, and I'd rather show you in 5 minutes than keep emailing about it.

If now isn't the right time, totally fine. Hit reply with "later" and I'll move you to a 6-month check-in.

— ${sender}

---
MehyarSoft LLC · NYC · ${SENDER_EMAIL(env)} · Reply "stop" to opt out.
`.trim();
}

export async function onRequestPost({ request, env, params }) {
  if (!await bearerAccepted(request, env)) {
    return json({ ok: false, error: "unauthorized" }, 401, request, env);
  }
  if (!env?.LEADS_DB) {
    return json({ ok: false, error: "missing_db" }, 500, request, env);
  }
  const id = params?.id;
  if (!id) return json({ ok: false, error: "missing_prospect_id" }, 400, request, env);

  let body = {};
  try { body = await request.json(); } catch {}
  const stepNo = parseInt(body?.step_no || "1", 10) || 1;
  const tone = body?.tone || "friendly";
  const model = body?.model || "heuristic";

  const db = env.LEADS_DB;
  const { results: prs } = await db.prepare(`SELECT * FROM prospects WHERE id = ?`).bind(id).all();
  const prospect = prs?.[0];
  if (!prospect) return json({ ok: false, error: "prospect_not_found" }, 404, request, env);

  // Get latest signals
  const { results: sigs } = await db.prepare(`
    SELECT leak_signals_json, leak_score, detected_platform, load_time_ms, has_booking_cta, has_phone_click_to_call, has_ssl
    FROM prospect_signals WHERE prospect_id = ? ORDER BY scanned_at DESC LIMIT 1
  `).bind(id).all();
  const latestSignal = sigs?.[0];
  if (!latestSignal) {
    return json({ ok: false, error: "no_signals_yet", message: "Run /rescan first." }, 409, request, env);
  }
  let citedSignals = [];
  try { citedSignals = JSON.parse(latestSignal.leak_signals_json || "[]"); } catch {}
  const signalsForDraft = {
    no_booking_cta:  citedSignals.includes("no_booking_cta"),
    no_phone_cta:    citedSignals.includes("no_phone_cta"),
    no_https:        citedSignals.includes("no_https"),
    slow_load:       citedSignals.includes("slow_load"),
    large_page:      citedSignals.includes("large_page"),
    no_form_action:  citedSignals.includes("no_form_action"),
    no_email_link:   citedSignals.includes("no_email_link"),
    no_address:      citedSignals.includes("no_address"),
    generic_template:citedSignals.includes("generic_template"),
    _load_time_ms:   latestSignal.load_time_ms,
  };

  const subject = draftSubject(prospect, stepNo);
  const bodyText = draftBody(prospect, signalsForDraft, stepNo, env);

  // Persist as draft
  const draftId = crypto.randomUUID();
  try {
    await db.prepare(`
      INSERT INTO prospect_drafts
        (id, prospect_id, created_at, generated_by, model, subject, body_text,
         cited_signals_json, status, reviewer_notes)
      VALUES (?, ?, datetime('now'), ?, ?, ?, ?, ?, 'draft', NULL)
    `).bind(
      draftId,
      prospect.id,
      model === "heuristic" ? "heuristic" : "model",
      model,
      subject,
      bodyText,
      JSON.stringify(citedSignals),
    ).run();
  } catch (e) {
    return json({ ok: false, error: "draft_insert_failed", message: String(e?.message || e) }, 500, request, env);
  }

  // Update prospect status if still 'new' or 'scanned'
  try {
    await db.prepare(`
      UPDATE prospects
         SET status = CASE WHEN status IN ('new','scanned') THEN 'drafted' ELSE status END,
             last_drafted_at = datetime('now'),
             updated_at = datetime('now')
       WHERE id = ?
    `).bind(prospect.id).run();
  } catch (_) {}

  // Audit event
  try {
    await db.prepare(`
      INSERT INTO mayor_events (id, kind, loop, summary, details_json, created_at)
      VALUES (?, 'outreach', 'draft_generated', ?, ?, datetime('now'))
    `).bind(
      crypto.randomUUID(),
      `Drafted step ${stepNo} for ${prospect.business_name} (${citedSignals.length} cited signals)`,
      JSON.stringify({ draft_id: draftId, prospect_id: prospect.id, step_no: stepNo, model, cited: citedSignals })
    ).run();
  } catch (_) {}

  return json({
    ok: true,
    draft_id: draftId,
    prospect_id: prospect.id,
    prospect_business: prospect.business_name,
    subject,
    body_text: bodyText,
    cited_signals: citedSignals,
    leak_score: latestSignal.leak_score,
    platform: latestSignal.detected_platform,
    step_no: stepNo,
    model,
    tone,
  }, 200, request, env);
}