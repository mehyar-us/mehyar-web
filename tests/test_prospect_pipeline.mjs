// tests/test_prospect_pipeline.mjs
// Local smoke test: exercise scanner against real public sites + draft templates.
// Uses Node 18+ global fetch.
// Outputs a JSON report so you can see exactly what the pipeline produces.

import { readFile, writeFile } from "node:fs/promises";

// Replicate the scanner logic in a Node-callable form.
async function fetchHtmlWithTimeout(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
  const startedAt = Date.now();
  try {
    const resp = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "MehyarSoft-ProspectScanner/1.0 (+https://mehyar.us) NodeTest",
        "accept": "text/html,application/xhtml+xml",
        "accept-encoding": "identity",
      },
    });
    const ct = resp.headers.get("content-type") || "";
    let html = "";
    if (ct.includes("text/html") || ct.includes("xml")) {
      const buf = await resp.arrayBuffer();
      const slice = buf.byteLength > 1_500_000 ? buf.slice(0, 1_500_000) : buf;
      html = new TextDecoder("utf-8", { fatal: false }).decode(slice);
    } else {
      html = `<meta content-type="${ct.replace(/[^a-z0-9/-]/g, "")}">`;
    }
    return { ok: true, status: resp.status, finalUrl: resp.url || url, headers: Object.fromEntries(resp.headers.entries()), html, elapsed: Date.now() - startedAt };
  } catch (err) {
    return { ok: false, error: String(err?.message || err?.name || err), elapsed: Date.now() - startedAt };
  } finally {
    clearTimeout(timer);
  }
}

const BOOKING = /\b(book(ing)?|schedule|appointment|request\s+appointment|reserve|get\s+started|buy\s+now|order\s+now|consultation|contact\s+us)\b/i;
const PLATFORMS = [
  { name: "wordpress", re: /wp-content|wp-includes|wordpress/i },
  { name: "wix",       re: /wix\.com|wixstatic|wixsite/i },
  { name: "squarespace",re: /squarespace\.com|squarespacecdn|staticfld/i },
  { name: "webflow",   re: /webflow\.(com|io)|assets-global\.website-files\.com/i },
  { name: "shopify",   re: /myshopify\.com|shopify/i },
  { name: "hubspot",   re: /hubspot|hsforms\.com|hbspt/i },
];

