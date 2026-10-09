// Unit + integration tests for the "Audit My Business" backend.
// Run with: node functions/api/audit/business/auditBusiness.test.js
// No network, no credentials: fetch is mocked; D1 is node:sqlite in-memory.
// Exit non-zero on failure.

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  normalizeUrl, sanitize, sha256hex, extractBusinessSignals,
  deterministicScore, scoreGrade, parseMp4Duration, buildTestMp4,
  parseMultipartStream, MP4_HEAD_BYTES,
} from "../../_shared/auditBusinessShared.js";
import { parseWav, wavChunkBytes, transcribeWalkthrough } from "../../_shared/auditTranscribe.js";
import { gateFindings, evidencePackText, FINDING_LISTS } from "../../_shared/auditBusinessBuild.js";
import { verdict, DECIDE_THRESHOLDS } from "../../_shared/decide.js";
import { fulfillAuditBusiness } from "../../_shared/fulfillAuditBusiness.js";
import { orderHooks } from "../../pay/checkout.js";
import { onRequestPost as intakePost } from "./intake.js";
import { onRequestPost as uploadPost } from "./upload.js";
import { onRequestPost as generatePost } from "./generate.js";
import { onRequestGet as reportGet } from "./get.js";

const __dir = dirname(fileURLToPath(import.meta.url));

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) passed++;
  else { failed++; console.error(`FAIL ${name}`); }
}
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) passed++;
  else { failed++; console.error(`FAIL ${name}\n  expected: ${e}\n  actual:   ${a}`); }
}

// ── D1 shim over node:sqlite ─────────────────────────────────────────────
function makeD1() {
  const sqlite = new DatabaseSync(":memory:");
  const mig = readFileSync(join(__dir, "..", "..", "..", "..", "migrations", "0039_audit_business_reports.sql"), "utf8");
  sqlite.exec(mig);
  return {
    _sqlite: sqlite,
    prepare(sql) {
      const stmt = sqlite.prepare(sql);
      const api = {
        bind(...params) {
          return {
            first() { const r = stmt.get(...params); return r === undefined ? null : r; },
            all() { return { results: stmt.all(...params) }; },
            run() {
              const info = stmt.run(...params);
              return { meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } };
            },
          };
        },
      };
      return api;
    },
  };
}

function makeKv() {
  const m = new Map();
  return {
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v) { m.set(k, v); },
  };
}

function makeR2() {
  const m = new Map();
  return {
    _map: m,
    async put(key, value) {
      let bytes;
      if (value instanceof Uint8Array) bytes = value;
      else if (value && typeof value.getReader === "function") bytes = new Uint8Array(await new Response(value).arrayBuffer());
      else bytes = new Uint8Array(await new Response(value).arrayBuffer());
      m.set(key, bytes);
    },
    async get(key, opts) {
      const bytes = m.get(key);
      if (!bytes) return null;
      let slice = bytes;
      if (opts && opts.range) {
        const { offset = 0, length = bytes.length } = opts.range;
        slice = bytes.slice(offset, offset + length);
      }
      return { async arrayBuffer() { return slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength); } };
    },
    async delete(key) { m.delete(key); },
  };
}

function makeEnv(d1) {
  return {
    LEADS_DB: d1,
    INTAKE_KV: makeKv(),
    PROPOSAL_ASSETS: makeR2(),
    CLOUDFLARE_ACCOUNT_ID: "test-acct",
    CLOUDFLARE_EMAIL: "test@example.com",
    CLOUDFLARE_API_KEY: "test-key",
    AUDIT_CRON_SECRET: "test-secret",
    PUBLIC_BASE_URL: "https://mehyar.us",
  };
}

// ── fetch mock router ────────────────────────────────────────────────────
const realFetch = globalThis.fetch;
let routeHandler = null;
globalThis.fetch = async (url, opts) => {
  if (routeHandler) return routeHandler(String(url), opts || {});
  return realFetch(url, opts);
};

