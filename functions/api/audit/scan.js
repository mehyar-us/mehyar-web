// functions/api/audit/scan.js
// POST /api/audit/scan — free 60-second AI website audit (lead magnet).
// Body: { url, email, name?, business? }
// Fetches the site, extracts revenue signals, runs the Mayor Audit Engine
// (Llama 3.3 70B via Workers AI), stores the lead, emails the teaser report.

import { chatJson, safeJsonParse } from "../_shared/llmChat.js";
import { TEASER_SYSTEM, buildTeaserUserMessage } from "../_shared/auditPrompt.js";
import { sendCfEmail } from "../_shared/cfEmail.js";

const FROM_EMAIL = "audit@mehyar.us";
const OWNER_EMAIL = "mrswelim@gmail.com"; // direct — info@mehyar.us forward is down (Email Routing disabled, Zoho MX conflict)
const UNSUB_URL = "https://mehyar.us/unsubscribe";
const PHYSICAL = "MehyarSoft LLC, 228 Park Ave S #92842, New York, NY 10003";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function sanitize(v, max = 200) {
  return String(v || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

async function sha256hex(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function normalizeUrl(raw) {
  let u = sanitize(raw, 300);
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  let parsed;
  try { parsed = new URL(u); } catch { return null; }
  if (!/^https?:$/.test(parsed.protocol)) return null;
  const host = parsed.hostname.toLowerCase();
  // Block private/internal targets — this fetch runs server-side.
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?)/.test(host)) return null;
  if (host.endsWith(".local") || host === "localhost") return null;
  return parsed.toString();
}

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function extractSignals(html, meta) {
  const lower = html.toLowerCase();
  const get = (re) => { const m = html.match(re); return m ? m[1].trim() : ""; };

  const title = get(/<title[^>]*>([^<]{1,200})<\/title>/i);
  const metaDesc = get(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,300})/i)
    || get(/<meta[^>]+content=["']([^"']{1,300})["'][^>]+name=["']description["']/i);
  const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]{1,200}?)<\/h1>/gi)].map((m) => stripTags(m[1]).slice(0, 120)).filter(Boolean);
  const headings = [...html.matchAll(/<h[23][^>]*>([\s\S]{1,140}?)<\/h[23]>/gi)].map((m) => stripTags(m[1]).slice(0, 100)).filter(Boolean);

  const phones = [...new Set([...html.matchAll(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g)].map((m) => m[0]))].slice(0, 3);
  const emails = [...new Set([...html.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)].map((m) => m[0].toLowerCase()))]
    .filter((e) => !e.includes("example.") && !e.includes("sentry") && !e.includes(".png") && !e.includes(".jpg")).slice(0, 3);

  const links = [...html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi)];
  const linkTexts = links.map((m) => stripTags(m[2]).toLowerCase());
  const hasContactLink = links.some((m) => /contact|book|schedule|appointment|call|quote|estimate/i.test(m[1]) || /contact|book|schedule|appointment|call us|get (a )?quote|free estimate/i.test(stripTags(m[2])));
  const ctaPhrases = [...new Set(linkTexts.filter((t) => t.length > 2 && t.length < 40 && /book|call|schedule|quote|estimate|buy|shop|order|sign|start|try|demo|contact|learn more|get/i.test(t)))].slice(0, 8);
  const formCount = (html.match(/<form[\s>]/gi) || []).length;

  const socials = [];
  if (/facebook\.com\//i.test(html)) socials.push("Facebook");
  if (/instagram\.com\//i.test(html)) socials.push("Instagram");
  if (/linkedin\.com\//i.test(html)) socials.push("LinkedIn");
  if (/(twitter\.com|x\.com)\//i.test(html)) socials.push("X");
  if (/youtube\.com\//i.test(html)) socials.push("YouTube");
  if (/tiktok\.com\//i.test(html)) socials.push("TikTok");

  const trust = [];
  if (/testimonial/i.test(html)) trust.push("testimonials");
  if (/review/i.test(html)) trust.push("reviews");
  if (/guarantee/i.test(html)) trust.push("guarantee");
  if (/award|certified|licensed|insured|bbb/i.test(html)) trust.push("credentials/awards");
  if (/as seen|featured|press|media/i.test(html)) trust.push("press mentions");

  const imgs = [...html.matchAll(/<img[^>]*>/gi)];
  const imgsMissingAlt = imgs.filter((m) => !/alt=["'][^"']+["']/i.test(m[0])).length;

  const text = stripTags(html);
  const wordCount = text ? text.split(/\s+/).length : 0;
  const textSample = text.slice(0, 3000);
  const hasAddress = /\d{1,5}\s+[A-Za-z0-9.' ]+\s+(street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|way|court|ct|plaza)/i.test(text)
    || /\b[A-Z]{2}\s+\d{5}(-\d{4})?\b/.test(text);

  return {
    url: meta.requestedUrl,
    finalUrl: meta.finalUrl,
    status: meta.status,
    https: meta.finalUrl.startsWith("https"),
    loadMs: meta.loadMs,
    title: title || "",
    metaDescription: metaDesc || "",
    h1: h1s[0] || "",
    headlines: [...h1s.slice(1), ...headings].slice(0, 5),
    wordCount,
    hasPhone: phones.length > 0,
    phoneSample: phones[0] || "",
    hasEmail: emails.length > 0,
    hasContactLink,
    formCount,
    ctas: ctaPhrases,
    hasViewport: /<meta[^>]+name=["']viewport["']/i.test(html),
    socials,
    hasAddress,
    textSample,
    trust,
    imagesMissingAlt: imgsMissingAlt,
    imageCount: imgs.length,
    hasSchema: /application\/ld\+json/i.test(html) || /itemtype=["']http:\/\/schema\.org/i.test(html),
  };
}

function heuristicFallback(signals) {
  // If the LLM fails, still deliver an honest signal-based teaser.
  const leaks = [];
  if (!signals.hasPhone) leaks.push({ title: "No phone number found", what: "We could not find a phone number on your homepage. Mobile visitors who want to call now have to hunt for it — most won't.", money: "Estimated: even 5 lost calls a month at your average job value adds up fast." });
  if (!signals.hasContactLink) leaks.push({ title: "No clear booking path", what: "We found no obvious contact, booking, or quote link. Visitors ready to buy hit a dead end.", money: "Estimated: a missing booking path can cost 10-30% of ready-to-buy visitors." });
  if (!signals.metaDescription) leaks.push({ title: "Missing meta description", what: "Your page has no meta description, so Google writes your search snippet for you — usually badly.", money: "Estimated: weak snippets cut click-through from search, compounding monthly." });
  while (leaks.length < 3) leaks.push({ title: "Thin trust signals", what: "We found few reviews, testimonials, or credentials on the homepage. Buyers choose the business they trust fastest.", money: "Estimated: trust gaps quietly hand sales to competitors every week." });
  return {
    business_type: "other",
    business_type_label: "Business",
    score: Math.max(25, 70 - leaks.length * 8 - (signals.https ? 0 : 10)),
    verdict: "Your site has the basics but leaves money on the table at every step.",
    leaks: leaks.slice(0, 3),
    quick_wins: [
      "Add a click-to-call phone number in the header — 10 minutes, captures mobile buyers.",
      "Put one clear booking or quote button above the fold — 30 minutes, stops dead-end visits.",
      "Add 3 short customer reviews to the homepage — 1 hour, lifts trust instantly.",
    ],
    ai_pipelines: [
      { name: "AI Voice Assistant", what: "Answers calls, books appointments, and qualifies leads 24/7 — never misses an opportunity.", upside: "Estimated: handle 3-5x the call volume without hiring — assumes current missed-call rate." },
      { name: "Automated Follow-Up Engine", what: "Every lead, quote, and customer gets timely, personalized follow-up without you lifting a finger.", upside: "Estimated: recovers 10-20% of quotes that currently go cold." },
      { name: "Document Scanner", what: "Snap a photo of any document — AI extracts the data and flags what needs attention.", upside: "Estimated: cuts admin hours by half on paperwork-heavy weeks." },
    ],
    full_report_hooks: [
      "The $5 full report grades every page of your site and shows the 500% AI upside math step by step.",
      "It includes a 90-day AI automation blueprint tailored to your business type.",
    ],
    _fallback: true,
  };
}

function reportEmailHtml(lead, report) {
  const leakRows = (report.leaks || []).map((l, i) => `
    <div style="border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin:12px 0;">
      <div style="font-weight:700;color:#0f172a;">${i + 1}. ${escapeHtml(l.title)}</div>
      <p style="color:#334155;margin:8px 0;">${escapeHtml(l.what)}</p>
      <p style="color:#b45309;margin:0;"><strong>💸 ${escapeHtml(l.money)}</strong></p>
    </div>`).join("");
  const wins = (report.quick_wins || []).map((w) => `<li style="margin:6px 0;color:#334155;">${escapeHtml(w)}</li>`).join("");
  const pipelines = (report.ai_pipelines || []).map((p, i) => `
    <div style="border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin:12px 0;">
      <div style="font-weight:700;color:#0f172a;">🤖 ${escapeHtml(p.name)}</div>
      <p style="color:#334155;margin:8px 0;">${escapeHtml(p.what)}</p>
      <p style="color:#047857;margin:0;"><strong>📈 ${escapeHtml(p.upside)}</strong></p>
    </div>`).join("");
  const bizLabel = report.business_type_label ? ` · ${escapeHtml(report.business_type_label)}` : "";
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#0f172a;">
    <p style="color:#64748b;font-size:13px;">MEHYARSOFT · AI WEBSITE AUDIT${bizLabel}</p>
    <h1 style="font-size:26px;">Your site scored ${report.score}/100${lead.business ? `, ${escapeHtml(lead.business)}` : ""}</h1>
    <p style="font-size:16px;color:#334155;"><em>"${escapeHtml(report.verdict)}"</em></p>
    <h2 style="font-size:18px;margin-top:24px;">Where you're leaking money</h2>
    ${leakRows}
    <h2 style="font-size:18px;margin-top:24px;">3 quick wins</h2>
    <ol style="padding-left:20px;">${wins}</ol>
    ${pipelines ? `<h2 style="font-size:18px;margin-top:24px;">Your AI upside — up to 5x capacity</h2>${pipelines}` : ""}
    <div style="background:#0f172a;color:#fff;border-radius:12px;padding:20px;margin-top:24px;">
      <p style="margin:0 0 8px;font-weight:700;font-size:18px;">Get the full 25-page evaluation — just $5</p>
      <p style="margin:0 0 12px;color:#cbd5e1;">Every page graded. Competitor gaps. The 500% AI automation blueprint with the math shown step by step. 90-day plan.</p>
      <a href="https://mehyar.us/audit/report" style="display:inline-block;background:#22c55e;color:#052e16;font-weight:700;padding:12px 24px;border-radius:8px;text-decoration:none;">Get my full report — $5</a>
    </div>
    <p style="color:#94a3b8;font-size:12px;margin-top:24px;">You received this because you requested a free website audit at mehyar.us.<br>
    <a href="${UNSUB_URL}" style="color:#94a3b8;">Unsubscribe</a> · ${PHYSICAL}</p>
  </body></html>`;
}

function reportEmailText(lead, report) {
  const leaks = (report.leaks || []).map((l, i) => `${i + 1}. ${l.title}\n   ${l.what}\n   Money: ${l.money}`).join("\n\n");
  const pipes = (report.ai_pipelines || []).map((p, i) => `${i + 1}. ${p.name}\n   ${p.what}\n   Upside: ${p.upside}`).join("\n\n");
  return `MEHYARSOFT · AI WEBSITE AUDIT${report.business_type_label ? " · " + report.business_type_label : ""}\n\nYour site scored ${report.score}/100\n"${report.verdict}"\n\nWHERE YOU'RE LEAKING MONEY\n${leaks}\n\n3 QUICK WINS\n${(report.quick_wins || []).map((w, i) => `${i + 1}. ${w}`).join("\n")}\n\nYOUR AI UPSIDE\n${pipes}\n\nGet the full 25-page evaluation for just $5: https://mehyar.us/audit/report\n\nUnsubscribe: ${UNSUB_URL}\n${PHYSICAL}`;
}

function escapeHtml(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env?.LEADS_DB) return json({ ok: false, error: "service_unavailable" }, 503);
    const body = await request.json().catch(() => ({}));
    const email = sanitize(body.email, 254).toLowerCase();
    const url = normalizeUrl(body.url);
    const name = sanitize(body.name, 120);
    const business = sanitize(body.business, 160);

    // Internal mode: prospect auto-scan. Bearer AUDIT_CRON_SECRET, no lead
    // capture, no emails — returns the AI report only. Powers the Mayor
    // outreach engine's personalized cold emails.
    const authz = request.headers.get("authorization") || "";
    const internal = body.internal === true
      && env.AUDIT_CRON_SECRET
      && authz === "Bearer " + env.AUDIT_CRON_SECRET;

    // Client IP — declared once, used by Turnstile verification and rate limiting.
    const clientIp = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

    if (!internal) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: "invalid_email" }, 400);
      // Server-side Turnstile verification (public scans only).
      const token = sanitize(body.turnstileToken || body.turnstile_token, 2048);
      if (env.TURNSTILE_SECRET_KEY) {
        if (!token) return json({ ok: false, error: "captcha_required", message: "Please complete the verification and try again." }, 400);
        try {
          const verifyResp = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: clientIp }),
            signal: AbortSignal.timeout(8000),
          });
          const verifyData = await verifyResp.json().catch(() => ({}));
          if (!verifyData.success) {
            return json({ ok: false, error: "captcha_failed", message: "Verification failed — please try again." }, 400);
          }
        } catch {
          return json({ ok: false, error: "captcha_failed", message: "Verification failed — please try again." }, 400);
        }
      }
    }
    if (!url) return json({ ok: false, error: "invalid_url" }, 400);

    // Rate limit: 3 scans/hour per IP (KV best-effort). Skipped for internal.
    const ipHash = await sha256hex("audit-scan|" + clientIp);
    if (env?.INTAKE_KV && !internal) {
      const k = `audit:scan:ip:${ipHash}`;
      const n = Number((await env.INTAKE_KV.get(k)) || "0");
      if (n >= 3) return json({ ok: false, error: "rate_limited", message: "Too many scans — try again in an hour." }, 429);
      await env.INTAKE_KV.put(k, String(n + 1), { expirationTtl: 3600 });
    }

    // Fetch the site.
    const t0 = Date.now();
    let html = "", status = 0, finalUrl = url;
    try {
      const resp = await fetch(url, {
        redirect: "follow",
        headers: { "user-agent": "MehyarSoft-AuditBot/1.0 (+https://mehyar.us/audit)", accept: "text/html" },
        signal: AbortSignal.timeout(7000),
      });
      status = resp.status;
      finalUrl = resp.url || url;
      const ct = resp.headers.get("content-type") || "";
      if (ct.includes("html") || ct.includes("text")) {
        const buf = await resp.arrayBuffer();
        html = new TextDecoder("utf-8", { fatal: false }).decode(buf.slice(0, 500_000));
      }
    } catch (e) {
      return json({ ok: false, error: "fetch_failed", message: "We couldn't load that site. Check the URL and try again." }, 422);
    }
    if (!html || status >= 400) {
      return json({ ok: false, error: "fetch_failed", message: "That page didn't return readable content. Try the homepage URL." }, 422);
    }
    const signals = extractSignals(html, { requestedUrl: url, finalUrl, status, loadMs: Date.now() - t0 });

    // AI analysis — GPT-OSS 120B, strongest model on Workers AI.
    let report;
    const ai = await chatJson({
      env,
      messages: [
        { role: "system", content: TEASER_SYSTEM },
        { role: "user", content: buildTeaserUserMessage(signals) },
      ],
      max_tokens: 2500,
      temperature: 0.3,
    });
    if (ai.used_llm && ai.content) {
      const parsed = safeJsonParse(ai.content, null);
      if (parsed && typeof parsed.score === "number" && Array.isArray(parsed.leaks) && parsed.leaks.length >= 3) {
        // Backfill new v2 fields if the model omitted them.
        if (!Array.isArray(parsed.ai_pipelines)) parsed.ai_pipelines = heuristicFallback(signals).ai_pipelines;
        if (!Array.isArray(parsed.full_report_hooks)) parsed.full_report_hooks = heuristicFallback(signals).full_report_hooks;
        if (!parsed.business_type) parsed.business_type = "other";
        if (!parsed.business_type_label) parsed.business_type_label = "Business";
        report = parsed;
      }
    }
    if (!report) report = heuristicFallback(signals);
    report.score = Math.max(0, Math.min(100, Math.round(report.score)));

    // Internal mode: return the report only — no lead capture, no emails.
    if (internal) {
      return json({ ok: true, internal: true, report: { ...report, _fallback: undefined } });
    }

    // Store lead.
    const leadRes = await env.LEADS_DB.prepare(
      `INSERT INTO audit_leads (email, name, business, url, teaser_score, teaser_json, ip_hash, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'site')`
    ).bind(email, name || null, business || null, finalUrl, report.score, JSON.stringify(report).slice(0, 20000), ipHash).run();
    const leadId = leadRes?.meta?.last_row_id || null;

    // Email the teaser report to the lead via Cloudflare Email Sending
    // (verified path — see _shared/cfEmail.js). NOTIFY_EMAIL binding was
    // never attached in production; the API path needs no binding.
    const lead = { email, name, business };
    let emailed = false;
    {
      const r = await sendCfEmail(env, {
        from: `MehyarSoft Audit <${FROM_EMAIL}>`,
        to: email,
        subject: `Your website scored ${report.score}/100 — 3 money leaks inside`,
        text: reportEmailText(lead, report),
        html: reportEmailHtml(lead, report),
        replyTo: OWNER_EMAIL,
      });
      emailed = r.ok;
      if (!r.ok) console.error("audit report email failed", r.error);
      // Owner notification.
      const n = await sendCfEmail(env, {
        from: `MehyarSoft Audit <${FROM_EMAIL}>`,
        to: OWNER_EMAIL,
        subject: `🔍 New audit lead: ${business || email} scored ${report.score}`,
        text: `New free audit scan\nEmail: ${email}\nName: ${name || "-"}\nBusiness: ${business || "-"}\nURL: ${finalUrl}\nScore: ${report.score}/100\nLead ID: ${leadId}`,
      });
      if (!n.ok) console.error("audit owner notify failed", n.error);
    }

    return json({ ok: true, lead_id: leadId, report: { ...report, _fallback: undefined }, emailed });
  } catch (e) {
    console.error("audit scan error", e?.message);
    return json({ ok: false, error: "scan_failed" }, 500);
  }
}
