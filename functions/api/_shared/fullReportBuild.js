// functions/api/_shared/fullReportBuild.js
// Shared paid-report builder used by generate.js (webhook-driven) and retry.js.
// Bounded same-origin crawl -> deterministic page grades -> 3 focused LLM calls
// -> branded HTML + JSON -> D1 store -> customer email.
//
// HONESTY CONTRACT:
// - page_by_page grades/scores/issues are computed deterministically from
//   measured signals. Never invented.
// - The report JSON always carries crawl.pages_crawled and a note saying
//   exactly which pages were evaluated.
// - Competitor content is framed as typical industry patterns, never real
//   competitors. Every dollar figure is an estimate with assumptions.
// - The builder is idempotent: it claims the row with a status lease so a
//   re-fire never double-builds a ready report.

import { chatJson, safeJsonParse } from "./llmChat.js";
import {
  buildFullReportContext,
  FULL_REPORT_LEAKS_SYSTEM,
  FULL_REPORT_TRUST_SEO_SYSTEM,
  FULL_REPORT_BLUEPRINT_SYSTEM,
} from "./auditPrompt.js";
import { sendCfEmail } from "./cfEmail.js";

const FROM_EMAIL = "audit@mehyar.us";
const OWNER_EMAIL = "mrswelim@gmail.com";
const UNSUB_URL = "https://mehyar.us/unsubscribe";
const PHYSICAL = "MehyarSoft LLC, 228 Park Ave S #92842, New York, NY 10003";
const UA = "MehyarSoft-AuditBot/1.0 (+https://mehyar.us/audit)";

const MAX_PAGES = 7; // homepage + up to 6 internal pages
const HOME_TIMEOUT_MS = 10000;
const PAGE_TIMEOUT_MS = 7000;
const PAGE_BYTE_CAP = 500_000;
const STUCK_MINUTES = 10;

function nowIso() {
  return new Date().toISOString();
}

function sanitize(v, max) {
  return String(v || "")
    .replace(/[^ -~\u00A0-\uFFFF]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max || 300);
}

// Block private/internal targets — this fetch runs server-side (SSRF guard).
function normalizeUrl(raw) {
  let u = sanitize(raw, 300);
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  let parsed;
  try { parsed = new URL(u); } catch { return null; }
  if (!/^https?:$/.test(parsed.protocol)) return null;
  const host = parsed.hostname.toLowerCase();
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?)/.test(host)) return null;
  if (host.endsWith(".local") || host === "localhost") return null;
  return parsed.toString();
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