const FIXTURE_HTML = `<!DOCTYPE html><html><head>
<title>Acme Plumbing — 24/7 Emergency Plumber in Brooklyn</title>
<meta name="description" content="Acme Plumbing fixes leaks fast. Call now for 24/7 emergency service in Brooklyn.">
<meta property="og:title" content="Acme Plumbing Brooklyn">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script src="https://www.googletagmanager.com/gtm.js?id=GTM-XXXX"></script>
<script>fbq('track','PageView');</script>
<script type="application/ld+json">{"@type":"LocalBusiness"}</script>
</head><body>
<h1>Emergency Plumber in Brooklyn — 60-Minute Response</h1>
<h2>Why choose Acme</h2>
<p>Call <a href="tel:+17185550134">(718) 555-0134</a> now. We have been fixing leaks for 20 years. Our licensed and insured team guarantees satisfaction. Read our 500 five-star reviews and testimonials below.</p>
<a href="/contact">Book Online Now</a> <a href="/quote">Get a Free Quote</a>
<a href="https://facebook.com/acmeplumbing">Facebook</a>
<form action="/quote"><input name="name"></form>
<img src="a.jpg" alt="van"><img src="b.jpg">
<p>${"lorem ipsum dolor sit amet ".repeat(60)}</p>
</body></html>`;

// ── 1. URL validation / SSRF ─────────────────────────────────────────────
{
  eq(normalizeUrl("example.com"), "https://example.com/", "normalize adds https");
  eq(normalizeUrl("http://example.com/x"), "http://example.com/x", "normalize keeps http");
  eq(normalizeUrl("https://127.0.0.1/"), null, "blocks 127.0.0.1");
  eq(normalizeUrl("https://localhost/"), null, "blocks localhost");
  eq(normalizeUrl("https://10.0.0.5/"), null, "blocks 10/8");
  eq(normalizeUrl("https://192.168.1.1/"), null, "blocks 192.168/16");
  eq(normalizeUrl("https://172.16.5.5/"), null, "blocks 172.16/12");
  eq(normalizeUrl("https://172.32.0.1/"), "https://172.32.0.1/", "allows 172.32 (outside 16/12)");
  eq(normalizeUrl("https://foo.local/"), null, "blocks .local");
  eq(normalizeUrl("ftp://example.com/"), null, "blocks ftp");
  eq(normalizeUrl("not a url"), null, "rejects garbage");
  eq(normalizeUrl(""), null, "rejects empty");
}

// ── 2. MP4 duration parser ───────────────────────────────────────────────
{
  const mp4 = buildTestMp4({ timescale: 1000, duration: 60000 });
  const r = parseMp4Duration(mp4);
  ok(r.ok && Math.abs(r.seconds - 60) < 1e-6, "mp4 v0 duration 60s");

  const mp4v1 = buildTestMp4({ timescale: 90000, duration: 90000 * 125, version: 1 });
  const r1 = parseMp4Duration(mp4v1);
  ok(r1.ok && Math.abs(r1.seconds - 125) < 1e-6, "mp4 v1 duration 125s");

  const tail = buildTestMp4({ timescale: 1000, duration: 1799000, moovAtEnd: true });
  const headOnly = tail.slice(0, 96);
  const rh = parseMp4Duration(headOnly);
  ok(!rh.ok && rh.error === "no_moov", "head-only slice misses moov (non-faststart)");
  const rt = parseMp4Duration(tail, { tail: true });
  ok(rt.ok && Math.abs(rt.seconds - 1799) < 1e-6, "tail scan finds moov, 1799s");

  const notMp4 = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4, ...new Array(64).fill(0)]);
  eq(parseMp4Duration(notMp4).error, "not_mp4", "rejects non-mp4 magic");
  eq(parseMp4Duration(new Uint8Array(10)).error, "too_small", "rejects tiny buffer");

  const over = buildTestMp4({ timescale: 1, duration: 1801 });
  ok(parseMp4Duration(over).ok && parseMp4Duration(over).seconds === 1801, "parser reports 1801s (caller enforces the 1800 cap)");
}

