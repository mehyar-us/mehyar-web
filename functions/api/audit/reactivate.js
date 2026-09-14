// functions/api/audit/reactivate.js
// POST /api/audit/reactivate — legacy lead reactivation blast.
// Auth: Bearer AUDIT_CRON_SECRET. Body: { step: 1|2|3, limit?, dry_run? }
// Only targets leads with consent_marketing=1, not suppressed, not converted.

import { sendCfEmail } from "../_shared/cfEmail.js";

const FROM_EMAIL = "audit@mehyar.us";
const OWNER_EMAIL = "mrswelim@gmail.com";
const UNSUB_URL = "https://mehyar.us/unsubscribe";
const PHYSICAL = "MehyarSoft LLC, 228 Park Ave S #92842, New York, NY 10003";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function escapeHtml(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const STEPS = {
  1: {
    subject: "I built you a free tool — is your website leaking money?",
    headline: "A free AI website audit, built for you",
    body: (name) =>
      "Hi " + name + ",\n\nYou reached out to MehyarSoft a while back, and I wanted you to be first to try something I just built:\n\n" +
      "A FREE AI WEBSITE AUDIT. Drop in your URL, and in 60 seconds it tears your site apart — every money leak priced in dollars, plus the AI systems that could multiply your output up to 5x.\n\n" +
      "No account. No card. Your report lands in your inbox.\n\nRun it here: https://mehyar.us\n\n" +
      "It detects your business type automatically — local shop, clinic, or enterprise — and shows the exact AI pipelines (voice agents, smart scheduling, document scanning) built for businesses like yours.\n\n" +
      "Try it and tell me your score.\n\n— Mehyar\nMehyarSoft\n\n" +
      "P.S. The complete professional evaluation — every page graded, every leak priced, 90-day plan — is $5. Less than a coffee: https://mehyar.us/audit/report",
    html: (name) =>
      "<p>Hi " + escapeHtml(name) + ",</p>" +
      "<p>You reached out to MehyarSoft a while back, and I wanted you to be first to try something I just built:</p>" +
      "<h2>A free AI website audit</h2>" +
      "<p>Drop in your URL, and in 60 seconds it tears your site apart — every money leak priced in dollars, plus the AI systems that could multiply your output up to 5x.</p>" +
      "<p>No account. No card. Your report lands in your inbox.</p>" +
      "<p><a href='https://mehyar.us' style='display:inline-block;background:#0f172a;color:#fff;font-weight:700;padding:12px 24px;border-radius:8px;text-decoration:none'>Run my free audit</a></p>" +
      "<p>It detects your business type automatically and shows the exact AI pipelines (voice agents, smart scheduling, document scanning) built for businesses like yours.</p>" +
      "<p>— Mehyar<br>MehyarSoft</p>" +
      "<p><em>P.S. The complete professional evaluation is $5: <a href='https://mehyar.us/audit/report'>get it here</a>.</em></p>",
  },
  2: {
    subject: "Your competitors are using AI to do 5x the work",
    headline: "The 5x AI upside",
    body: (name) =>
      "Hi " + name + ",\n\nQuick follow-up — did you try the free audit yet?\n\n" +
      "Here's what most business owners miss: the audit doesn't just find what's broken on your site. It shows you the AI SYSTEMS that let businesses like yours handle 5x the volume without hiring:\n\n" +
      "• AI voice receptionist — answers every call 24/7, books jobs while you sleep\n" +
      "• Smart scheduling — fills your calendar, kills no-shows, follows up automatically\n" +
      "• Document scanner — snap a photo of any paperwork, AI extracts and files it\n\n" +
      "The math is shown step by step. No hype — just the mechanism and honest estimates.\n\n" +
      "Get your free audit + AI blueprint: https://mehyar.us\n\n— Mehyar",
    html: (name) =>
      "<p>Hi " + escapeHtml(name) + ",</p>" +
      "<p>Quick follow-up — did you try the free audit yet?</p>" +
      "<p>The audit doesn't just find what's broken. It shows you the <strong>AI systems</strong> that let businesses like yours handle 5x the volume without hiring:</p>" +
      "<ul><li><strong>AI voice receptionist</strong> — answers every call 24/7, books jobs while you sleep</li>" +
      "<li><strong>Smart scheduling</strong> — fills your calendar, kills no-shows</li>" +
      "<li><strong>Document scanner</strong> — snap a photo, AI extracts and files it</li></ul>" +
      "<p><a href='https://mehyar.us' style='display:inline-block;background:#0f172a;color:#fff;font-weight:700;padding:12px 24px;border-radius:8px;text-decoration:none'>Get my free audit</a></p>" +
      "<p>— Mehyar</p>",
  },
  3: {
    subject: "Last call: your $5 full website evaluation",
    headline: "Last call — $5 launch pricing",
    body: (name) =>
      "Hi " + name + ",\n\nLast note on this — the free audit will always be free, but the complete professional evaluation is $5 at launch pricing.\n\n" +
      "That's every page of your site graded A–F. Every leak priced. The 500% AI automation blueprint with the math shown. Your 90-day revenue plan.\n\n" +
      "Get it here: https://mehyar.us/audit/report\n\n" +
      "— Mehyar\nMehyarSoft",
    html: (name) =>
      "<p>Hi " + escapeHtml(name) + ",</p>" +
      "<p>Last note — the free audit is free forever, but the <strong>complete professional evaluation</strong> is $5 at launch pricing.</p>" +
      "<p>Every page graded A–F. Every leak priced. The 500% AI blueprint with the math shown. Your 90-day revenue plan.</p>" +
      "<p><a href='https://mehyar.us/audit/report' style='display:inline-block;background:#22c55e;color:#052e16;font-weight:700;padding:12px 24px;border-radius:8px;text-decoration:none'>Get the full report — $5</a></p>" +
      "<p>— Mehyar<br>MehyarSoft</p>",
  },
};

export async function onRequestPost({ request, env }) {
  try {
    if (!env?.LEADS_DB) return json({ ok: false, error: "service_unavailable" }, 503);
    const authz = request.headers.get("authorization") || "";
    if (!env.AUDIT_CRON_SECRET || authz !== "Bearer " + env.AUDIT_CRON_SECRET) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }
    const body = await request.json().catch(() => ({}));
    const step = Number(body.step);
    const limit = Math.min(Number(body.limit) || 50, 500);
    const dryRun = body.dry_run !== false; // default to dry run for safety
    if (!STEPS[step]) return json({ ok: false, error: "invalid_step" }, 400);
    const tpl = STEPS[step];

    // Eligible: consent_marketing=1, not suppressed, not already a $5 buyer.
    const leads = await env.LEADS_DB.prepare(
      "SELECT id, email, name, company FROM leads " +
      "WHERE consent_marketing = 1 AND email IS NOT NULL AND email != '' " +
      "AND lower(email) NOT IN (SELECT lower(email) FROM suppression_list) " +
      "AND lower(email) NOT IN (SELECT lower(email) FROM audit_full_reports WHERE status = 'ready') " +
      "ORDER BY created_at ASC LIMIT ?"
    ).bind(limit).all();

    const targets = (leads.results || []).filter((l) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(l.email));
    if (dryRun) {
      return json({
        ok: true, dry_run: true, step, eligible: targets.length,
        sample: targets.slice(0, 5).map((l) => ({ email: l.email, name: l.name, company: l.company })),
      });
    }

    let sent = 0, failed = 0;
    for (const lead of targets) {
      const name = (lead.name || "").split(" ")[0] || "there";
      const text = tpl.body(name) + "\n\nUnsubscribe: " + UNSUB_URL + "\n" + PHYSICAL;
      const html = "<!DOCTYPE html><html><body style='font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#0f172a'>" +
        "<p style='color:#64748b;font-size:13px'>MEHYARSOFT</p><h1 style='font-size:24px'>" + tpl.headline + "</h1>" +
        tpl.html(name) +
        "<p style='color:#94a3b8;font-size:12px;margin-top:24px'><a href='" + UNSUB_URL + "' style='color:#94a3b8'>Unsubscribe</a> · " + PHYSICAL + "</p></body></html>";
      const r = await sendCfEmail(env, {
        from: "MehyarSoft <" + FROM_EMAIL + ">",
        to: lead.email,
        subject: tpl.subject,
        text, html,
        replyTo: OWNER_EMAIL,
      });
      if (r.ok) sent++; else { failed++; console.error("reactivate send failed", lead.email, r.error); }
      // Record the send.
      try {
        await env.LEADS_DB.prepare(
          "INSERT INTO lead_events (id, lead_id, event_type, created_at) VALUES (?, ?, 'reactivate_step" + step + "', datetime('now'))"
        ).bind(crypto.randomUUID(), lead.id).run();
      } catch { /* best-effort */ }
    }

    // Owner summary.
    await sendCfEmail(env, {
      from: "MehyarSoft Audit <" + FROM_EMAIL + ">",
      to: OWNER_EMAIL,
      subject: "📧 Reactivation step " + step + ": " + sent + " sent, " + failed + " failed",
      text: "Reactivation email step " + step + " completed.\nSent: " + sent + "\nFailed: " + failed + "\nEligible pool: " + targets.length,
    });

    return json({ ok: true, dry_run: false, step, sent, failed, eligible: targets.length });
  } catch (e) {
    console.error("reactivate error", e && e.message);
    return json({ ok: false, error: "failed" }, 500);
  }
}