// Full signal extraction (same shape as scan.js).
function extractSignals(html, meta) {
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
  const trust = [];
  if (/testimonial/i.test(html)) trust.push("testimonials");
  if (/review/i.test(html)) trust.push("reviews");
  if (/guarantee/i.test(html)) trust.push("guarantee");
  if (/award|certified|licensed|insured|bbb/i.test(html)) trust.push("credentials/awards");
  if (/as seen|featured|press|media/i.test(html)) trust.push("press mentions");
  const imgs = [...html.matchAll(/<img[^>]*>/gi)];
  const imgsMissingAlt = imgs.filter((m) => !/alt=["'][^"']+["']/i.test(m[0])).length;
  const text = stripTags(html);
  return {
    url: meta.requestedUrl, finalUrl: meta.finalUrl, status: meta.status,
    https: String(meta.finalUrl || "").startsWith("https"), loadMs: meta.loadMs,
    title, metaDescription: metaDesc, h1: h1s[0] || "",
    headlines: [...h1s.slice(1), ...headings].slice(0, 5),
    wordCount: text ? text.split(/\s+/).length : 0,
    hasPhone: phones.length > 0, hasEmail: emails.length > 0,
    hasContactLink, formCount, ctas: ctaPhrases,
    hasViewport: /<meta[^>]+name=["']viewport["']/i.test(html),
    trust, hasSchema: /application\/ld\+json/i.test(html),
    imgsMissingAlt, imgCount: imgs.length,
  };
}

// Deterministic page grade from measured signals only. 0-100 -> A-F.
function gradePage(sig) {
  let s = 0;
  const checks = [];
  if (sig.status === 200) s += 8; else checks.push("bad_status");
  if (sig.title) s += 10; else checks.push("no_title");
  if (sig.h1) s += 10; else checks.push("no_h1");
  if (sig.metaDescription) s += 5; else checks.push("no_meta_desc");
  if (sig.hasViewport) s += 10; else checks.push("no_viewport");
  const contactPath = sig.hasPhone || sig.hasEmail || sig.hasContactLink || sig.formCount > 0;
  if (contactPath) s += 15; else checks.push("no_contact_path");
  if (sig.ctas && sig.ctas.length > 0) s += 10; else checks.push("no_cta");
  if (sig.wordCount >= 300) s += 10; else if (sig.wordCount >= 100) s += 5; else checks.push("thin_content");
  if (sig.trust && sig.trust.length > 0) s += 10; else checks.push("no_trust");
  if (sig.hasSchema) s += 4; else checks.push("no_schema");
  if (sig.https) s += 8; else checks.push("not_https");
  s = Math.max(0, Math.min(100, s));
  const grade = s >= 90 ? "A" : s >= 78 ? "B" : s >= 65 ? "C" : s >= 50 ? "D" : "F";
  return { score: s, grade, checks, contactPath };
}

const ISSUE_TEXT = {
  no_title: "No page title — search results and browser tabs show a bare URL",
  no_h1: "No H1 headline — a visitor can't tell what you do in 3 seconds",
  no_meta_desc: "Missing meta description — Google writes your snippet for you",
  no_viewport: "No mobile viewport tag — phones render a shrunken desktop page",
  no_contact_path: "No clear way to reach you — no phone, email, booking link, or form found on this page",
  no_cta: "No call-to-action buttons detected — nothing tells the visitor what to do next",
  thin_content: "Thin content — too few words for Google or a buyer to evaluate you",
  no_trust: "Zero trust signals on this page — no reviews, testimonials, or credentials",
  no_schema: "No structured data — search engines get no machine-readable facts about the business",
  not_https: "Not served over HTTPS — browsers warn visitors away",
  bad_status: "Page did not return a clean 200 response",
};

const ISSUE_FIX = {
  no_contact_path: "Add one unmissable contact path above the fold: click-to-call phone number or a 3-field quote form.",
  no_viewport: "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"> and test on a real phone.",
  no_h1: "Write one H1 that says what you do, for whom, and where — e.g. 'Emergency Plumber in Brooklyn — 60-Min Response'.",
  no_title: "Set a unique <title> per page: Service + City + Brand.",
  no_cta: "Add one primary button above the fold with a verb: Call, Book, Get Quote.",
  no_trust: "Add 3 Google reviews with names, plus any license/insurance badge.",
  thin_content: "Expand to 300+ useful words answering the buyer's top 3 questions.",
  no_meta_desc: "Write a 150-character meta description with the service, city, and a reason to click.",
  no_schema: "Add LocalBusiness schema.org JSON-LD with name, phone, address, hours.",
  not_https: "Serve the whole site over HTTPS and redirect HTTP to HTTPS.",
  bad_status: "Fix the server response for this URL — it should return HTTP 200.",
};

const FIX_PRIORITY = ["no_contact_path", "no_viewport", "no_h1", "no_title", "no_cta", "no_trust", "thin_content", "no_meta_desc", "no_schema", "not_https", "bad_status"];

function pageLabel(urlStr, isHome) {
  if (isHome) return "Homepage";
  try {
    const u = new URL(urlStr);
    const seg = u.pathname.split("/").filter(Boolean).pop() || "Page";
    return seg.replace(/[-_]+/g, " ").replace(/\.\w+$/, "").replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 40) || "Page";
  } catch { return "Page"; }
}

async function fetchPage(url, timeoutMs) {
  const t0 = Date.now();
  try {
    const resp = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const ct = resp.headers.get("content-type") || "";
    const finalUrl = resp.url || url;
    if (!/html/i.test(ct)) {
      return { url, finalUrl, status: resp.status, ok: false, skip: "non_html", loadMs: Date.now() - t0 };
    }
    const buf = await resp.arrayBuffer();
    const html = new TextDecoder("utf-8", { fatal: false }).decode(buf.slice(0, PAGE_BYTE_CAP));
    return { url, finalUrl, status: resp.status, ok: resp.ok, html, loadMs: Date.now() - t0 };
  } catch (e) {
    return { url, ok: false, error: String((e && e.message) || e).slice(0, 100), loadMs: Date.now() - t0 };
  }
}