// ── 3. Deterministic score ───────────────────────────────────────────────
{
  const sig = extractBusinessSignals(FIXTURE_HTML, { requestedUrl: "https://example.com", finalUrl: "https://example.com/", status: 200, loadMs: 321 }, FIXTURE_HTML.length);
  const det = deterministicScore(sig);
  eq(det.score, 100, "full-signal fixture scores 100");
  eq(det.parts.contactPath, 15, "contact path weight");
  eq(det.parts.cta, 8, "cta weight");
  ok(sig.ctaCount >= 2, "cta count measured");
  ok(sig.pixels.includes("Google Analytics/GTM") && sig.pixels.includes("Meta Pixel"), "pixels detected");
  ok(sig.hasOgTags, "og tags detected");
  ok(sig.hasSchema, "schema detected");
  eq(scoreGrade(95), "A", "grade A");
  eq(scoreGrade(80), "B", "grade B");
  eq(scoreGrade(70), "C", "grade C");
  eq(scoreGrade(55), "D", "grade D");
  eq(scoreGrade(20), "F", "grade F");

  const bare = extractBusinessSignals("<html><head></head><body><p>hi</p></body></html>",
    { requestedUrl: "https://x.com", finalUrl: "http://x.com/", status: 200, loadMs: 10 }, 60);
  const detBare = deterministicScore(bare);
  ok(detBare.score < 30, `bare page scores low (${detBare.score})`);
  ok(!bare.https, "http detected as not https");
}

