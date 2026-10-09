// functions/api/assessment/end.js
// POST /api/assessment/end — close the call, persist the lead, send the
// post-call email with the tokenized, expiring prefill link.
// Body: { session_id, email? }  (email may already be in session state)
//
// Privacy: the raw email is used ONCE for the transactional send and never
// persisted — only its SHA-256 lands in D1 (see assessmentStore.saveSession).
// Idempotent: if email_sent_at is already set, the email is not re-sent.

import { json, loadSession, saveSession, mintPrefillToken } from "../_shared/assessmentStore.js";
import { sendCfEmail } from "../_shared/cfEmail.js";
import { getUsageSummary } from "../_shared/assessmentBrain.js";
import {
  AUDIT_PREFILL_URL, PREFILL_LINK_TTL_DAYS, PRODUCT_NAME, PRODUCT_PRICE,
} from "../_shared/assessmentPersona.js";

const FROM = "MehyarSoft <team@mehyar.us>";
const REPLY_TO = "info@mehyar.us";
const PHYSICAL_ADDRESS = "MehyarSoft LLC, 228 Park Ave S #92842, New York, NY 10003";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function buildEmail(session, link, unsubLink) {
  const name = session.businessName || "there";
  const firstName = (session.contactName || "").split(" ")[0];
  const greeting = firstName ? `Hi ${firstName}` : "Hi";
  const findings = (session.findings || []).slice(0, 4);
  const findingsText = findings.length
    ? findings.map((f) => `- ${f.title}: ${f.observation}`).join("\n")
    : "- (we didn't get to your website on the call — the audit will cover it in full)";
  const subject = `Your personal audit link — ${name}`;
  const text =
`${greeting},

Good talking today. Here's your personal link to the ${PRODUCT_NAME} form — everything we covered is already filled in:

${link}

The link is good for ${PREFILL_LINK_TTL_DAYS} days. Add any extra details, and if you can, upload a short walkthrough video of your business — it feeds the audit.

What I saw on your site today:
${findingsText}

The full $${PRODUCT_PRICE} audit goes much deeper: your whole funnel, your competitors, and exactly where AI fits in your business — with a ranked fix list you own. One-time purchase, all sales final.

One note: the findings above come from automated measurements of your public website.

— The Mayor's office

${PHYSICAL_ADDRESS}
Don't want the one follow-up email? Unsubscribe: ${unsubLink}`;
  const html =
`<p>${greeting},</p>
<p>Good talking today. Here's your personal link to the ${PRODUCT_NAME} form — everything we covered is already filled in:</p>
<p><a href="${link}">${link}</a></p>
<p>The link is good for ${PREFILL_LINK_TTL_DAYS} days. Add any extra details, and if you can, upload a short walkthrough video of your business — it feeds the audit.</p>
<p><strong>What I saw on your site today:</strong></p>
<ul>${findings.map((f) => `<li><strong>${f.title}:</strong> ${f.observation}</li>`).join("") || "<li>(we didn't get to your website on the call — the audit will cover it in full)</li>"}</ul>
<p>The full $${PRODUCT_PRICE} audit goes much deeper: your whole funnel, your competitors, and exactly where AI fits in your business — with a ranked fix list you own. One-time purchase, all sales final.</p>
<p><em>One note: the findings above come from automated measurements of your public website.</em></p>
<p>— The Mayor's office</p>
<p>${PHYSICAL_ADDRESS}<br><a href="${unsubLink}">Unsubscribe from follow-up emails</a> · <a href="https://mehyar.us/privacy-policy/">Privacy</a> · <a href="https://mehyar.us/terms/">Terms</a></p>`;
  return { subject, text, html };
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env?.LEADS_DB) return json({ ok: false, error: "service_unavailable" }, 503);
    const body = await request.json().catch(() => ({}));
    const sessionId = String(body.session_id || "");
    if (!sessionId) return json({ ok: false, error: "missing_session_id" }, 400);
    const loaded = await loadSession(env, sessionId);
    if (!loaded || !loaded.state) return json({ ok: false, error: "session_not_found" }, 404);
    const session = loaded.state;

    const email = (session.email || String(body.email || "")).toLowerCase().trim();
    if (email && !EMAIL_RE.test(email)) return json({ ok: false, error: "invalid_email" }, 400);
    if (email) { session.email = email; session.emailCaptured = true; }
    if (!session.outcome) session.outcome = email ? "followup" : "declined";
    session.closedAt = session.closedAt || new Date().toISOString();

    let emailSent = false, emailError = "";
    if (email && !session.emailSentAt && !loaded.row?.marketing_opt_out) {
      const { token } = await mintPrefillToken(env, session.id, email);
      session.prefillToken = token;
      const link = `${AUDIT_PREFILL_URL}?prefill=${encodeURIComponent(token)}`;
      const unsubLink = `https://mehyar.us/api/assessment/unsubscribe?token=${encodeURIComponent(token)}`;
      const { subject, text, html } = buildEmail(session, link, unsubLink);
      const r = await sendCfEmail(env, {
        from: FROM, to: email, subject, text, html, replyTo: REPLY_TO,
      });
      if (r.ok) {
        session.emailSentAt = new Date().toISOString();
        emailSent = true;
      } else {
        emailError = r.error || "send_failed";
      }
    }

    await saveSession(env, session);
    return json({
      ok: true,
      outcome: session.outcome,
      email_sent: emailSent,
      email_error: emailError || null,
      // NOTE: the raw prefill token is returned so the infra crew can also
      // surface the link in-app (e.g. SMS). It is single-session, 7-day TTL.
      prefill_token: session.prefillToken || null,
      // Final per-call usage ledger (measured only) for the pricing report.
      usage: getUsageSummary(session),
    });
  } catch (e) {
    console.error("[assessment/end]", e?.message);
    return json({ ok: false, error: "end_failed" }, 500);
  }
}