const SKIP_PATH = /(login|signin|sign-in|sign_up|signup|register|cart|checkout|payment|admin|wp-admin|wp-login|account|password|logout|search|privacy|terms|cookie)/i;
const SKIP_EXT = /\.(pdf|jpe?g|png|gif|webp|svg|ico|css|js|xml|json|zip|mp4|mov|avi|woff2?|ttf)(\?|#|$)/i;

function extractInternalLinks(html, baseUrl, host) {
  const out = [];
  const seen = new Set();
  for (const m of html.matchAll(/<a[^>]+href=["']([^"'#]+)["']/gi)) {
    const raw = m[1].trim();
    if (!raw || /^(mailto:|tel:|javascript:|#)/i.test(raw)) continue;
    if (SKIP_EXT.test(raw)) continue;
    let abs;
    try { abs = new URL(raw, baseUrl); } catch { continue; }
    if (abs.hostname.toLowerCase() !== host) continue;
    if (!/^https?:$/.test(abs.protocol)) continue;
    if (SKIP_PATH.test(abs.pathname)) continue;
    abs.hash = "";
    const key = abs.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

async function crawlSite(homeUrl) {
  const host = new URL(homeUrl).hostname.toLowerCase();
  const pages = [];
  const seen = new Set([homeUrl]);

  const home = await fetchPage(homeUrl, HOME_TIMEOUT_MS);
  pages.push({ ...home, isHome: true });
  if (home.ok && home.html) {
    const links = extractInternalLinks(home.html, home.finalUrl || homeUrl, host);
    for (const link of links) {
      if (pages.length >= MAX_PAGES) break;
      if (seen.has(link)) continue;
      seen.add(link);
      const p = await fetchPage(link, PAGE_TIMEOUT_MS);
      pages.push({ ...p, isHome: false });
    }
  }
  return pages;
}

async function setStatus(env, id, status, failureReason) {
  await env.LEADS_DB.prepare(
    "UPDATE audit_full_reports SET status=?, failure_reason=?, status_changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?"
  ).bind(status, failureReason || null, id).run();
}

async function llmSection(env, system, context, maxTokens, attempts, timeoutMs) {
  let lastErr = "";
  for (let i = 0; i < (attempts || 2); i++) {
    const ai = await chatJson({
      env,
      messages: [
        { role: "system", content: system },
        { role: "user", content: context },
      ],
      max_tokens: maxTokens,
      temperature: 0.4,
      timeout_ms: timeoutMs || 150000,
    });
    if (ai.used_llm && ai.content) {
      const parsed = safeJsonParse(ai.content, null);
      if (parsed && typeof parsed === "object") return { ok: true, data: parsed };
      lastErr = "bad_json";
    } else {
      lastErr = ai.error || "llm_failed";
    }
  }
  return { ok: false, error: lastErr };
}

function renderReportHtml(rep, meta) {
  const sec = (title, inner) => "<h2>" + escapeHtml(title) + "</h2>" + inner;
  const card = (inner, bg) => "<div style='border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin:10px 0" + (bg ? ";background:" + bg : "") + "'>" + inner + "</div>";
  const ul = (arr) => "<ul>" + (arr || []).map((x) => "<li style='color:#334155;margin:6px 0'>" + escapeHtml(x) + "</li>").join("") + "</ul>";

  const crawlNote = rep.crawl && rep.crawl.pages_crawled
    ? "<p style='color:#64748b;font-size:13px'>Evaluated from " + rep.crawl.pages_crawled + " page(s) we actually fetched on " + escapeHtml(rep.crawl.crawled_at || "") + ". " + escapeHtml(rep.crawl.note || "") + "</p>"
    : "";

  const leakRows = (rep.leak_map || []).map((l, i) =>
    card("<div style='font-weight:700'>" + (i + 1) + ". " + escapeHtml(l.area) +
      " <span style='font-size:12px;color:" + (l.severity === "critical" ? "#dc2626" : l.severity === "high" ? "#d97706" : "#64748b") + "'>[" + escapeHtml(l.severity || "") + "]</span></div>" +
      "<p style='color:#334155'>" + escapeHtml(l.finding) + "</p>" +
      "<p style='color:#b45309'><strong>💸 " + escapeHtml(l.estimated_monthly_impact) + "</strong></p>" +
      "<p style='color:#047857'><strong>Fix:</strong> " + escapeHtml(l.fix) + " <em>(" + escapeHtml(l.effort) + ")</em></p>")
  ).join("");

  const ct = rep.conversion_teardown || {};
  const teardown = card(
    "<div style='font-weight:700'>CTA analysis</div><p style='color:#334155'>" + escapeHtml(ct.cta_analysis) + "</p>" +
    "<div style='font-weight:700;margin-top:8px'>Friction points</div>" + ul(ct.friction_points) +
    "<div style='font-weight:700;margin-top:8px'>Quick fixes</div>" + ul(ct.quick_fixes)
  );

  const pages = (rep.page_by_page || []).map((p) =>
    card("<div style='font-weight:700'>" + escapeHtml(p.page) + " — Grade: " + escapeHtml(p.grade) + " (" + p.score + "/100)</div>" +
      "<p style='color:#64748b;font-size:12px'>" + escapeHtml(p.url || "") + "</p>" +
      ul(p.issues) +
      "<p><strong>The one fix:</strong> " + escapeHtml(p.fix) + "</p>")
  ).join("");

  const tc = rep.trust_credibility || {};
  const trust = card("<p style='color:#334155'>" + escapeHtml(tc.summary) + "</p>" +
    "<div style='font-weight:700'>Findings</div>" + ul(tc.findings) +
    "<div style='font-weight:700'>Fixes</div>" + ul(tc.fixes));

  const sv = rep.seo_visibility || {};
  const seo = card("<div style='font-weight:700'>Checks (from real page signals)</div>" + ul(sv.basics) +
    "<div style='font-weight:700'>Fixes</div>" + ul(sv.fixes));

  const hc = rep.how_you_compare || {};
  const compare = card(
    "<p style='color:#64748b;font-size:13px'><em>" + escapeHtml(hc.frame || "Typical patterns for this business type — not your actual competitors.") + "</em></p>" +
    ul(hc.patterns) +
    "<p style='color:#64748b;font-size:13px'>" + escapeHtml(hc.honest_note || "") + "</p>", "#f8fafc");

  const phases = (rep.ai_blueprint || []).map((b) =>
    card("<div style='font-weight:700'>🤖 " + escapeHtml(b.pipeline) + " <span style='font-size:12px;color:#64748b'>" + escapeHtml(b.phase) + "</span></div>" +
      "<p style='color:#334155'>" + escapeHtml(b.what_it_does) + "</p>" +
      "<p style='color:#334155'><strong>Replaces:</strong> " + escapeHtml(b.replaces) + "</p>" +
      "<p style='color:#334155'><strong>Build cost:</strong> " + escapeHtml(b.estimated_cost_to_build) + "</p>" +
      "<p style='color:#047857'><strong>📈 " + escapeHtml(b.estimated_monthly_upside) + "</strong></p>", "#f0fdf4")
  ).join("");

  const m500 = rep.five_hundred_percent_math || {};
  const math = card(
    "<p style='color:#334155'><strong>Today:</strong> " + escapeHtml(m500.current_capacity) + "</p>" +
    "<p style='color:#334155'><strong>With AI:</strong> " + escapeHtml(m500.ai_capacity) + "</p>" +
    "<p style='font-size:20px'><strong>Multiplier: " + escapeHtml(m500.multiplier) + "</strong></p>" +
    "<ol>" + (m500.math || []).map((x) => "<li style='color:#334155;margin:6px 0'>" + escapeHtml(x) + "</li>").join("") + "</ol>" +
    "<p style='color:#64748b'><strong>Honest caveats — what must be true for this math to hold:</strong></p>" + ul(m500.honest_caveats));

  const plan = (rep.ninety_day_plan || []).map((p) =>
    "<div style='margin:12px 0'><div style='font-weight:700'>" + escapeHtml(p.month) + "</div>" +
    ul(p.actions) +
    "<p style='color:#047857'><em>" + escapeHtml(p.expected_outcome) + "</em></p></div>"
  ).join("");

  return "<!DOCTYPE html><html><body style='font-family:Arial,sans-serif;max-width:700px;margin:0 auto;padding:24px;color:#0f172a'>" +
    "<p style='color:#64748b;font-size:13px'>MEHYARSOFT · FULL AI WEBSITE EVALUATION" + (rep.business_type_label ? " · " + escapeHtml(rep.business_type_label) : "") + "</p>" +
    "<h1>Your site scored " + rep.score + "/100</h1>" +
    "<p style='font-size:16px;color:#334155'>" + escapeHtml(rep.executive_summary) + "</p>" +
    crawlNote +
    sec("Leak map — every leak priced", leakRows) +
    sec("Conversion teardown", teardown) +
    sec("Page-by-page grades (measured, not guessed)", pages) +
    sec("Trust & credibility audit", trust) +
    sec("SEO & visibility basics", seo) +
    sec("How you compare — typical patterns", compare) +
    sec("Your AI automation blueprint", phases) +
    sec("The multiplier math — shown step by step", math) +
    sec("Your 90-day plan", plan) +
    "<div style='background:#0f172a;color:#fff;border-radius:12px;padding:20px;margin-top:24px'>" +
    "<p style='margin:0 0 8px;font-weight:700'>If you do only one thing:</p>" +
    "<p style='margin:0;color:#cbd5e1'>" + escapeHtml(rep.one_thing) + "</p></div>" +
    (rep.upsell_note ? "<p style='color:#64748b;margin-top:16px'><em>" + escapeHtml(rep.upsell_note) + "</em></p>" : "") +
    "<p style='color:#94a3b8;font-size:12px;margin-top:24px'><a href='" + UNSUB_URL + "' style='color:#94a3b8'>Unsubscribe</a> · " + PHYSICAL + "</p>" +
    "</body></html>";
}

export async function buildFullReport(env, reportId) {
  if (!env?.LEADS_DB) return { ok: false, error: "service_unavailable" };

  const row = await env.LEADS_DB.prepare(
    "SELECT * FROM audit_full_reports WHERE id = ?"
  ).bind(reportId).first();
  if (!row) return { ok: false, error: "not_found" };
  if (row.status === "ready") return { ok: true, already_ready: true, report_id: reportId };

  // Claim the row: only pending/paid/failed, or a generating row stuck >10 min.
  // This makes webhook re-fires, manual generate, and retry idempotent.
  const claimed = await env.LEADS_DB.prepare(
    "UPDATE audit_full_reports SET status='generating', failure_reason=NULL, status_changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') " +
    "WHERE id=? AND (status IN ('pending','paid','failed') OR (status='generating' AND (status_changed_at IS NULL OR status_changed_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-" + STUCK_MINUTES + " minutes'))))"
  ).bind(reportId).run();
  if (!claimed?.meta?.changes) {
    return { ok: false, error: "already_running" };
  }

  const fail = async (reason) => {
    await setStatus(env, reportId, "failed", reason);
    return { ok: false, error: reason };
  };

  try {
    const safeUrl = normalizeUrl(row.url);
    if (!safeUrl) return await fail("invalid_url");

    // 1. Bounded same-origin crawl: homepage + up to 6 internal pages.
    const crawled = await crawlSite(safeUrl);
    const okPages = crawled.filter((p) => p.ok && p.html);
    if (!okPages.length) return await fail("fetch_failed");

    // 2. Deterministic grades from measured signals.
    const pageReports = okPages.map((p) => {
      const sig = extractSignals(p.html, { requestedUrl: p.url, finalUrl: p.finalUrl || p.url, status: p.status, loadMs: p.loadMs });
      const g = gradePage(sig);
      const issues = g.checks.filter((c) => c !== "no_schema" && c !== "no_meta_desc").map((c) => ISSUE_TEXT[c] || c);
      if (sig.wordCount < 150) issues.push(ISSUE_TEXT.thin_content + " (" + sig.wordCount + " words)");
      const topFix = FIX_PRIORITY.map((k) => g.checks.includes(k) ? ISSUE_FIX[k] : null).find(Boolean) || "Keep what's working — re-crawl after changes to measure improvement.";
      const label = pageLabel(p.finalUrl || p.url, p.isHome);
      return {
        page: label, label, url: p.finalUrl || p.url, grade: g.grade, score: g.score,
        title: sig.title, h1: sig.h1, wordCount: sig.wordCount,
        contactPath: g.contactPath, loadMs: p.loadMs,
        issues: issues.slice(0, 4), fix: topFix,
      };
    });

    // Overall score: homepage counts 50%, other pages split the rest.
    const home = pageReports.find((p) => p.label === "Homepage") || pageReports[0];
    const rest = pageReports.filter((p) => p !== home);
    const restAvg = rest.length ? rest.reduce((a, p) => a + p.score, 0) / rest.length : home.score;
    const score = Math.round(home.score * 0.5 + restAvg * 0.5);

    // 3. Teaser context if we have the lead.
    let teaser = null;
    if (row.lead_id) {
      const lead = await env.LEADS_DB.prepare("SELECT teaser_json FROM audit_leads WHERE id = ?").bind(row.lead_id).first();
      try { teaser = lead && lead.teaser_json ? JSON.parse(lead.teaser_json) : null; } catch { teaser = null; }
    }

    const context = buildFullReportContext({ pages: pageReports, score, teaser, url: row.url });

    // 4. Focused LLM calls: leaks first, then trust/SEO + blueprint in parallel.
    const a = await llmSection(env, FULL_REPORT_LEAKS_SYSTEM, context, 3000, 2);
    if (!a.ok || !Array.isArray(a.data.leak_map) || !a.data.leak_map.length || !a.data.conversion_teardown) {
      return await fail("generation_failed_leaks:" + String(a.error || "bad_schema").slice(0, 60));
    }
    const [b, c] = await Promise.all([
      llmSection(env, FULL_REPORT_TRUST_SEO_SYSTEM, context, 2500, 2),
      llmSection(env, FULL_REPORT_BLUEPRINT_SYSTEM,
        context + "\n\nLeak summary for blueprint context: " + a.data.leak_map.slice(0, 6).map((l) => l.area + " (" + l.severity + ")").join("; "), 3500, 2),
    ]);
    if (!b.ok || !b.data.trust_credibility || !b.data.seo_visibility || !b.data.how_you_compare) {
      return await fail("generation_failed_trust_seo:" + String(b.error || "bad_schema").slice(0, 60));
    }
    if (!c.ok || !Array.isArray(c.data.ai_blueprint) || !c.data.five_hundred_percent_math || !Array.isArray(c.data.five_hundred_percent_math.honest_caveats) || !c.data.five_hundred_percent_math.honest_caveats.length) {
      return await fail("generation_failed_blueprint:" + String(c.error || "bad_schema").slice(0, 60));
    }

    const crawledAt = nowIso().slice(0, 10);
    const onlyHome = pageReports.length === 1;
    const report = {
      score,
      business_type_label: a.data.business_type_label || "",
      executive_summary: c.data.executive_summary || "",
      leak_map: a.data.leak_map,
      conversion_teardown: a.data.conversion_teardown,
      page_by_page: pageReports,
      trust_credibility: b.data.trust_credibility,
      seo_visibility: b.data.seo_visibility,
      how_you_compare: b.data.how_you_compare,
      ai_blueprint: c.data.ai_blueprint,
      five_hundred_percent_math: c.data.five_hundred_percent_math,
      ninety_day_plan: c.data.ninety_day_plan || [],
      one_thing: c.data.one_thing || "",
      upsell_note: c.data.upsell_note || "",
      crawl: {
        pages_crawled: pageReports.length,
        crawled_at: crawledAt,
        note: onlyHome
          ? "Only the homepage could be fetched — other pages were not reachable, so all grades below cover the homepage only."
          : "Grades cover the pages listed below only. Pages we could not fetch are not graded.",
      },
    };

    const htmlDoc = renderReportHtml(report, { email: row.email, url: row.url });
    await env.LEADS_DB.prepare(
      "UPDATE audit_full_reports SET status='ready', failure_reason=NULL, report_json=?, report_html=?, delivered_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), status_changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?"
    ).bind(JSON.stringify(report).slice(0, 150000), htmlDoc.slice(0, 300000), reportId).run();

    // 5. Email the customer; record the outcome on the row.
    let emailed = false;
    try {
      const r = await sendCfEmail(env, {
        from: "MehyarSoft Audit <" + FROM_EMAIL + ">",
        to: row.email,
        subject: "Your full website evaluation is ready (score: " + score + "/100)",
        text: "Your full AI website evaluation is ready.\n\nScore: " + score + "/100\n\n" +
          (report.executive_summary || "") + "\n\nView it here: https://mehyar.us/audit/report?token=" + row.access_token + "\n\n" +
          "Unsubscribe: " + UNSUB_URL + "\n" + PHYSICAL,
        html: htmlDoc,
      });
      emailed = !!(r && r.ok);
    } catch (e) {
      console.error("full-report email failed", e && e.message);
    }
    await env.LEADS_DB.prepare(
      "UPDATE audit_full_reports SET email_sent=?, emailed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?"
    ).bind(emailed ? 1 : 0, reportId).run();

    return { ok: true, report_id: reportId, status: "ready", pages_crawled: pageReports.length, emailed };
  } catch (e) {
    console.error("full-report build error", e && e.message);
    return await fail("generation_failed");
  }
}