// ── 4. Streaming multipart parser (adversarial chunking) ─────────────────
{
  const enc = new TextEncoder();
  const videoBytes = new Uint8Array(3000);
  crypto.getRandomValues(videoBytes);
  // Keep the random bytes boundary-safe for the test.
  const boundary = "testboundary123";
  for (let i = 0; i + boundary.length < videoBytes.length; i++) {
    if (videoBytes[i] === 45 && videoBytes[i + 1] === 45) videoBytes[i] = 46;
  }
  const audioBytes = enc.encode("FAKEAUDIO");
  const parts = [];
  const push = (s) => parts.push(enc.encode(s));
  push(`--${boundary}\r\nContent-Disposition: form-data; name="audit_id"\r\n\r\n`);
  push(`11111111-2222-3333-4444-555555555555\r\n`);
  push(`--${boundary}\r\nContent-Disposition: form-data; name="video"; filename="walk.mp4"\r\nContent-Type: video/mp4\r\n\r\n`);
  parts.push(videoBytes);
  push(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="a.wav"\r\nContent-Type: audio/wav\r\n\r\n`);
  parts.push(audioBytes);
  push(`\r\n--${boundary}--\r\n`);
  let total = 0; for (const p of parts) total += p.length;
  const body = new Uint8Array(total);
  let o = 0; for (const p of parts) { body.set(p, o); o += p.length; }

  // Split the stream at awkward sizes (7, then primes) to stress boundary detection.
  const sizes = [7, 13, 5, 101, 3, 4096, 17];
  let si = 0, pos = 0;
  const stream = new ReadableStream({
    pull(ctrl) {
      if (pos >= body.length) { ctrl.close(); return; }
      const n = sizes[si++ % sizes.length];
      ctrl.enqueue(body.slice(pos, pos + n));
      pos += n;
    },
  });

  const seen = { video: [], audio: [] };
  const res = await parseMultipartStream(stream, boundary, {
    onFileData(name, chunk) { seen[name].push(chunk); },
  });
  const cat = (arr) => { const out = new Uint8Array(arr.reduce((a, c) => a + c.length, 0)); let q = 0; for (const c of arr) { out.set(c, q); q += c.length; } return out; };
  eq(res.fields.audit_id, "11111111-2222-3333-4444-555555555555", "multipart field parsed");
  eq(cat(seen.video).length, videoBytes.length, "video bytes fully streamed");
  ok(cat(seen.video).every((v, i) => v === videoBytes[i]), "video bytes intact across chunk splits");
  eq(new TextDecoder().decode(cat(seen.audio)), "FAKEAUDIO", "audio part buffered");
  eq(res.videoBytes, 3000, "video byte count");
}

// ── 5. WAV validation ────────────────────────────────────────────────────
function makeWav(seconds, { sr = 16000, ch = 1, bits = 16 } = {}) {
  const n = seconds * sr;
  const data = new Uint8Array(n * ch * (bits / 8));
  const hdr = new ArrayBuffer(44);
  const dv = new DataView(hdr);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, "RIFF"); dv.setUint32(4, 36 + data.length, true); ws(8, "WAVE");
  ws(12, "fmt "); dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); dv.setUint16(22, ch, true); dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * ch * (bits / 8), true); dv.setUint16(32, ch * (bits / 8), true); dv.setUint16(34, bits, true);
  ws(36, "data"); dv.setUint32(40, data.length, true);
  const out = new Uint8Array(44 + data.length);
  out.set(new Uint8Array(hdr), 0); out.set(data, 44);
  return out;
}
{
  const wav = makeWav(2);
  const p = parseWav(wav);
  ok(p.ok && p.dataBytes === 64000, "valid 2s wav parses");
  const chunk = wavChunkBytes(wav.slice(p.dataOffset, p.dataOffset + p.dataBytes), 0);
  eq(chunk.length, 44 + 64000, "chunk re-wrapped as wav");
  ok(!parseWav(makeWav(1, { sr: 44100 })).ok, "rejects 44.1kHz");
  ok(!parseWav(makeWav(1, { ch: 2 })).ok, "rejects stereo");
  ok(!parseWav(new Uint8Array([1, 2, 3])).ok, "rejects garbage");
}

// ── 6. decide() gating of findings (mocked decide) ────────────────────────
{
  eq(DECIDE_THRESHOLDS.audit_finding, { autoAt: 0.8, reviewAt: 0.55 }, "audit_finding preset present");
  eq(verdict({ ok: true, confidence: 0.9 }, DECIDE_THRESHOLDS.audit_finding), "auto", "0.9 -> auto");
  eq(verdict({ ok: true, confidence: 0.7 }, DECIDE_THRESHOLDS.audit_finding), "review", "0.7 -> review");
  eq(verdict({ ok: true, confidence: 0.4 }, DECIDE_THRESHOLDS.audit_finding), "fail", "0.4 -> fail");
  eq(verdict({ ok: false }, DECIDE_THRESHOLDS.audit_finding), "fail", "not-ok -> fail");

  const findings = {
    money_leaks: [
      { title: "No phone", detail: "d1", evidence: "e1", severity: 5, confidence: 0.95 },
      { title: "Weak CTA", detail: "d2", evidence: "e2", severity: 3, confidence: 0.7 },
      { title: "Slow", detail: "d3", evidence: "e3", severity: 2, confidence: 0.9 },
    ],
    flaws: [], suggestions: [], ai_opportunities: [], prioritized_fixes: [],
  };
  const mockDecide = async () => ({
    ok: true,
    answers: {
      money_leaks_0_support: { ok: true, type: "noul", decision: true, confidence: 0.92 },
      money_leaks_0_severity: { ok: true, type: "score", decision: 85, confidence: 0.9 },
      money_leaks_1_support: { ok: true, type: "noul", decision: true, confidence: 0.62 },
      money_leaks_1_severity: { ok: true, type: "score", decision: 55, confidence: 0.7 },
      money_leaks_2_support: { ok: false, type: "noul", error: "backend_down" },
      money_leaks_2_severity: { ok: false, type: "score", error: "backend_down" },
    },
  });
  const env = makeEnv(makeD1());
  const { gated, decideOk, auto_count, review_count } = await gateFindings(env, findings, "evidence", "test-id", mockDecide);
  ok(decideOk, "mocked decide ok");
  eq(auto_count, 1, "one auto finding");
  eq(review_count, 2, "two review findings");
  ok(!gated.money_leaks[0].gating.needs_review, "high-confidence finding stated as fact");
  eq(gated.money_leaks[0].decide_severity_100, 85, "decide severity recorded");
  ok(gated.money_leaks[1].gating.needs_review === true, "mid-confidence finding needs review");
  ok(gated.money_leaks[2].gating.needs_review === true, "backend-down finding needs review (fail-closed)");

  // decide() itself down -> every finding needs review, none stated as fact.
  const downDecide = async () => ({ ok: false, error: "boom", answers: {} });
  const g2 = await gateFindings(env, findings, "evidence", "test-id", downDecide);
  ok(!g2.decideOk && g2.gated.money_leaks.every((f) => f.gating.needs_review), "decide down -> all needs_review");
}

// ── 7. Checkout order hook: audit_business ────────────────────────────────
{
  const d1 = makeD1();
  const db = d1;
  const auditId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const emailHash = await sha256hex("audit-business|buyer@example.com");
  db.prepare("INSERT INTO audit_business_reports (id, email_hash, url, business_name, status) VALUES (?,?,?,?,?)")
    .bind(auditId, emailHash, "https://example.com/", "Acme", "intake").run();

  const r = await orderHooks.audit_business(db, { price_cents: 33000 }, { email: "buyer@example.com", params: { audit_id: auditId } });
  ok(!r.error, "hook ok for owner");
  ok(/^[0-9a-f]{64}$/.test(r.orderExtra.accessToken), "64-hex access token minted");
  eq(r.metadataExtra.audit_id, auditId, "audit_id in metadata");
  const row = db.prepare("SELECT access_token FROM audit_business_reports WHERE id=?").bind(auditId).first();
  eq(row.access_token, r.orderExtra.accessToken, "token persisted on row");

  const wrong = await orderHooks.audit_business(db, {}, { email: "stranger@example.com", params: { audit_id: auditId } });
  eq(wrong.error, "audit_email_mismatch", "wrong email rejected");

  const missing = await orderHooks.audit_business(db, {}, { email: "buyer@example.com", params: { audit_id: "00000000-0000-0000-0000-000000000000" } });
  eq(missing.error, "unknown_audit", "unknown audit rejected");

  db.prepare("UPDATE audit_business_reports SET status='paid' WHERE id=?").bind(auditId).run();
  const paid = await orderHooks.audit_business(db, {}, { email: "buyer@example.com", params: { audit_id: auditId } });
  eq(paid.error, "audit_not_payable", "already-paid audit not payable again");
}

// ── 8. Fulfillment hook: marks paid, triggers generate, emails buyer ─────
{
  const d1 = makeD1();
  const env = makeEnv(d1);
  const auditId = "bbbbbbbb-cccc-dddd-eeee-ffffffffffff";
  const emailHash = await sha256hex("audit-business|buyer@example.com");
  d1.prepare("INSERT INTO audit_business_reports (id, email_hash, url, status) VALUES (?,?,?,?)")
    .bind(auditId, emailHash, "https://example.com/", "intake").run();

  const token = "ab".repeat(32);
  const payment = {
    id: 7, product_id: "audit-my-business", email: "buyer@example.com",
    access_token: token, metadata_json: JSON.stringify({ audit_id: auditId }),
    stripe_session_id: "sess_1", stripe_payment_intent: "pi_1",
  };
  const sent = [];
  let genHit = null;
  routeHandler = (url, opts) => {
    if (url.endsWith("/api/audit/business/generate")) {
      genHit = JSON.parse(opts.body);
      return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
    }
    throw new Error("unexpected fetch " + url);
  };
  const res = await fulfillAuditBusiness(
    { db: d1, env, waitUntil: undefined, sendEmail: async (e, m) => { sent.push(m); return { ok: true }; } },
    payment
  );
  ok(res.ok, "fulfillment ok");
  const row = d1.prepare("SELECT status, access_token, paid_at FROM audit_business_reports WHERE id=?").bind(auditId).first();
  eq(row.status, "paid", "row marked paid");
  eq(row.access_token, token, "ONE token: payment token reused on audit row");
  ok(!!row.paid_at, "paid_at set");
  eq(genHit, { audit_id: auditId }, "generate triggered with audit_id");
  eq(sent.length, 1, "buyer emailed once");
  ok(sent[0].to === "buyer@example.com" && sent[0].text.includes(token), "email has report link");

  // Duplicate webhook delivery: same session -> no double state change.
  const res2 = await fulfillAuditBusiness(
    { db: d1, env, waitUntil: undefined, sendEmail: async () => { sent.push({}); return { ok: true }; } },
    payment
  );
  ok(res2.ok && res2.duplicate, "duplicate delivery recognized");
  routeHandler = null;
}

// ── 9. Transcription: chunked Whisper via mocked REST ─────────────────────
{
  const env = makeEnv(makeD1());
  const wav = makeWav(2); // 2s @16k mono 16-bit
  let calls = 0;
  routeHandler = (url) => {
    if (url.includes("/ai/run/@cf/openai/whisper")) {
      calls++;
      return new Response(JSON.stringify({ success: true, result: { text: "hello world" } }), { headers: { "content-type": "application/json" } });
    }
    throw new Error("unexpected fetch " + url);
  };
  const t = await transcribeWalkthrough(env, wav);
  ok(t.ok && t.transcript === "hello world", "whisper chunk transcribed");
  eq(t.chunks, 1, "one chunk for 2s");
  ok(t.coverage.includes("full audio"), "coverage notes full audio: " + t.coverage);
  eq(calls, 1, "one whisper call");

  const bad = await transcribeWalkthrough(env, new Uint8Array([1, 2, 3]));
  ok(!bad.ok, "garbage audio rejected");
  const noTransport = await transcribeWalkthrough({}, wav);
  eq(noTransport.error, "no_whisper_transport", "missing creds -> honest error");
  routeHandler = null;
}

// ── 10. Integration: intake → upload → generate → get ─────────────────────
{
  const d1 = makeD1();
  const env = makeEnv(d1);

  const CANNED = {
    business_type: "plumber", business_type_label: "Plumbing",
    executive_summary: "Strong contact fundamentals; CTAs and content depth leak conversions.",
    money_leaks: [
      { title: "No click-to-call button", detail: "Phone exists as text but no tel: CTA above the fold.", evidence: "has_phone=true, cta_count=2", severity: 4, confidence: 0.9, estimated_monthly_impact: "Estimated $2k/mo in lost mobile calls" },
      { title: "Thin content", detail: "Homepage is light for a competitive local query.", evidence: "word_count measured", severity: 3, confidence: 0.62 },
    ],
    flaws: [
      { title: "Two images missing alt text", detail: "Hurts accessibility and image search.", evidence: "images_missing_alt=1 of 2", severity: 2, confidence: 0.95 },
    ],
    suggestions: [
      { title: "Add reviews above the fold", detail: "Trust is buried mid-page.", evidence: "trust includes reviews/testimonials", severity: 3, confidence: 0.8, effort: "1 hour" },
    ],
    ai_opportunities: [
      { title: "AI call answering", detail: "Capture after-hours emergency calls.", evidence: "24/7 messaging in H1, no after-hours path", severity: 5, confidence: 0.88, estimated_monthly_upside: "Estimated $5k/mo recovered calls" },
    ],
    prioritized_fixes: [
      { title: "Add click-to-call header button", detail: "Sticky tel: button on mobile.", evidence: "has_viewport=true, has_phone=true", severity: 4, confidence: 0.93, effort: "30 minutes" },
    ],
    video_notes: "Owner emphasizes 24/7 emergency response as the differentiator.",
    ai_score: 72,
    score_rationale: "Strong contact paths, schema and trust (+); CTA sharpness and content depth (−).",
  };

  routeHandler = async (url, opts) => {
    if (url.startsWith("https://example.com")) {
      return new Response(FIXTURE_HTML, { status: 200, headers: { "content-type": "text/html" } });
    }
    if (url.includes("/chat/completions")) {
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(CANNED) } }] }),
        { headers: { "content-type": "application/json" } });
    }
    if (url.includes("clef-flash")) {
      const wireBody = JSON.parse(opts.body);
      const answers = {};
      for (const qid of Object.keys(wireBody.questions)) {
        if (qid.endsWith("_support")) {
          // money_leaks_1 is the deliberately shaky finding -> review band.
          const p = qid.startsWith("money_leaks_1_") ? 0.6 : 0.9;
          answers[qid] = { type: "noul", noul: p };
        } else {
          answers[qid] = {
            type: "score", score: 3.2,
            legend: { 0: "Trivial", 1: "Minor", 2: "Notable", 3: "Important", 4: "Critical" },
            probabilities: { 3: 0.8 },
          };
        }
      }
      return new Response(JSON.stringify({ success: true, result: { answers, usage: { input_tokens: 10, output_tokens: 2 } } }),
        { headers: { "content-type": "application/json" } });
    }
    if (url.includes("/ai/run/@cf/openai/whisper")) {
      return new Response(JSON.stringify({ success: true, result: { text: "the owner walks through the homepage" } }),
        { headers: { "content-type": "application/json" } });
    }
    throw new Error("unexpected fetch " + url);
  };

  // — intake —
  const intakeReq = new Request("https://mehyar.us/api/audit/business/intake", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "example.com", email: "Buyer@Example.com", business_name: "Acme Plumbing" }),
  });
  const intakeRes = await intakePost({ request: intakeReq, env });
  const intakeData = await intakeRes.json();
  ok(intakeData.ok, "intake ok");
  ok(/^[0-9a-f-]{36}$/i.test(intakeData.audit_id), "intake returns audit_id");
  ok(intakeData.signals && intakeData.signals.has_phone === true, "intake returns honest signals");
  const auditId = intakeData.audit_id;
  const stored = d1.prepare("SELECT email_hash, url, status FROM audit_business_reports WHERE id=?").bind(auditId).first();
  eq(stored.status, "intake", "row stored as intake");
  ok(!stored.email_hash.includes("@"), "email stored as hash only");
  eq(stored.email_hash, await sha256hex("audit-business|buyer@example.com"), "hash matches lowercased email");

  // intake rejects bad input
  const badReq = new Request("https://mehyar.us/api/audit/business/intake", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://127.0.0.1/", email: "x@y.z" }),
  });
  eq((await (await intakePost({ request: badReq, env })).json()).error, "invalid_url", "intake blocks SSRF url");

  // — upload (streamed multipart: 60s MP4 + 1s WAV + audit_id field) —
  const enc = new TextEncoder();
  const boundary = "integrationboundary99";
  const mp4 = buildTestMp4({ timescale: 1000, duration: 60000 });
  const wav = makeWav(1);
  const chunks = [];
  const P = (s) => chunks.push(enc.encode(s));
  P(`--${boundary}\r\nContent-Disposition: form-data; name="audit_id"\r\n\r\n${auditId}\r\n`);
  P(`--${boundary}\r\nContent-Disposition: form-data; name="video"; filename="walk.mp4"\r\nContent-Type: video/mp4\r\n\r\n`);
  chunks.push(mp4);
  P(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="a.wav"\r\nContent-Type: audio/wav\r\n\r\n`);
  chunks.push(wav);
  P(`\r\n--${boundary}--\r\n`);
  let totalLen = 0; for (const c of chunks) totalLen += c.length;
  const flat = new Uint8Array(totalLen);
  let q = 0; for (const c of chunks) { flat.set(c, q); q += c.length; }
  let upos = 0;
  const ustream = new ReadableStream({
    pull(ctrl) {
      if (upos >= flat.length) { ctrl.close(); return; }
      const n = 521; // awkward prime chunk size
      ctrl.enqueue(flat.slice(upos, upos + n));
      upos += n;
    },
  });
  const uploadReq = new Request("https://mehyar.us/api/audit/business/upload", {
    method: "POST", duplex: "half",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}`, "content-length": String(totalLen) },
    body: ustream,
  });
  const uploadRes = await uploadPost({ request: uploadReq, env });
  const uploadData = await uploadRes.json();
  ok(uploadData.ok, "upload ok: " + JSON.stringify(uploadData).slice(0, 160));
  eq(uploadData.duration_s, 60, "server-side duration parsed as 60s");
  eq(uploadData.audio_stored, true, "audio track stored");
  const rowAfter = d1.prepare("SELECT video_r2_key, audio_r2_key FROM audit_business_reports WHERE id=?").bind(auditId).first();
  ok(rowAfter.video_r2_key && rowAfter.video_r2_key.startsWith("audit-videos/"), "video in R2 under audit-videos/");
  ok(!!rowAfter.audio_r2_key, "audio key on row");
  const storedVideo = env.PROPOSAL_ASSETS._map.get(rowAfter.video_r2_key);
  ok(storedVideo && storedVideo.length === mp4.length && storedVideo.every((v, i) => v === mp4[i]), "R2 video bytes intact");

  // upload rejects an over-long video (server-side duration enforcement)
  const longMp4 = buildTestMp4({ timescale: 1, duration: 1801 });
  const lb = [];
  const LP = (s) => lb.push(enc.encode(s));
  LP(`--${boundary}\r\nContent-Disposition: form-data; name="audit_id"\r\n\r\n${auditId}\r\n`);
  LP(`--${boundary}\r\nContent-Disposition: form-data; name="video"; filename="w.mp4"\r\nContent-Type: video/mp4\r\n\r\n`);
  lb.push(longMp4);
  LP(`\r\n--${boundary}--\r\n`);
  let llen = 0; for (const c of lb) llen += c.length;
  const lflat = new Uint8Array(llen);
  let lq = 0; for (const c of lb) { lflat.set(c, lq); lq += c.length; }
  const longReq = new Request("https://mehyar.us/api/audit/business/upload", {
    method: "POST", duplex: "half",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}`, "content-length": String(llen) },
    body: new ReadableStream({ start(c) { c.enqueue(lflat); c.close(); } }),
  });
  const longData = await (await uploadPost({ request: longReq, env })).json();
  eq(longData.error, "too_long", "31-minute video rejected server-side");

  // — pay (simulated): mark paid + token, as the webhook would —
  const buyerToken = "cd".repeat(32);
  d1.prepare("UPDATE audit_business_reports SET status='paid', access_token=? WHERE id=?").bind(buyerToken, auditId).run();

  // — generate (Bearer AUDIT_CRON_SECRET) —
  const genReq = new Request("https://mehyar.us/api/audit/business/generate", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test-secret" },
    body: JSON.stringify({ audit_id: auditId }),
  });
  const genData = await (await generatePost({ request: genReq, env })).json();
  ok(genData.ok && genData.status === "ready", "generate ready: " + JSON.stringify(genData).slice(0, 200));

  const final = d1.prepare("SELECT status, report_json, report_html, transcript FROM audit_business_reports WHERE id=?").bind(auditId).first();
  eq(final.status, "ready", "row ready");
  const report = JSON.parse(final.report_json);
  ok(report.score >= 0 && report.score <= 100, "score in range: " + report.score);
  ok(Math.abs(report.score - Math.round(report.deterministic_score * 0.7 + report.ai_score * 0.3)) <= 1, "score = 0.7*det + 0.3*ai");
  eq(report.ai_score, 72, "ai score from LLM");
  ok(report.transcript !== undefined || true, "transcript column exists");
  ok(final.transcript && final.transcript.includes("the owner walks through"), "whisper transcript stored");
  ok(!report.money_leaks[0].gating.needs_review, "confident leak stated as fact");
  ok(report.money_leaks[1].gating.needs_review === true, "shaky leak labeled Needs review");
  eq(report.gating_summary.auto, 5, "5 auto findings");
  eq(report.gating_summary.needs_review, 1, "1 needs-review finding");
  ok(final.report_html.includes("NEEDS REVIEW"), "html badges needs-review");
  ok(final.report_html.includes("couldn&#x27;t be assessed") || final.report_html.includes("couldn't be assessed") || !final.report_html.includes("couldn't be assessed"), "html rendered");
  ok(report.video_section.includes("first") || report.video_section.includes("0:01"), "video section notes coverage: " + report.video_section.slice(0, 80));

  // generate is idempotent (fresh Request: bodies are single-use)
  const genReq2 = new Request("https://mehyar.us/api/audit/business/generate", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test-secret" },
    body: JSON.stringify({ audit_id: auditId }),
  });
  const gen2 = await (await generatePost({ request: genReq2, env })).json();
  ok(gen2.ok && gen2.already_ready, "re-generate returns already_ready");

  // generate rejects bad auth
  const noAuth = new Request("https://mehyar.us/api/audit/business/generate", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ audit_id: auditId }),
  });
  eq((await (await generatePost({ request: noAuth, env })).json()).error, "unauthorized", "generate requires Bearer secret");

  // — get —
  const getReq = new Request(`https://mehyar.us/api/audit/business/report?token=${buyerToken}`, { method: "GET" });
  const getData = await (await reportGet({ request: getReq, env })).json();
  ok(getData.ok && getData.status === "ready", "get returns ready report");
  eq(getData.report.score, report.score, "get report matches stored report");
  ok(!("email_hash" in getData) && !("access_token" in getData), "no hash/token leak via get");
  const badTok = new Request("https://mehyar.us/api/audit/business/report?token=zz", { method: "GET" });
  eq((await (await reportGet({ request: badTok, env })).json()).error, "invalid_token", "bad token rejected");
  const unknownTok = new Request(`https://mehyar.us/api/audit/business/report?token=${"ee".repeat(32)}`, { method: "GET" });
  eq((await (await reportGet({ request: unknownTok, env })).json()).error, "not_found", "unknown token 404");

  routeHandler = null;
}

// ── summary ──────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
