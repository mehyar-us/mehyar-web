// functions/api/audit/business/peek.js
// POST /api/audit/business/peek — URL-first intake, step zero.
// Body: { url }
//
// Fetches the site server-side (same SSRF guards + browser UA as intake),
// extracts the business's identity from its own markup (name, logo, share
// image, brand color, published contact details) plus a compact found-
// signals summary, and returns it for the "is this you?" confirmation card.
// NOTHING is stored and no email is required — the intake row is created
// only when the buyer confirms and submits through /business/intake.

import {
  sanitize, sha256hex, normalizeUrl, extractBusinessSignals, extractIdentity,
} from "../../_shared/auditBusinessShared.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 15000;
const BYTE_CAP = 500_000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json().catch(() => ({}));
    const url = normalizeUrl(body.url);
    if (!url) return json({ ok: false, error: "invalid_url" }, 400);

    const clientIp = request.headers.get("cf-connecting-ip")
      || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

    // Rate limit: 20 peeks/day per IP (KV best-effort) — this is the free
    // front door; the intake endpoint keeps its own stricter limit.
    if (env?.INTAKE_KV) {
      const ipHash = await sha256hex("audit-business-peek|" + clientIp);
      const k = `audit:business:peek:${ipHash}`;
      const n = Number((await env.INTAKE_KV.get(k)) || "0");
      if (n >= 20) return json({ ok: false, error: "rate_limited", message: "Too many lookups — try again tomorrow." }, 429);
      await env.INTAKE_KV.put(k, String(n + 1), { expirationTtl: 86400 });
    }

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
      return json({ ok: false, error: "fetch_failed", message: "We couldn't load that site. Check the URL and try again." }, 422);
    }
    if (!html || status >= 400) {
      return json({ ok: false, error: "fetch_failed", message: "We couldn't load that site. Check the URL and try again." }, 422);
    }

    const signals = extractBusinessSignals(html, { requestedUrl: url, finalUrl, status, loadMs: Date.now() - t0 }, byteLength);
    const identity = extractIdentity(html, finalUrl);

    return json({
      ok: true,
      identity: {
        name: identity.name || "",
        name_source: identity.nameSource,
        title: signals.title || "",
        tagline: signals.h1 || signals.ogDescription || signals.metaDescription || "",
        favicon: identity.favicon,
        og_image: identity.ogImage,
        theme_color: identity.themeColor,
        emails: identity.emails,
        phones: identity.phones,
        url: signals.finalUrl,
      },
      found: {
        https: signals.https,
        load_ms: signals.loadMs,
        has_phone: signals.hasPhone,
        has_contact_path: signals.hasContactPath,
        has_schema: signals.hasSchema,
        socials: signals.socials,
        content_unmeasured: !!signals.contentUnmeasured,
      },
    });
  } catch {
    return json({ ok: false, error: "server_error" }, 500);
  }
}
