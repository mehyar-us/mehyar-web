// functions/api/audit/business/intake.js
// POST /api/audit/business/intake — free signals preview for "Audit My Business".
// Body: { url, email, business_name? }
//
// Validates + normalizes the URL (SSRF guards reused from the free scan),
// fetches the site server-side with a browser User-Agent, extracts honest
// measured signals, and stores an intake row (status='intake') with the email
// stored as SHA-256 ONLY — the raw email is never persisted here.
// Returns { ok, audit_id, signals } — a free honest preview, no AI claims.

import {
  sanitize, sha256hex, normalizeUrl, extractBusinessSignals,
} from "../../_shared/auditBusinessShared.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
// NOTE: browser User-Agent is REQUIRED — non-browser clients get bot-blocked
// (Cloudflare 1010) on bot-managed hosts. Never route through the managed
// browser; this is a plain server-side fetch.
const FETCH_TIMEOUT_MS = 15000;
const BYTE_CAP = 500_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function fetchSignals(url) {
  const t0 = Date.now();
  let html = "", status = 0, finalUrl = url, byteLength = 0;
  try {
    const resp = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    status = resp.status;
    finalUrl = resp.url || url;
    const ct = resp.headers.get("content-type") || "";
    if (ct.includes("html") || ct.includes("text")) {
      const buf = await resp.arrayBuffer();
      byteLength = buf.byteLength;
      html = new TextDecoder("utf-8", { fatal: false }).decode(buf.slice(0, BYTE_CAP));
    }
  } catch {
    throw new Error("fetch_failed");
  }
  if (!html || status >= 400) throw new Error("fetch_failed");
  return extractBusinessSignals(html, { requestedUrl: url, finalUrl, status, loadMs: Date.now() - t0 }, byteLength);
}

// Public preview: the honest signals a buyer can verify themselves.
// No AI claims, no scores — just measurements.
function publicPreview(signals) {
  return {
    url: signals.finalUrl,
    https: signals.https,
    load_ms: signals.loadMs,
    title: signals.title,
    has_meta_description: !!signals.metaDescription,
    h1: signals.h1,
    word_count: signals.wordCount,
    page_weight_kb: signals.pageWeightKb,
    has_phone: signals.hasPhone,
    has_contact_path: signals.hasContactPath,
    form_count: signals.formCount,
    cta_count: signals.ctaCount,
    has_viewport: signals.hasViewport,
    socials: signals.socials,
    pixels: signals.pixels,
    trust: signals.trust,
    has_schema: signals.hasSchema,
  };
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env?.LEADS_DB) return json({ ok: false, error: "service_unavailable" }, 503);
    const body = await request.json().catch(() => ({}));
    const email = sanitize(body.email, 254).toLowerCase();
    const url = normalizeUrl(body.url);
    const businessName = sanitize(body.business_name || body.businessName, 160) || null;

    if (!EMAIL_RE.test(email)) return json({ ok: false, error: "invalid_email" }, 400);
    if (!url) return json({ ok: false, error: "invalid_url" }, 400);

    const clientIp = request.headers.get("cf-connecting-ip")
      || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

    // Rate limit: 10 intakes/day per IP (KV best-effort).
    if (env?.INTAKE_KV) {
      const ipHash = await sha256hex("audit-business-intake|" + clientIp);
      const k = `audit:business:intake:${ipHash}`;
      const n = Number((await env.INTAKE_KV.get(k)) || "0");
      if (n >= 10) return json({ ok: false, error: "rate_limited", message: "Too many previews — try again tomorrow." }, 429);
      await env.INTAKE_KV.put(k, String(n + 1), { expirationTtl: 86400 });
    }

    let signals;
    try {
      signals = await fetchSignals(url);
    } catch {
      return json({ ok: false, error: "fetch_failed", message: "We couldn't load that site. Check the URL and try again." }, 422);
    }

    const auditId = crypto.randomUUID();
    const emailHash = await sha256hex("audit-business|" + email);
    await env.LEADS_DB.prepare(
      "INSERT INTO audit_business_reports (id, email_hash, url, business_name, status, signals_json) VALUES (?, ?, ?, ?, 'intake', ?)"
    ).bind(auditId, emailHash, url, businessName, JSON.stringify(publicPreview(signals)).slice(0, 20000)).run();

    return json({ ok: true, audit_id: auditId, signals: publicPreview(signals) });
  } catch (e) {
    console.error("audit business intake error", e && e.message);
    return json({ ok: false, error: "intake_failed" }, 500);
  }
}
