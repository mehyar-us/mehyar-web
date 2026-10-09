// Unit tests for assessmentDiagnose.js
// Run: node functions/api/_shared/assessmentDiagnose.test.js
// No network — fetch is stubbed. Exit non-zero on failure.

import {
  normalizeUrl, extractSignals, buildFindings, diagnoseUrl, diagnosisSummary, sanitize,
} from "./assessmentDiagnose.js";

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) passed++;
  else { failed++; console.error(`FAIL ${name}`); }
}
function eq(a, e, name) {
  const x = JSON.stringify(a), y = JSON.stringify(e);
  if (x === y) passed++;
  else { failed++; console.error(`FAIL ${name}\n  expected: ${y}\n  actual:   ${x}`); }
}

// ── SSRF guards ─────────────────────────────────────────────────────────────
ok(normalizeUrl("https://example.com") === "https://example.com/", "public https passes");
ok(normalizeUrl("example.com") === "https://example.com/", "bare domain gets https");
ok(normalizeUrl("http://localhost:3000") === null, "localhost blocked");
ok(normalizeUrl("http://127.0.0.1/x") === null, "127.x blocked");
ok(normalizeUrl("http://10.0.0.5") === null, "10.x blocked");
ok(normalizeUrl("http://192.168.1.1") === null, "192.168.x blocked");
ok(normalizeUrl("http://172.16.4.4") === null, "172.16.x blocked");
ok(normalizeUrl("http://172.31.255.1") === null, "172.31.x blocked");
ok(normalizeUrl("http://intranet.local") === null, ".local blocked");
ok(normalizeUrl("ftp://example.com") === null, "non-http blocked");
ok(normalizeUrl("not a url at all !!!") === null, "garbage rejected");
ok(sanitize("<script>alert(1)</script>", 50).length <= 50, "sanitize caps length");

// ── Signal extraction on a deliberately bad fixture ─────────────────────────
const BAD_HTML = `<!doctype html><html><head><title></title></head><body>
<p>Hi we do stuff. Call us maybe.</p>
<a href="/about">about</a>
</body></html>`;

const bad = extractSignals(BAD_HTML, { requestedUrl: "https://bad.example/", finalUrl: "http://bad.example/", status: 200, loadMs: 6100 }, 1200);
eq(bad.title, "", "empty title extracted");
ok(!bad.metaDescription, "no meta description");
eq(bad.h1Count, 0, "no h1");
ok(bad.wordCount < 200, "thin content measured");
ok(!bad.hasViewport, "no viewport");
ok(!bad.hasPhone, "no phone");
ok(!bad.hasContactPath, "no contact path");
eq(bad.formCount, 0, "no forms");
ok(!bad.https, "http flagged");
eq(bad.loadMs, 6100, "load ms preserved");

const findings = buildFindings(bad);
const ids = findings.map((f) => f.id);
for (const want of ["no_title", "no_meta_description", "no_h1", "thin_content", "no_viewport", "no_contact", "slow"]) {
  ok(ids.includes(want), `finding raised: ${want}`);
}
ok(findings.find((f) => f.id === "no_contact").severity === "high", "no_contact is high severity");
// NOTE: finalUrl is http://bad.example/ → https=false → no_https fires:
ok(ids.includes("no_https"), "no_https raised for http final URL");

// Every finding must carry speakable observation + evidence (no empties).
for (const f of findings) {
  ok(f.observation && f.observation.length > 20, `finding ${f.id} has observation`);
  ok(f.evidence && f.evidence.length > 3, `finding ${f.id} has evidence`);
  ok(!/https?:\/\//.test(f.observation) || f.id === "no_https", `finding ${f.id} observation has no raw URL (except no_https evidence)`);
}

// Good site → few/no findings.
const GOOD_HTML = `<!doctype html><html><head><title>Acme Plumbing — 24/7 Emergency Plumber in Brooklyn</title>
<meta name="description" content="Fast, licensed plumbers. Call now for a free quote.">
<meta name="viewport" content="width=device-width,initial-scale=1">
<script type="application/ld+json">{"@type":"LocalBusiness"}</script></head>
<body><h1>Brooklyn's fastest plumber</h1>
<p>${"Great service. ".repeat(120)}</p>
<a href="tel:+17185550134">(718) 555-0134</a>
<a href="/contact">Contact us</a>
<a href="https://instagram.com/acmeplumbing">IG</a>
<form action="/quote"><input name="phone"></form>
<button>Get a free quote today — call now</button>
<script src="https://www.googletagmanager.com/gtag/js"></script>
</body></html>`;
const good = extractSignals(GOOD_HTML, { requestedUrl: "https://acme.example/", finalUrl: "https://acme.example/", status: 200, loadMs: 800 }, 9000);
const goodFindings = buildFindings(good);
ok(goodFindings.length <= 2, `good site yields ≤2 findings (got ${goodFindings.length}: ${goodFindings.map((f) => f.id)})`);
ok(good.hasPhone && good.hasContactPath && good.formCount === 1, "contact signals detected");
ok(good.hasSchema && good.hasGA, "schema + GA detected");

// ── diagnoseUrl with stubbed fetch ──────────────────────────────────────────
function stubFetch(html, { status = 200, finalUrl = "https://stub.example/", contentType = "text/html", uaCapture } = {}) {
  return async (url, opts) => {
    if (uaCapture) uaCapture.push(opts?.headers?.["user-agent"]);
    return {
      status, url: finalUrl,
      headers: { get: (k) => (k.toLowerCase() === "content-type" ? contentType : null) },
      arrayBuffer: async () => new TextEncoder().encode(html).buffer,
    };
  };
}

{
  const uas = [];
  const r = await diagnoseUrl("stub.example", { fetchFn: stubFetch(BAD_HTML, { uaCapture: uas, finalUrl: "http://stub.example/" }) });
  ok(r.ok, "diagnoseUrl ok on good fetch");
  ok(uas[0] && uas[0].includes("Mozilla/5.0") && uas[0].includes("Chrome"), "browser User-Agent sent (bot-block lesson)");
  ok(r.findings.length > 0, "findings returned");
  ok(r.signals && typeof r.signals.loadMs === "number", "signals include loadMs");
}
{
  const r = await diagnoseUrl("stub.example", { fetchFn: async () => { throw new Error("boom"); } });
  ok(!r.ok && r.error === "fetch_failed", "network throw → fetch_failed (never invent)");
}
{
  const r = await diagnoseUrl("stub.example", { fetchFn: stubFetch("nope", { status: 503 }) });
  ok(!r.ok && r.error === "fetch_failed", "HTTP 503 → fetch_failed");
}
{
  const r = await diagnoseUrl("stub.example", { fetchFn: stubFetch("%PDF-1.4", { contentType: "application/pdf" }) });
  ok(!r.ok && r.error === "fetch_failed", "non-HTML → fetch_failed");
}
{
  const r = await diagnoseUrl("http://127.0.0.1/secret", { fetchFn: stubFetch("x") });
  ok(!r.ok && r.error === "invalid_url", "SSRF target rejected before fetch");
}

// ── diagnosisSummary: facts only ────────────────────────────────────────────
const summary = diagnosisSummary(bad);
ok(summary.includes("NO HTTPS") && summary.includes("no meta description"), "summary names measured facts");
ok(!/revenue|traffic|ranking/i.test(summary), "summary never invents business metrics");
eq(diagnosisSummary(null), "not run yet", "null signals → not run yet");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
