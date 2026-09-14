// functions/api/audit/full-report/generate.js
// POST /api/audit/full-report/generate — build the $5 25-page evaluation.
// Auth: Bearer AUDIT_CRON_SECRET (called by the Stripe webhook or manually).
// Body: { report_id }

import { chatJson, safeJsonParse } from "../../_shared/llmChat.js";
import { FULL_REPORT_SYSTEM, buildFullReportUserMessage } from "../../_shared/auditPrompt.js";
import { sendCfEmail } from "../../_shared/cfEmail.js";

const FROM_EMAIL = "audit@mehyar.us";
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

// Reuse the signal extractor shape from scan.js (duplicated to stay decoupled).
function extractSignals(html, meta) {
  const get = (re) => { const m = html.match(re); return m ? m[1].trim() : ""; };
  const title = get(/<title[^>]*>([^<]{1,200})<\/title>/i);
  const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]{1,200}?)<\/h1>/gi)].map((m) => stripTags(m[1]).slice(0, 120)).filter(Boolean);
  const headings = [...html.matchAll(/<h[23][^>]*>([\s\S]{1,140}?)<\/h[23]>/gi)].map((m) => stripTags(m[1]).slice(0, 100)).filter(Boolean);
  const links = [...html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi)];
  const hasContactLink = links.some((m) => /contact|book|schedule|appointment|call|quote|estimate/i.test(m[1]));
  const text = stripTags(html);
  return {
    url: meta.requestedUrl, finalUrl: meta.finalUrl, status: meta.status,
    https: meta.finalUrl.startsWith("https"), loadMs: meta.loadMs,
    title: title || "",
    h1: h1s[0] || "", headlines: [...h1s.slice(1), ...headings].slice(0, 5),
    wordCount: text ? text.split(/\s+/).length : 0,
    textSample: text.slice(0, 3000),
    hasPhone: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.test(html),
    hasContactLink, formCount: (html.match(/<form[\s>]/gi) || []).length,
    hasViewport: /<meta[^>]+name=["']viewport["']/i.test(html),
    trust: [/testimonial/i.test(html) ? "testimonials" : "", /review/i.test(html) ? "reviews" : ""].filter(Boolean),
    hasSchema: /application\/ld\+json/i.test(html),
  };
}

