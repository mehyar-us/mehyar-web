// functions/api/_shared/assessmentDiagnose.js
//
// Live diagnosis for the assessment call: fetch the caller's URL server-side
// (browser User-Agent — non-browser clients get Cloudflare 1010 bot-blocks,
// per ~/AGENTS.md) and extract HONEST, measured signals. Every finding the
// avatar names must trace back to one of these measurements. Never invent.
//
// SSRF protection mirrors functions/api/audit/business/intake.js (the audit-tab
// crew's pattern): private/internal targets are rejected before any request.
// This module is self-contained so the brain/closer crew never touches the
// audit-tab crew's working tree.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 15000;
const BYTE_CAP = 500_000;

export function sanitize(v, max = 200) {
  return String(v || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

// normalizeUrl — SSRF guard. Blocks private/internal targets before fetch.
export function normalizeUrl(raw) {
  let u = sanitize(raw, 300);
  if (!u) return null;
  if (/:\/\//.test(u) && !/^https?:\/\//i.test(u)) return null; // wrong scheme entirely
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  let parsed;
  try { parsed = new URL(u); } catch { return null; }
  if (!/^https?:$/.test(parsed.protocol)) return null;
  const host = parsed.hostname.toLowerCase();
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?)/.test(host)) return null;
  if (host.endsWith(".local") || host === "localhost") return null;
  return parsed.toString();
}

export async function sha256hex(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function stripTags(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

// spokenUrlToUrl — voice URL capture (R3). Callers say domains, not URLs:
// "acmeplumbing dot com", "www dot acme dot com", or spell "a c m e ...".
// Returns a normalized URL or null. Never guesses beyond the utterance.
export function spokenUrlToUrl(raw, { spellout = false } = {}) {
  let t = String(raw || "").toLowerCase().trim();
  if (!t) return null;
  // 1) If it already looks like a URL/domain, take it as-is.
  const direct = t.match(/(https?:\/\/[^\s]+|(?:www\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+(?:\/[^\s]*)?)/);
  if (direct) return normalizeUrl(direct[1]);
  // 2) Spoken form: "acme plumbing dot com" / letter-spelled "a c m e dot com".
  // Strategy: drop leading filler words, join the rest, validate as a domain.
  // Ambiguous captures self-correct downstream: a bad URL fails the live fetch
  // and the avatar falls back to spell-it-out, then interview mode.
  const STOPWORDS = new Set(["my", "site", "is", "it's", "its", "the", "a", "an",
    "go", "to", "at", "on", "www", "website", "web", "address", "called", "named",
    "find", "us", "me", "our", "check", "out"]);
  let s = ` ${t} `;
  s = s.replace(/\bdot\b/g, ".").replace(/\bslash\b/g, "/").replace(/\bdash\b/g, "-");
  s = s.replace(/\s*\.\s*/g, ".").replace(/\s*\/\s*/g, "/"); // "dot com" -> ".com"
  let tokens = s.replace(/[^a-z0-9./\s-]/g, "").split(/\s+/).filter(Boolean);
  // In spellout mode every token is a letter — never drop stopwords.
  if (!spellout) while (tokens.length && STOPWORDS.has(tokens[0])) tokens.shift();
  if (!tokens.length) return null;
  const joined = tokens.join("");
  if (/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}(\/\S*)?$/.test(joined)) {
    return normalizeUrl(joined);
  }
  // Last resort: the last domain-like token on its own.
  const domTokens = tokens.filter((tok) => /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}(\/\S*)?$/.test(tok));
  if (domTokens.length) return normalizeUrl(domTokens[domTokens.length - 1]);
  return null;
}

// ── Signal extraction: measured facts only ──────────────────────────────────
export function extractSignals(html, meta, byteLength) {
  const get = (re) => { const m = html.match(re); return m ? m[1].trim() : ""; };
  const text = stripTags(html);
  const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
  const lower = html.toLowerCase();
  return {
    requestedUrl: meta.requestedUrl,
    finalUrl: meta.finalUrl,
    httpStatus: meta.status,
    https: meta.finalUrl.startsWith("https://"),
    loadMs: meta.loadMs,
    pageWeightKb: Math.round((byteLength || 0) / 102.4) / 10,
    title: get(/<title[^>]*>([^<]*)<\/title>/i),
    metaDescription: get(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i),
    h1: get(/<h1[^>]*>([\s\S]*?)<\/h1>/i).replace(/<[^>]+>/g, "").trim(),
    h1Count: (html.match(/<h1[\s>]/gi) || []).length,
    wordCount: words,
    hasViewport: /<meta[^>]+name=["']viewport["']/i.test(html),
    hasPhone: /(?:tel:|\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/.test(html),
    hasContactPath: /href=["'][^"']*(contact|book|appointment|quote|schedule)[^"']*["']/i.test(html),
    formCount: (html.match(/<form[\s>]/gi) || []).length,
    ctaCount: (lower.match(/(call now|book now|get a quote|schedule|free estimate|contact us|order now|sign up|get started)/g) || []).length,
    socials: ["facebook.com", "instagram.com", "linkedin.com", "tiktok.com", "x.com", "youtube.com"]
      .filter((d) => lower.includes(d)),
    hasSchema: /<script[^>]+type=["']application\/ld\+json["']/i.test(html),
    hasGA: /googletagmanager\.com|google-analytics\.com\/g\/|gtag\(/i.test(html),
    hasMetaPixel: /connect\.facebook\.net\/[^"']*fbevents/i.test(html),
  };
}

// ── Deterministic findings ──────────────────────────────────────────────────
// Each finding: { id, severity, title, observation (speakable), evidence }.
// Severity ladder is deterministic; decide() refines it per finding
// (see assessmentBrain.js scoreFindings). Low-confidence decide() results
// fall back to these deterministic severities — never stated as AI fact.

const FINDINGS = [
  {
    id: "no_https",
    severity: "high",
    test: (s) => !s.https,
    title: "Site not on HTTPS",
    observation: (s) => `Your site loads over plain HTTP, not HTTPS. Browsers literally warn visitors your site is "not secure" — that kills trust before anyone reads a word.`,
    evidence: (s) => `final URL ${s.finalUrl} uses http`,
  },
  {
    id: "no_title",
    severity: "high",
    test: (s) => !s.title,
    title: "No page title",
    observation: () => `Your homepage has no title tag at all. That's the line Google shows in search results — without it, you're basically invisible in search.`,
    evidence: () => `empty <title>`,
  },
  {
    id: "title_too_long",
    severity: "low",
    test: (s) => s.title && s.title.length > 60,
    title: "Title too long for search",
    observation: (s) => `Your page title is ${s.title.length} characters — Google cuts it off around 60, so searchers see a chopped-off headline.`,
    evidence: (s) => `title length ${s.title.length}`,
  },
  {
    id: "no_meta_description",
    severity: "medium",
    test: (s) => !s.metaDescription,
    title: "No meta description",
    observation: () => `There's no meta description — that's the little pitch paragraph under your link in Google. Without it, Google writes one for you, and it never sells.`,
    evidence: () => `meta[name=description] absent`,
  },
  {
    id: "no_h1",
    severity: "medium",
    test: (s) => s.h1Count === 0,
    title: "No headline (H1)",
    observation: () => `There's no main headline on the page. A visitor lands and nothing tells them in one line what you do — they bounce in seconds.`,
    evidence: () => `0 <h1> tags`,
  },
  {
    id: "thin_content",
    severity: "medium",
    test: (s) => s.wordCount > 0 && s.wordCount < 200,
    title: "Very thin page content",
    observation: (s) => `The whole homepage is about ${s.wordCount} words. Google has almost nothing to rank, and a visitor has almost nothing to believe in.`,
    evidence: (s) => `${s.wordCount} words`,
  },
  {
    id: "no_viewport",
    severity: "medium",
    test: (s) => !s.hasViewport,
    title: "Not mobile-ready",
    observation: () => `There's no mobile viewport tag — on a phone, your site likely renders tiny or broken. Most of your customers are on their phones.`,
    evidence: () => `meta[name=viewport] absent`,
  },
  {
    id: "no_contact",
    severity: "high",
    test: (s) => !s.hasPhone && !s.hasContactPath && s.formCount === 0,
    title: "No way to reach you",
    observation: () => `I can't find a phone number, a contact page, or a single form on your homepage. If someone wants to hire you right now, they literally can't.`,
    evidence: () => `no phone, no contact path, 0 forms`,
  },
  {
    id: "no_form",
    severity: "medium",
    test: (s) => s.formCount === 0 && (s.hasPhone || s.hasContactPath),
    title: "No lead-capture form",
    observation: () => `There's no form on the homepage — no quote request, no "book now". Every visitor who isn't ready to call is a lead you never see again.`,
    evidence: () => `0 <form> tags`,
  },
  {
    id: "no_cta",
    severity: "medium",
    test: (s) => s.ctaCount === 0,
    title: "No clear call to action",
    observation: () => `I don't see a single clear call to action — no "call now", no "get a quote". The page just... sits there. Visitors need to be told what to do.`,
    evidence: () => `0 CTA phrases detected`,
  },
  {
    id: "slow",
    severity: "medium",
    test: (s) => s.loadMs > 5000,
    title: "Slow to load",
    observation: (s) => `It took about ${Math.round(s.loadMs / 1000)} seconds just to reach your homepage from our server. Every extra second costs you visitors — most won't wait.`,
    evidence: (s) => `server fetch ${s.loadMs}ms`,
  },
  {
    id: "no_socials",
    severity: "low",
    test: (s) => s.socials.length === 0,
    title: "No social proof links",
    observation: () => `No links to any social profiles from the homepage. People check Instagram and Facebook before they trust a business — you're giving them nowhere to go.`,
    evidence: () => `no social domains linked`,
  },
  {
    id: "no_schema",
    severity: "low",
    test: (s) => !s.hasSchema,
    title: "No structured data",
    observation: () => `There's no structured data on the page — that's the code that gets you the star ratings and business info in Google results. Free visibility you're leaving on the table.`,
    evidence: () => `no ld+json block`,
  },
  {
    id: "no_analytics",
    severity: "low",
    test: (s) => !s.hasGA && !s.hasMetaPixel,
    title: "No analytics or ad pixel",
    observation: () => `I don't see any analytics or ad pixel on the site. That means you can't measure what works — and you can't retarget the people who visited but didn't buy.`,
    evidence: () => `no GA, no Meta pixel detected`,
  },
];

export function buildFindings(signals) {
  return FINDINGS.filter((f) => { try { return f.test(signals); } catch { return false; } })
    .map((f) => ({
      id: f.id,
      severity: f.severity,
      title: f.title,
      observation: f.observation(signals),
      evidence: f.evidence(signals),
    }));
}

// ── Fetch with honest metadata ──────────────────────────────────────────────
export async function diagnoseUrl(rawUrl, { fetchFn = fetch } = {}) {
  const url = normalizeUrl(rawUrl);
  if (!url) return { ok: false, error: "invalid_url" };
  const t0 = Date.now();
  let html = "", status = 0, finalUrl = url, byteLength = 0;
  try {
    const resp = await fetchFn(url, {
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
    return { ok: false, error: "fetch_failed" };
  }
  if (!html || status >= 400) return { ok: false, error: "fetch_failed", status };
  const signals = extractSignals(html, { requestedUrl: url, finalUrl, status, loadMs: Date.now() - t0 }, byteLength);
  return { ok: true, signals, findings: buildFindings(signals) };
}

// One-paragraph diagnosis summary for the system prompt — facts only.
export function diagnosisSummary(signals) {
  if (!signals) return "not run yet";
  const socials = signals.socials || [];
  const bits = [
    `URL ${signals.finalUrl}`,
    signals.https ? "HTTPS on" : "NO HTTPS",
    `server reached it in ${signals.loadMs}ms`,
    `title: ${signals.title ? `"${signals.title.slice(0, 60)}"` : "MISSING"}`,
    signals.metaDescription ? "meta description present" : "no meta description",
    `${signals.h1Count} H1${signals.h1Count === 1 ? "" : "s"}`,
    `${signals.wordCount} words`,
    signals.hasViewport ? "mobile viewport present" : "NO mobile viewport",
    signals.hasPhone ? "phone found" : "no phone found",
    signals.hasContactPath ? "contact path found" : "no contact path",
    `${signals.formCount} form(s)`,
    `${signals.ctaCount} CTA phrase(s)`,
    socials.length ? `socials: ${socials.join(",")}` : "no social links",
    signals.hasSchema ? "schema present" : "no schema",
    (signals.hasGA || signals.hasMetaPixel) ? "analytics/pixel present" : "no analytics/pixel",
  ];
  return bits.join(" | ");
}
