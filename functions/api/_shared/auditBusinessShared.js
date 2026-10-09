// functions/api/_shared/auditBusinessShared.js
// Shared helpers for the "Audit My Business" product ($330 one-time audit).
// Pure functions (no env) except where noted — unit-tested in
// functions/api/audit/business/auditBusiness.test.js.

export function sanitize(v, max = 200) {
  return String(v || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sha256hex(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// normalizeUrl — SSRF protection. The private/internal blocklist is reused
// VERBATIM from functions/api/audit/scan.js (free 60s audit). One hardening
// beyond scan.js: an explicit non-http(s) scheme (ftp:, file:, …) is rejected
// instead of being rewritten to https://.
export function normalizeUrl(raw) {
  let u = sanitize(raw, 300);
  if (!u) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(u) && !/^https?:\/\//i.test(u)) return null;
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  let parsed;
  try { parsed = new URL(u); } catch { return null; }
  if (!/^https?:$/.test(parsed.protocol)) return null;
  const host = parsed.hostname.toLowerCase();
  // Block private/internal targets — this fetch runs server-side.
  // 169.254.169.254 is the cloud metadata endpoint (credential theft).
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[?::1\]?)/.test(host)) return null;
  if (host.endsWith(".local") || host === "localhost") return null;
  return parsed.toString();
}

export function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

// Extended signal extraction for the paid audit. Same honest core as the
// free scan, plus: OG tags, analytics pixels, page weight, CTA count — every
// number in the report traces back to one of these measured signals.
export function extractBusinessSignals(html, meta, byteLength) {
  const get = (re) => { const m = html.match(re); return m ? m[1].trim() : ""; };

  const title = get(/<title[^>]*>([^<]{1,200})<\/title>/i);
  const metaDesc = get(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,300})/i)
    || get(/<meta[^>]+content=["']([^"']{1,300})["'][^>]+name=["']description["']/i);
  const ogTitle = get(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{1,200})/i)
    || get(/<meta[^>]+content=["']([^"']{1,200})["'][^>]+property=["']og:title["']/i);
  const ogDesc = get(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{1,300})/i)
    || get(/<meta[^>]+content=["']([^"']{1,300})["'][^>]+property=["']og:description["']/i);

  const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]{1,200}?)<\/h1>/gi)]
    .map((m) => stripTags(m[1]).slice(0, 120)).filter(Boolean);
  const headings = [...html.matchAll(/<h[23][^>]*>([\s\S]{1,140}?)<\/h[23]>/gi)]
    .map((m) => stripTags(m[1]).slice(0, 100)).filter(Boolean);

  const phones = [...new Set([...html.matchAll(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g)].map((m) => m[0]))].slice(0, 3);
  const emails = [...new Set([...html.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)].map((m) => m[0].toLowerCase()))]
    .filter((e) => !e.includes("example.") && !e.includes("sentry") && !e.includes(".png") && !e.includes(".jpg")).slice(0, 3);

  const links = [...html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi)];
  const linkTexts = links.map((m) => stripTags(m[2]).toLowerCase());
  const hasContactLink = links.some((m) =>
    /contact|book|schedule|appointment|call|quote|estimate/i.test(m[1]) ||
    /contact|book|schedule|appointment|call us|get (a )?quote|free estimate/i.test(stripTags(m[2])));
  const ctas = [...new Set(linkTexts.filter((t) =>
    t.length > 2 && t.length < 40 &&
    /book|call|schedule|quote|estimate|buy|shop|order|sign|start|try|demo|contact|learn more|get/i.test(t)))].slice(0, 10);
  const formCount = (html.match(/<form[\s>]/gi) || []).length;

  const socials = [];
  if (/facebook\.com\//i.test(html)) socials.push("Facebook");
  if (/instagram\.com\//i.test(html)) socials.push("Instagram");
  if (/linkedin\.com\//i.test(html)) socials.push("LinkedIn");
  if (/(twitter\.com|x\.com)\//i.test(html)) socials.push("X");
  if (/youtube\.com\//i.test(html)) socials.push("YouTube");
  if (/tiktok\.com\//i.test(html)) socials.push("TikTok");

  // Analytics / tracking pixels actually present in the markup.
  const pixels = [];
  if (/googletagmanager\.com\/gtm\.js|googletagmanager\.com\/gtag\/js|google-analytics\.com/i.test(html)) pixels.push("Google Analytics/GTM");
  if (/connect\.facebook\.net\/[^"']*fbevents|fbq\(/i.test(html)) pixels.push("Meta Pixel");
  if (/hotjar\.com/i.test(html)) pixels.push("Hotjar");
  if (/clarity\.ms/i.test(html)) pixels.push("Microsoft Clarity");
  if (/tiktok.*pixel|ttq\(/i.test(html)) pixels.push("TikTok Pixel");

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
  const pageWeightKb = Math.round((byteLength || 0) / 1024);

  // ── JS app-shell detection (honest measurement) ──────────────────────────
  // A mounted app root + near-empty document text + a substantial script
  // payload means the page renders its content client-side. The raw-HTML
  // signals below (word count, headings, forms, CTAs, contact details)
  // then reflect only the pre-hydration shell — they are UNMEASURED, not
  // zero. Consumers must disclose "couldn't be assessed" for them instead
  // of reporting the undercounted numbers. Never fabricate, never inflate.
  const textChars = text.trim().length;
  const scriptChars = (html.match(/<script[\s>][\s\S]*?<\/script>/gi) || []).join("").length;
  const hasAppRoot = /<div[^>]+id=["'](root|app|__next|___gatsby)["']/i.test(html);
  const contentUnmeasured = hasAppRoot && textChars < 600 && scriptChars > 5000;

  return {
    url: meta.requestedUrl,
    finalUrl: meta.finalUrl,
    status: meta.status,
    https: String(meta.finalUrl || "").startsWith("https"),
    loadMs: meta.loadMs,
    title,
    metaDescription: metaDesc,
    ogTitle,
    ogDescription: ogDesc,
    hasOgTags: !!(ogTitle || ogDesc),
    h1: h1s[0] || "",
    h1Count: h1s.length,
    headlines: [...h1s.slice(1), ...headings].slice(0, 6),
    wordCount,
    pageWeightKb,
    hasPhone: phones.length > 0,
    phoneCount: phones.length,
    hasEmail: emails.length > 0,
    hasContactLink,
    hasContactPath: phones.length > 0 || emails.length > 0 || hasContactLink || formCount > 0,
    formCount,
    ctaCount: ctas.length,
    ctas,
    hasViewport: /<meta[^>]+name=["']viewport["']/i.test(html),
    socials,
    pixels,
    hasAddress: /\d{1,5}\s+[A-Za-z0-9.' ]+\s+(street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|way|court|ct|plaza)/i.test(text)
      || /\b[A-Z]{2}\s+\d{5}(-\d{4})?\b/.test(text),
    trust,
    imagesMissingAlt: imgsMissingAlt,
    imageCount: imgs.length,
    hasSchema: /application\/ld\+json/i.test(html) || /itemtype=["']http:\/\/schema\.org/i.test(html),
    textSample: text.slice(0, 2500),
    // True when the page is a JS app shell: content-dependent signals above
    // (wordCount, h1, forms, CTAs, contact details) could NOT be measured
    // from the initial HTML and must be disclosed as unassessed, not zero.
    contentUnmeasured,
  };
}

// ── Deterministic score formula ────────────────────────────────────────────
// Every point traces to a measured signal above — nothing is invented.
// Component weights (max 100):
//   https 8 · title 8 · meta description 6 · h1 8 · mobile viewport 10
//   contact path (phone/email/contact link/form) 15 · CTA present 8
//   content depth (>=300 words 10, >=100 words 5) · trust signals 8
//   schema.org 4 · OG tags 4 · analytics pixel 3 · socials 3
//   initial HTML weight (<100KB 5, <300KB 2)
// Overall report score = round(0.7 * deterministic + 0.3 * ai_score),
// where ai_score is the LLM's 0-100 holistic assessment WITH a written
// rationale citing the signals that drove it. Both halves are checkable.
export const SCORE_WEIGHTS = {
  https: 8, title: 8, metaDescription: 6, h1: 8, viewport: 10,
  contactPath: 15, cta: 8, contentDepth: 10, trust: 8, schema: 4,
  ogTags: 4, analytics: 3, socials: 3, pageWeight: 5,
};

export function deterministicScore(sig) {
  const w = SCORE_WEIGHTS;
  const parts = {};
  parts.https = sig.https ? w.https : 0;
  parts.title = sig.title ? w.title : 0;
  parts.metaDescription = sig.metaDescription ? w.metaDescription : 0;
  parts.h1 = sig.h1 ? w.h1 : 0;
  parts.viewport = sig.hasViewport ? w.viewport : 0;
  parts.contactPath = sig.hasContactPath ? w.contactPath : 0;
  parts.cta = sig.ctaCount > 0 ? w.cta : 0;
  parts.contentDepth = sig.wordCount >= 300 ? w.contentDepth : sig.wordCount >= 100 ? Math.round(w.contentDepth / 2) : 0;
  parts.trust = sig.trust && sig.trust.length > 0 ? w.trust : 0;
  parts.schema = sig.hasSchema ? w.schema : 0;
  parts.ogTags = sig.hasOgTags ? w.ogTags : 0;
  parts.analytics = sig.pixels && sig.pixels.length > 0 ? w.analytics : 0;
  parts.socials = sig.socials && sig.socials.length > 0 ? w.socials : 0;
  parts.pageWeight = sig.pageWeightKb < 100 ? w.pageWeight : sig.pageWeightKb < 300 ? 2 : 0;
  const score = Math.max(0, Math.min(100, Object.values(parts).reduce((a, b) => a + b, 0)));
  // Components that scored zero ONLY because the content couldn't be measured
  // (JS app shell) are listed here so reports can disclose "couldn't be
  // assessed" instead of presenting the 0 as a measured failure. Points stay
  // 0 — we never inflate — but the absence is not a verified finding.
  const unmeasured = [];
  if (sig.contentUnmeasured) {
    if (!sig.h1) unmeasured.push("h1");
    if (sig.wordCount < 100) unmeasured.push("contentDepth");
    if (!sig.ctaCount) unmeasured.push("cta");
    if (!sig.hasContactPath) unmeasured.push("contactPath");
  }
  return { score, parts, unmeasured };
}

export function scoreGrade(score) {
  return score >= 90 ? "A" : score >= 78 ? "B" : score >= 65 ? "C" : score >= 50 ? "D" : "F";
}

// ── MP4 duration parser (pure JS box walker, no deps) ─────────────────────
// Reads ftyp (magic bytes) -> moov -> mvhd -> timescale/duration.
// Works on a head buffer (faststart: moov at front) or a tail buffer
// (moov at end): pass { tail: true } and we scan every top-level box in the
// buffer for moov instead of requiring ftyp at offset 0.
function readU32(buf, off) {
  return (buf[off] * 0x1000000) + ((buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3]);
}
function readU64n(buf, off) {
  return readU32(buf, off) * 0x100000000 + readU32(buf, off + 4);
}
function boxType(buf, off) {
  return String.fromCharCode(buf[off], buf[off + 1], buf[off + 2], buf[off + 3]);
}
function findTopBox(buf, type, start, end) {
  let o = start;
  while (o + 8 <= end) {
    let size = readU32(buf, o);
    let hdr = 8;
    if (size === 1) { size = readU64n(buf, o + 8); hdr = 16; }
    else if (size === 0) { size = end - o; }
    if (size < hdr || o + size > end + hdr) break;
    if (boxType(buf, o + 4) === type) return { offset: o, size, header: hdr };
    o += size;
  }
  return null;
}

export function parseMp4Duration(buf, { tail = false } = {}) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (bytes.length < 32) return { ok: false, error: "too_small" };
  if (!tail) {
    // Magic bytes: [u32 size][ftyp]
    if (boxType(bytes, 4) !== "ftyp") return { ok: false, error: "not_mp4" };
  }
  const moov = findTopBox(bytes, "moov", 0, bytes.length);
  if (!moov) return { ok: false, error: "no_moov" };
  const innerStart = moov.offset + moov.header;
  const innerEnd = Math.min(bytes.length, moov.offset + moov.size);
  const mvhd = findTopBox(bytes, "mvhd", innerStart, innerEnd);
  if (!mvhd) return { ok: false, error: "no_mvhd" };
  let p = mvhd.offset + mvhd.header;
  const version = bytes[p];
  p += 4; // version + flags
  let timescale, duration;
  if (version === 1) {
    p += 16; // creation + modification (64-bit)
    timescale = readU32(bytes, p);
    duration = readU64n(bytes, p + 4);
  } else if (version === 0) {
    p += 8; // creation + modification (32-bit)
    timescale = readU32(bytes, p);
    duration = readU32(bytes, p + 4);
  } else {
    return { ok: false, error: "bad_mvhd_version" };
  }
  if (!timescale || timescale > 1000000) return { ok: false, error: "bad_timescale" };
  return { ok: true, seconds: duration / timescale, timescale, duration };
}

// Build a minimal synthetic MP4 (ftyp + moov/mvhd) for unit tests.
export function buildTestMp4({ timescale = 1000, duration = 60000, version = 0, moovAtEnd = false, brand = "isom" } = {}) {
  const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const box = (type, payload) => {
    const size = 8 + payload.length;
    return [...be32(size), ...[...type].map((c) => c.charCodeAt(0)), ...payload];
  };
  let mvhdBody;
  if (version === 1) {
    const hi = (n) => be32(Math.floor(n / 0x100000000));
    const lo = (n) => be32(n % 0x100000000);
    mvhdBody = [1, 0, 0, 0, ...hi(0), ...lo(0), ...hi(0), ...lo(0), ...be32(timescale), ...hi(duration), ...lo(duration)];
  } else {
    mvhdBody = [0, 0, 0, 0, ...be32(0), ...be32(0), ...be32(timescale), ...be32(duration)];
  }
  const ftyp = box("ftyp", [...[...brand].map((c) => c.charCodeAt(0)), 0, 0, 0, 0, ...[..."isom"].map((c) => c.charCodeAt(0))]);
  const moov = box("moov", box("mvhd", mvhdBody));
  if (moovAtEnd) {
    // ftyp, then a junk "free" box — moov lives at the tail (non-faststart).
    const free = box("free", new Array(48).fill(0));
    return new Uint8Array([...ftyp, ...free, ...moov]);
  }
  return new Uint8Array([...ftyp, ...moov]);
}

// ── Streaming multipart parser ─────────────────────────────────────────────
// The worker cannot buffer a 1GB upload (128MB isolate memory). This parser
// walks request.body as a stream: the `video` part is written chunk-by-chunk
// to a caller-supplied sink (R2 streaming put) while the first HEAD_BYTES are
// retained for the MP4 box walk; the optional `audio` part is buffered in
// memory (capped); small text fields are collected.
//
// Callbacks: { onFileStart({name, filename, contentType}), onFileData(name, Uint8Array),
//               onFileEnd(name), onField(name, value), maxAudioBytes }
// Returns { fields, videoBytes, audioBytes, audioTruncated }.
export const MP4_HEAD_BYTES = 4 * 1024 * 1024;

export async function parseMultipartStream(stream, boundary, cb) {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const delim = enc.encode("\r\n--" + boundary);
  const firstDelim = enc.encode("--" + boundary);
  const maxAudio = (cb && cb.maxAudioBytes) || 64 * 1024 * 1024;

  const reader = stream.getReader();
  let buf = new Uint8Array(0);
  let eof = false;
  async function fill(need) {
    while (!eof && buf.length < need) {
      const { done, value } = await reader.read();
      if (done) { eof = true; break; }
      const nb = new Uint8Array(buf.length + value.length);
      nb.set(buf); nb.set(value, buf.length);
      buf = nb;
    }
  }
  function consume(n) { buf = buf.slice(n); }
  function indexOf(hay, needle, from = 0) {
    outer: for (let i = from; i + needle.length <= hay.length; i++) {
      for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
      return i;
    }
    return -1;
  }

  const fields = {};
  let videoBytes = 0;
  let audioBytes = 0;
  let audioTruncated = false;
  let current = null; // { name, filename, contentType, fieldBuf }

  // First boundary (no leading CRLF).
  await fill(firstDelim.length + 2);
  if (indexOf(buf, firstDelim) !== 0) throw new Error("bad_multipart_start");
  consume(firstDelim.length);
  // After the boundary: "\r\n" (more parts) or "--" (end).
  await fill(2);

  async function readLine() {
    for (;;) {
      const i = indexOf(buf, enc.encode("\r\n"));
      if (i >= 0) { const line = dec.decode(buf.slice(0, i)); consume(i + 2); return line; }
      if (eof) return null;
      await fill(buf.length + 8192);
    }
  }

  let done = false;
  while (!done) {
    if (buf.length >= 2 && buf[0] === 45 && buf[1] === 45) { // "--" -> end
      done = true; break;
    }
    await fill(2);
    if (!(buf[0] === 13 && buf[1] === 10)) throw new Error("bad_multipart_boundary");
    consume(2);
    // Part headers.
    let name = "", filename = "", contentType = "";
    for (;;) {
      const line = await readLine();
      if (line === null) throw new Error("bad_multipart_headers");
      if (line === "") break;
      const dm = line.match(/name="([^"]*)"/);
      if (dm) name = dm[1];
      const fm = line.match(/filename="([^"]*)"/);
      if (fm) filename = fm[1];
      const cm = line.match(/^content-type:\s*(.+)$/i);
      if (cm) contentType = cm[1].trim();
    }
    current = { name, filename, contentType, fieldBuf: [] };
    if (cb && cb.onFileStart && filename) cb.onFileStart({ name, filename, contentType });

    // Part body: stream until delimiter.
    let closed = false;
    while (!closed) {
      await fill(delim.length + 1);
      const di = indexOf(buf, delim);
      if (di >= 0) {
        const data = buf.slice(0, di);
        if (data.length) await emitData(current, data);
        consume(di + delim.length);
        // After delimiter: "--" (final) or "\r\n" (next part).
        await fill(2);
        if (buf.length >= 2 && buf[0] === 45 && buf[1] === 45) { consume(2); done = true; }
        else if (eof && buf.length === 0) { done = true; } // ended exactly at --boundary--
        if (cb && cb.onFileEnd && current.filename) cb.onFileEnd(current.name);
        if (!current.filename && current.name) {
          fields[current.name] = dec.decode(Buffer_concat(current.fieldBuf));
        }
        current = null;
        closed = true;
      } else {
        if (eof) throw new Error("bad_multipart_truncated");
        // Emit all but a delim-length tail (boundary may straddle chunks).
        const emitUpTo = buf.length - delim.length;
        if (emitUpTo > 0) {
          await emitData(current, buf.slice(0, emitUpTo));
          consume(emitUpTo);
        } else {
          await fill(buf.length + 65536);
        }
      }
    }
  }

  function Buffer_concat(parts) {
    let len = 0;
    for (const p of parts) len += p.length;
    const out = new Uint8Array(len);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  async function emitData(part, data) {
    if (!part || !data.length) return;
    if (!part.filename) {
      part.fieldBuf.push(data);
      return;
    }
    if (part.name === "audio") {
      // Buffered in memory; hard cap — beyond it we stop accepting bytes.
      if (audioTruncated) return;
      const room = maxAudio - audioBytes;
      if (room <= 0) { audioTruncated = true; return; }
      const take = data.slice(0, room);
      audioBytes += take.length;
      if (data.length > room) audioTruncated = true;
      if (cb && cb.onFileData) await cb.onFileData(part.name, take);
      return;
    }
    videoBytes += data.length;
    // Awaited: the caller's R2 write applies backpressure so a fast upload
    // can't buffer unboundedly in the isolate.
    if (cb && cb.onFileData) await cb.onFileData(part.name, data);
  }

  return { fields, videoBytes, audioBytes, audioTruncated };
}