function renderReportHtml(rep, meta) {
  const leakRows = (rep.leak_map || []).map((l, i) =>
    "<div style='border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin:10px 0;'>" +
    "<div style='font-weight:700'>" + (i + 1) + ". " + escapeHtml(l.area) +
    " <span style='font-size:12px;color:" + (l.severity === "critical" ? "#dc2626" : l.severity === "high" ? "#d97706" : "#64748b") + "'>[" + escapeHtml(l.severity || "") + "]</span></div>" +
    "<p style='color:#334155'>" + escapeHtml(l.finding) + "</p>" +
    "<p style='color:#b45309'><strong>💸 " + escapeHtml(l.estimated_monthly_impact) + "</strong></p>" +
    "<p style='color:#047857'><strong>Fix:</strong> " + escapeHtml(l.fix) + " <em>(" + escapeHtml(l.effort) + ")</em></p></div>"
  ).join("");
  const pages = (rep.page_by_page || []).map((p) =>
    "<div style='border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin:10px 0;'>" +
    "<div style='font-weight:700'>" + escapeHtml(p.page) + " — Grade: " + escapeHtml(p.grade) + "</div>" +
    "<ul>" + (p.issues || []).map((x) => "<li style='color:#334155'>" + escapeHtml(x) + "</li>").join("") + "</ul>" +
    "<p><strong>The one fix:</strong> " + escapeHtml(p.fix) + "</p></div>"
  ).join("");
  const gaps = (rep.competitor_gaps || []).map((g) => "<li style='color:#334155;margin:6px 0'>" + escapeHtml(g) + "</li>").join("");
  const phases = (rep.ai_blueprint || []).map((b) =>
    "<div style='border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin:10px 0;background:#f0fdf4'>" +
    "<div style='font-weight:700'>🤖 " + escapeHtml(b.pipeline) + " <span style='font-size:12px;color:#64748b'>" + escapeHtml(b.phase) + "</span></div>" +
    "<p style='color:#334155'>" + escapeHtml(b.what_it_does) + "</p>" +
    "<p style='color:#334155'><strong>Replaces:</strong> " + escapeHtml(b.replaces) + "</p>" +
    "<p style='color:#334155'><strong>Build cost:</strong> " + escapeHtml(b.estimated_cost_to_build) + "</p>" +
    "<p style='color:#047857'><strong>📈 " + escapeHtml(b.estimated_monthly_upside) + "</strong></p></div>"
  ).join("");
  const m500 = rep.five_hundred_percent_math || {};
  const math = (m500.math || []).map((x) => "<li style='color:#334155;margin:6px 0'>" + escapeHtml(x) + "</li>").join("");
  const caveats = (m500.honest_caveats || []).map((x) => "<li style='color:#64748b;margin:6px 0'>" + escapeHtml(x) + "</li>").join("");
  const plan = (rep.ninety_day_plan || []).map((p) =>
    "<div style='margin:12px 0'><div style='font-weight:700'>" + escapeHtml(p.month) + "</div>" +
    "<ul>" + (p.actions || []).map((a) => "<li style='color:#334155'>" + escapeHtml(a) + "</li>").join("") + "</ul>" +
    "<p style='color:#047857'><em>" + escapeHtml(p.expected_outcome) + "</em></p></div>"
  ).join("");

  return "<!DOCTYPE html><html><body style='font-family:Arial,sans-serif;max-width:700px;margin:0 auto;padding:24px;color:#0f172a'>" +
    "<p style='color:#64748b;font-size:13px'>MEHYARSOFT · FULL AI WEBSITE EVALUATION" + (rep.business_type_label ? " · " + escapeHtml(rep.business_type_label) : "") + "</p>" +
    "<h1>Your site scored " + rep.score + "/100</h1>" +
    "<p style='font-size:16px;color:#334155'>" + escapeHtml(rep.executive_summary) + "</p>" +
    "<h2>Leak map — every leak priced</h2>" + leakRows +
    "<h2>Page-by-page grades</h2>" + pages +
    "<h2>Competitor gaps</h2><ul>" + gaps + "</ul>" +
    "<h2>Your AI automation blueprint</h2>" + phases +
    "<h2>The 500% math — shown step by step</h2>" +
    "<p style='color:#334155'><strong>Today:</strong> " + escapeHtml(m500.current_capacity) + "</p>" +
    "<p style='color:#334155'><strong>With AI:</strong> " + escapeHtml(m500.ai_capacity) + "</p>" +
    "<p style='font-size:20px'><strong>Multiplier: " + escapeHtml(m500.multiplier) + "</strong></p>" +
    "<ol>" + math + "</ol>" +
    "<p style='color:#64748b'><strong>Honest caveats:</strong></p><ul>" + caveats + "</ul>" +
    "<h2>Your 90-day plan</h2>" + plan +
    "<div style='background:#0f172a;color:#fff;border-radius:12px;padding:20px;margin-top:24px'>" +
    "<p style='margin:0 0 8px;font-weight:700'>If you do only one thing:</p>" +
    "<p style='margin:0;color:#cbd5e1'>" + escapeHtml(rep.one_thing) + "</p></div>" +
    (rep.upsell_note ? "<p style='color:#64748b;margin-top:16px'><em>" + escapeHtml(rep.upsell_note) + "</em></p>" : "") +
    "<p style='color:#94a3b8;font-size:12px;margin-top:24px'><a href='" + UNSUB_URL + "' style='color:#94a3b8'>Unsubscribe</a> · " + PHYSICAL + "</p>" +
    "</body></html>";
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env?.LEADS_DB) return json({ ok: false, error: "service_unavailable" }, 503);
    const authz = request.headers.get("authorization") || "";
    if (!env.AUDIT_CRON_SECRET || authz !== "Bearer " + env.AUDIT_CRON_SECRET) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }
    const body = await request.json().catch(() => ({}));
    const reportId = Number(body.report_id);
    if (!reportId) return json({ ok: false, error: "invalid_report_id" }, 400);

    const row = await env.LEADS_DB.prepare(
      "SELECT * FROM audit_full_reports WHERE id = ?"
    ).bind(reportId).first();
    if (!row) return json({ ok: false, error: "not_found" }, 404);
    if (row.status === "ready") return json({ ok: true, already_ready: true, report_id: reportId });

    await env.LEADS_DB.prepare("UPDATE audit_full_reports SET status='generating' WHERE id = ?").bind(reportId).run();

    // Re-fetch the site for fresh signals.
    let url = row.url;
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    const t0 = Date.now();
    let html = "", status = 0, finalUrl = url;
    try {
      const resp = await fetch(url, {
        redirect: "follow",
        headers: { "user-agent": "MehyarSoft-AuditBot/1.0 (+https://mehyar.us/audit)", accept: "text/html" },
        signal: AbortSignal.timeout(10000),
      });
      status = resp.status; finalUrl = resp.url || url;
      const buf = await resp.arrayBuffer();
      html = new TextDecoder("utf-8", { fatal: false }).decode(buf.slice(0, 500_000));
    } catch (e) {
      await env.LEADS_DB.prepare("UPDATE audit_full_reports SET status='failed' WHERE id = ?").bind(reportId).run();
      return json({ ok: false, error: "fetch_failed" }, 422);
    }
    const signals = extractSignals(html, { requestedUrl: url, finalUrl, status, loadMs: Date.now() - t0 });

    // Pull the teaser for context if we have the lead.
    let teaser = null;
    if (row.lead_id) {
      const lead = await env.LEADS_DB.prepare("SELECT teaser_json FROM audit_leads WHERE id = ?").bind(row.lead_id).first();
      try { teaser = lead && lead.teaser_json ? JSON.parse(lead.teaser_json) : null; } catch { teaser = null; }
    }

    const ai = await chatJson({
      env,
      messages: [
        { role: "system", content: FULL_REPORT_SYSTEM },
        { role: "user", content: buildFullReportUserMessage(signals, teaser) },
      ],
      max_tokens: 6000,
      temperature: 0.4,
    });
    let report = null;
    if (ai.used_llm && ai.content) {
      const parsed = safeJsonParse(ai.content, null);
      if (parsed && typeof parsed.score === "number" && Array.isArray(parsed.leak_map)) report = parsed;
    }
    if (!report) {
      await env.LEADS_DB.prepare("UPDATE audit_full_reports SET status='failed' WHERE id = ?").bind(reportId).run();
      return json({ ok: false, error: "generation_failed" }, 500);
    }
    report.score = Math.max(0, Math.min(100, Math.round(report.score)));

    const htmlDoc = renderReportHtml(report, { email: row.email, url: row.url });
    await env.LEADS_DB.prepare(
      "UPDATE audit_full_reports SET status='ready', report_json=?, report_html=?, delivered_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?"
    ).bind(JSON.stringify(report).slice(0, 100000), htmlDoc.slice(0, 200000), reportId).run();

    // Email the full report.
    await sendCfEmail(env, {
      from: "MehyarSoft Audit <" + FROM_EMAIL + ">",
      to: row.email,
      subject: "Your full 25-page website evaluation is ready (score: " + report.score + "/100)",
      text: "Your full AI website evaluation is ready.\n\nScore: " + report.score + "/100\n\n" +
        (report.executive_summary || "") + "\n\nView it here: https://mehyar.us/audit/report?report_id=" + reportId + "\n\n" +
        "Unsubscribe: " + UNSUB_URL + "\n" + PHYSICAL,
      html: htmlDoc,
    });

    return json({ ok: true, report_id: reportId, status: "ready" });
  } catch (e) {
    console.error("full-report generate error", e && e.message);
    return json({ ok: false, error: "generation_failed" }, 500);
  }
}
