// functions/api/audit/drip.js
// POST /api/audit/drip — sends due drip emails (days 1, 2, 4, 7 after free scan).
// Protected: Bearer <AUDIT_CRON_SECRET>. Called daily from the chat-side cron.
// Skips: unsubscribed leads, converted leads (deep_status != 'none'),
// suppression_list entries, already-sent days. Batch cap 200/run.

import { sendCfEmail } from "../_shared/cfEmail.js";

const FROM_EMAIL = "audit@mehyar.us";
const UNSUB_URL = "https://mehyar.us/unsubscribe";
const AUDIT_URL = "https://mehyar.us/audit";
const PHYSICAL = "MehyarSoft LLC, 228 Park Ave S #92842, New York, NY 10003";
const BATCH_CAP = 200;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
function esc(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function hmacSha256(env, value) {
  const secret = env?.HMAC_SECRET || env?.TURNSTILE_SECRET_KEY || "";
  if (!secret) return null;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function footerText() {
  return `\n\n—\nMehyarSoft · ${PHYSICAL}\nUnsubscribe: ${UNSUB_URL}`;
}
function footerHtml() {
  return `<p style="color:#94a3b8;font-size:12px;margin-top:24px;">MehyarSoft · ${esc(PHYSICAL)}<br><a href="${UNSUB_URL}" style="color:#94a3b8;">Unsubscribe</a></p>`;
}

// Drip copy. {name}, {business}, {score}, {leak1} are interpolated per lead.
const DRIP = [
  {
    day: 1,
    subject: (l) => `The leak most owners ignore (${l.score}/100)`,
    text: (l) => `Hi${l.name ? " " + l.name : ""},\n\nYesterday your site scored ${l.score}/100. The leak I want you to look at first:\n\n"${l.leak1}"\n\nThis is the one that costs owners the most because it's invisible — the site looks fine, but buyers quietly bounce at exactly this step.\n\nFix it this week and you stop the bleed. Want the full priced list of every leak, page by page, with a 30-day fix plan? That's the $199 Deep AI Audit:\n${AUDIT_URL}\n` + footerText(),
    html: (l) => `<p>Hi${l.name ? " " + esc(l.name) : ""},</p><p>Yesterday your site scored <strong>${l.score}/100</strong>. The leak to look at first:</p><blockquote style="border-left:3px solid #b45309;padding-left:12px;color:#334155;">${esc(l.leak1)}</blockquote><p>This is the one that costs owners the most because it's invisible — the site looks fine, but buyers quietly bounce at exactly this step.</p><p><a href="${AUDIT_URL}">Get the $199 Deep AI Audit — every leak priced, 30-day fix plan</a></p>` + footerHtml(),
  },
  {
    day: 2,
    subject: () => `What the $199 Deep Audit actually gives you`,
    text: (l) => `Quick breakdown, no fluff:\n\nThe free scan checked your homepage. The $199 Deep AI Audit:\n• Crawls your homepage + service, about, and booking pages\n• Prices every leak in estimated dollars/month (with the math shown)\n• Benchmarks you against the competitor outranking you right now\n• Hands you a 30-day fix plan ordered by revenue impact\n• Delivered in 3–5 business days, manual invoice (ACH/wire/check)\n\nIf your site is leaking even a few hundred a month, this pays for itself the first week.\n${AUDIT_URL}\n` + footerText(),
    html: (l) => `<p>Quick breakdown, no fluff. The free scan checked your homepage. The <strong>$199 Deep AI Audit</strong>:</p><ul><li>Crawls your homepage + service, about, and booking pages</li><li>Prices every leak in estimated dollars/month (math shown)</li><li>Benchmarks you against the competitor outranking you right now</li><li>Hands you a 30-day fix plan ordered by revenue impact</li><li>Delivered in 3–5 business days, manual invoice (ACH/wire/check)</li></ul><p>If your site is leaking even a few hundred a month, this pays for itself the first week.</p><p><a href="${AUDIT_URL}">Reserve your deep audit — $199</a></p>` + footerHtml(),
  },
  {
    day: 4,
    subject: () => `“I already have a web guy” — and 2 other objections`,
    text: (l) => `Three things owners tell me:\n\n1. "I already have a web guy." Good — the audit makes him dangerous. It tells him exactly what to fix in ROI order instead of guessing.\n2. "My site looks fine." So did every site that scored 40–60 this month. Looking fine and converting are different sports.\n3. "I'll do it later." Every month later is another month of the same leaks. The scan already showed you where.\n\n$199, 3–5 days, priced leak by leak:\n${AUDIT_URL}\n` + footerText(),
    html: (l) => `<p>Three things owners tell me:</p><p><strong>1. "I already have a web guy."</strong> Good — the audit makes him dangerous. It tells him exactly what to fix in ROI order instead of guessing.</p><p><strong>2. "My site looks fine."</strong> So did every site scoring 40–60 this month. Looking fine and converting are different sports.</p><p><strong>3. "I'll do it later."</strong> Every month later is another month of the same leaks. The scan already showed you where.</p><p><a href="${AUDIT_URL}">$199, 3–5 days, priced leak by leak</a></p>` + footerHtml(),
  },
  {
    day: 7,
    subject: (l) => `Last call: your ${l.score}/100 score + a free re-scan`,
    text: (l) => `Closing the loop${l.name ? " " + l.name : ""}.\n\nYour free audit stays yours. Two options:\n\n1. Get the $199 Deep AI Audit and fix it all in 30 days: ${AUDIT_URL}\n2. Fix the 3 quick wins yourself, then re-scan free anytime — I'll show you the new score: ${AUDIT_URL}\n\nEither way, stop guessing what your website is doing to your revenue.\n\n— Mehyar, MehyarSoft\n` + footerText(),
    html: (l) => `<p>Closing the loop${l.name ? " " + esc(l.name) : ""}.</p><p>Your free audit stays yours. Two options:</p><p><strong>1.</strong> <a href="${AUDIT_URL}">Get the $199 Deep AI Audit</a> and fix it all in 30 days.<br><strong>2.</strong> Fix the 3 quick wins yourself, then <a href="${AUDIT_URL}">re-scan free</a> — I'll show you the new score.</p><p>Either way, stop guessing what your website is doing to your revenue.</p><p>— Mehyar, MehyarSoft</p>` + footerHtml(),
  },
];

export async function onRequestPost({ request, env }) {
  try {
    const auth = request.headers.get("authorization") || "";
    const secret = env?.AUDIT_CRON_SECRET || "";
    if (!secret || auth !== `Bearer ${secret}`) return json({ ok: false, error: "unauthorized" }, 401);
    if (!env?.LEADS_DB) return json({ ok: false, error: "no_db" }, 503);
    // Email goes through the verified Cloudflare Email Sending API path
    // (_shared/cfEmail.js) — no send_email binding required.

    const sent = [];
    const skipped = { unsubscribed: 0, converted: 0, suppressed: 0, failed: 0 };

    for (const d of DRIP) {
      // Leads created >= d.day days ago, no send for that day yet.
      const leads = await env.LEADS_DB.prepare(
        `SELECT l.id, l.email, l.name, l.business, l.teaser_score, l.teaser_json, l.deep_status, l.unsubscribed
         FROM audit_leads l
         LEFT JOIN audit_drip_sends s ON s.lead_id = l.id AND s.day = ?
         WHERE s.id IS NULL
           AND date(l.created_at) <= date('now', ?)
         LIMIT ?`
      ).bind(d.day, `-${d.day} days`, BATCH_CAP).all();

      for (const lead of leads?.results || []) {
        if (sent.length >= BATCH_CAP) break;
        if (lead.unsubscribed) { skipped.unsubscribed++; continue; }
        if (lead.deep_status && lead.deep_status !== "none") { skipped.converted++; continue; }
        const hash = await hmacSha256(env, String(lead.email).toLowerCase());
        if (hash) {
          const sup = await env.LEADS_DB.prepare("SELECT 1 FROM suppression_list WHERE value_hash = ? LIMIT 1").bind(hash).first().catch(() => null);
          if (sup) { skipped.suppressed++; continue; }
        }
        let leak1 = "your top money leak";
        try {
          const r = JSON.parse(lead.teaser_json || "{}");
          if (r?.leaks?.[0]?.title) leak1 = `${r.leaks[0].title} — ${r.leaks[0].what || ""}`.slice(0, 220);
        } catch {}
        const ctx = { name: lead.name || "", business: lead.business || "", score: lead.teaser_score ?? "–", leak1 };
        try {
          const r = await sendCfEmail(env, {
            from: `MehyarSoft Audit <${FROM_EMAIL}>`,
            to: lead.email,
            subject: d.subject(ctx),
            text: d.text(ctx),
            html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#0f172a;">${d.html(ctx)}</body></html>`,
            replyTo: "mrswelim@gmail.com",
          });
          if (!r.ok) throw new Error(r.error || "send_failed");
          await env.LEADS_DB.prepare("INSERT OR IGNORE INTO audit_drip_sends (lead_id, day, status) VALUES (?, ?, 'sent')").bind(lead.id, d.day).run();
          sent.push({ lead_id: lead.id, day: d.day, email: lead.email });
        } catch (e) {
          skipped.failed++;
          await env.LEADS_DB.prepare("INSERT OR IGNORE INTO audit_drip_sends (lead_id, day, status, error) VALUES (?, ?, 'failed', ?)").bind(lead.id, d.day, String(e?.message || "send_failed").slice(0, 300)).run().catch(() => {});
        }
      }
    }
    return json({ ok: true, sent: sent.length, skipped, days: DRIP.map((d) => d.day) });
  } catch (e) {
    console.error("audit drip error", e?.message);
    return json({ ok: false, error: "drip_failed" }, 500);
  }
}