function textOnly(html) {
  const noScripts = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
  return noScripts.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
function platformOf(html, headers) {
  const hay = (html || "").slice(0, 50000) + " " + JSON.stringify(headers || {});
  for (const p of PLATFORMS) if (p.re.test(hay)) return p.name;
  return "unknown";
}
function analyze(url, fetchOut) {
  if (!fetchOut.ok) {
    return { status_code: 0, leak_signals: ["fetch_failed"], leak_score: 0, https_ok: /^https/i.test(url) ? 1 : 0, load_time_ms: fetchOut.elapsed, page_weight_kb: 0,
      has_viewport: 0, has_booking_cta: 0, has_phone_click_to_call: 0, has_form_action: 0, has_email_link: 0, has_address: 0,
      detected_platform: "unknown", title: "" };
  }
  const html = fetchOut.html;
  const text = textOnly(html);
  const plat = platformOf(html, fetchOut.headers);
  const viewport = /name=["']viewport["']/i.test(html) ? 1 : 0;
  const formAct = /<form\b[^>]*action=/i.test(html) ? 1 : 0;
  const tel = /href=["']tel:/i.test(html) ? 1 : 0;
  const mailto = /href=["']mailto:/i.test(html) ? 1 : 0;
  const addr = /\b\d{1,6}\s+[A-Z][\w'.-]*\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Place|Pl|Drive|Dr|Lane|Ln)\b/i.test(text) ? 1 : 0;
  const booking = BOOKING.test(text) ? 1 : 0;
  const finalHttps = /^https/i.test(fetchOut.finalUrl) ? 1 : 0;

  const leak_signals = [];
  if (!finalHttps) leak_signals.push("no_https");
  if (fetchOut.elapsed > 3000) leak_signals.push("slow_load");
  if (Math.round((html.length || 0)/1024) > 2500) leak_signals.push("heavy_page");
  if (!viewport) leak_signals.push("no_viewport");
  if (!booking) leak_signals.push("no_booking_cta");
  if (!tel) leak_signals.push("no_phone_link");
  if (!formAct) leak_signals.push("no_form_action");
  if (!mailto) leak_signals.push("no_email_link");
  if (!addr) leak_signals.push("no_address");
  if (["wix","squarespace"].includes(plat)) leak_signals.push("platform_generic");

  return {
    status_code: fetchOut.status,
    leak_signals,
    leak_score: Math.min(100, leak_signals.length * 14),
    https_ok: finalHttps,
    load_time_ms: fetchOut.elapsed,
    page_weight_kb: Math.round((html.length || 0)/1024),
    has_viewport: viewport,
    has_booking_cta: booking,
    has_phone_click_to_call: tel,
    has_form_action: formAct,
    has_email_link: mailto,
    has_address: addr,
    detected_platform: plat,
    title: (html.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1] || "").trim(),
  };
}

const SIGNAL_VERBIAGE = {
  no_https:        "your site isn't using HTTPS",
  slow_load:       "your homepage takes more than 3 seconds to load",
  heavy_page:      "your homepage is over 2.5 MB",
  no_viewport:     "your site doesn't have a mobile viewport meta tag",
  no_booking_cta:  "your homepage doesn't ask visitors to book, schedule, or take a next step",
  no_phone_link:   "your phone number isn't clickable to call on a phone",
  no_form_action:  "your site doesn't have a working form for inquiries",
  no_email_link:   "your site doesn't expose an email contact",
  no_address:      "your site doesn't show a physical address (a Google ranking + trust killer)",
  platform_generic: "your site looks like an unmoved Wix or Squarespace default",
  fetch_failed:    "your homepage failed to load when I checked",
};
const SUBJECTS = [
  (s) => `small thing I noticed on ${s}'s site`,
  (s) => `30-second review of ${s}'s homepage`,
  (s) => `one leak at ${s}`,
  (s) => `a quick finding on ${s}`,
  (s) => `${s} — what I'd fix this week`,
];

function draftFallback({ businessName, rootDomain, leak_signals }) {
  const cited = leak_signals.filter(s => s in SIGNAL_VERBIAGE).map(s => SIGNAL_VERBIAGE[s]);
  const top3 = cited.slice(0, 3);
  const leakLine = top3.length
    ? top3.join("; ").replace(/; ([^;]*)$/, ", and $1")
    : "some small friction points in the booking path";
  const subjectIdx = Math.floor(Math.random() * SUBJECTS.length);
  const subject = SUBJECTS[subjectIdx](businessName).slice(0, 140);
  const body = [
    `Hi ${businessName} team,`,
    "",
    `I run MehyarSoft LLC — founder-led consulting that helps local and service businesses stop losing customers to weak websites and slow follow-up. I'm a Senior software engineer in NYC.`,
    "",
    `I checked ${rootDomain} briefly and noticed ${leakLine}.`,
    `If those sound like the kind of small leaks that quietly cost calls, leads, or bookings, that's the exact kind of audit I do for $150 — a written leak map with the smallest useful next step, no agency theater.`,
    "",
    `Want me to send the report? Happy to share the PDF and a few screenshots.`,
    "",
    `— Mehyar Swelim`,
    `MehyarSoft LLC`,
    `https://mehyar.us · info@mehyar.us`,
    `Unsubscribe: https://mehyar.us/unsubscribe`,
  ].join("\n");
  return { subject, body, cited_signals: leak_signals.slice(0, 5) };
}

const SEED = [
  // Proven-reachable public sites owned by real service businesses. Picked so the scanner can
  // either pull live HTML or get a meaningful TLS/network failure to exercise error handling.
  // The ASTORIA / BROOKLYN / MANHATTAN groups are deliberately local-services verticals.
  { business_name: "NYC Dental Care",            website: "https://www.nycdentalcarecenter.com",     vertical: "dental", city: "Manhattan" },
  { business_name: "Concept Stone NYC",          website: "https://www.conceptstone.nyc",              vertical: "hvac",   city: "Brooklyn" },
  { business_name: "Big Apple Renovations",      website: "https://www.bigapplerenovations.com",      vertical: "construction", city: "Queens" },
  { business_name: "Greenwich Village Therapy",  website: "https://www.wallstreettherapy.com",          vertical: "therapy", city: "Manhattan" },
  { business_name: "Brooklyn Family Dentist",    website: "http://www.brooklynfamilydentist.com",     vertical: "dental", city: "Brooklyn" },
];

const output = { seed_count: SEED.length, run_at: new Date().toISOString(), prospects: [] };

for (const s of SEED) {
  console.log(`\n→ ${s.business_name} (${s.website})`);
  const fetchOut = await Promise.race([
    fetchHtmlWithTimeout(s.website, 7000),
    new Promise(res => setTimeout(() => res({ ok: false, error: "race_timeout_10s", elapsed: 10000 }), 10000)),
  ]);
  const a = analyze(s.website, fetchOut);
  const domain = (() => {
    try { return new URL(s.website).hostname.replace(/^www\./, ""); } catch { return s.website; }
  })();

  if (!fetchOut.ok) console.log(`  ✖ fetch_failed (${fetchOut.error})`);
  else console.log(`  ✓ HTTP ${a.status_code} · ${a.detected_platform} · ${a.page_weight_kb}kB · ${a.load_time_ms}ms · leak_score ${a.leak_score}`);

  const draft = draftFallback({ businessName: s.business_name, rootDomain: domain, leak_signals: a.leak_signals });
  console.log(`  Subject: ${draft.subject}`);
  console.log(`  Cited : ${a.leak_signals.join(", ") || "(none — site looks clean)"}`);

  output.prospects.push({
    business_name: s.business_name,
    website: s.website,
    root_domain: domain,
    signals: a,
    draft,
  });
}

console.log("\n─────── JSON REPORT ───────");
console.log(JSON.stringify(output, null, 2));
await writeFile('tests/last_prospect_run.json', JSON.stringify(output, null, 2));
console.log("\n📁 wrote tests/last_prospect_run.json");
