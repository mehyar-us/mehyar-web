// functions/api/audit/business/upload.js
// POST /api/audit/business/upload — walkthrough video upload for "Audit My Business".
// multipart/form-data: { audit_id (field), video (MP4 file, required), audio (WAV file, optional) }
//
// FRONTEND CONTRACT (the audit page implements this):
//   1. Client-side pre-check: video.duration <= 1800s (reject longer locally).
//   2. Extract the audio track client-side — Workers cannot run ffmpeg or
//      decode AAC, so the page does: fetch MP4 bytes -> AudioContext
//      (sampleRate 16000) -> decodeAudioData -> downmix to mono ->
//      16-bit PCM WAV -> appended as the `audio` part (audio.wav).
//      30 min at 16kHz mono 16-bit ≈ 57MB, under the 64MB server cap.
//   3. POST the multipart body. Server validates everything below.
//
// SERVER VALIDATION (never trust the client):
//   - MP4 magic bytes: box[0..3]=size, box[4..8]="ftyp" (not the extension).
//   - Duration parsed server-side from moov/mvhd (pure-JS box walker, no
//     deps). REJECT > 1800s (30 min). moov-at-tail (non-faststart) handled
//     via an R2 range GET of the last 4MB.
//   - Hard size cap 1GB: Content-Length pre-check (413 before reading).
//     The body is STREAMED to R2 (never buffered — the isolate has ~128MB);
//     only the first 4MB are retained in memory for the box walk.
//   - Optional audio part: buffered (cap 64MB), must be 16kHz mono 16-bit
//     WAV (validated again at transcription time).
//
// Storage: R2 via the existing PROPOSAL_ASSETS binding (mehyarsoft-reports),
// under the `audit-videos/` prefix — no new bucket, no wrangler change.
// PII: never log video/audio content; log only key + duration + size.

import {
  sanitize, parseMultipartStream, parseMp4Duration, MP4_HEAD_BYTES,
} from "../../_shared/auditBusinessShared.js";

const MAX_VIDEO_BYTES = 1024 * 1024 * 1024; // 1GB hard cap
const MAX_AUDIO_BYTES = 64 * 1024 * 1024;  // 64MB
const MAX_DURATION_S = 1800;               // 30 minutes
const TAIL_BYTES = 4 * 1024 * 1024;
const R2_PREFIX = "audit-videos/";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env?.LEADS_DB || !env?.PROPOSAL_ASSETS) {
      return json({ ok: false, error: "service_unavailable" }, 503);
    }
    const ct = request.headers.get("content-type") || "";
    const bm = ct.match(/boundary=([^;]+)/);
    if (!/multipart\/form-data/i.test(ct) || !bm) {
      return json({ ok: false, error: "invalid_content_type" }, 400);
    }
    const boundary = bm[1].trim().replace(/^"|"$/g, "");

    // Hard size cap BEFORE reading the body.
    const contentLength = Number(request.headers.get("content-length") || "0");
    if (contentLength > MAX_VIDEO_BYTES) {
      return json({ ok: false, error: "too_large", message: "Video must be under 1GB." }, 413);
    }

    // Stream the video part straight into R2; retain the head for the box walk.
    const ts = Date.now();
    let videoKey = null, audioKey = null;
    const headChunks = [];
    let headBytes = 0;
    const audioChunks = [];
    let r2PutPromise = null;
    let r2Writer = null;
    let streamError = null;

    const result = await parseMultipartStream(request.body, boundary, {
      maxAudioBytes: MAX_AUDIO_BYTES,
      onFileStart({ name, filename }) {
        if (name === "video") {
          // Opaque key — never the client-supplied filename.
          const rnd = [...crypto.getRandomValues(new Uint8Array(4))].map((b) => b.toString(16).padStart(2, "0")).join("");
          videoKey = `${R2_PREFIX}upload-${ts}-${rnd}.mp4`;
          const { readable, writable } = new TransformStream();
          r2Writer = writable.getWriter();
          r2PutPromise = env.PROPOSAL_ASSETS.put(videoKey, readable).catch((e) => {
            streamError = "r2_put_failed:" + String((e && e.message) || e).slice(0, 80);
          });
        } else if (name === "audio") {
          const rnd = [...crypto.getRandomValues(new Uint8Array(4))].map((b) => b.toString(16).padStart(2, "0")).join("");
          audioKey = `${R2_PREFIX}upload-${ts}-${rnd}-audio.wav`;
        }
      },
      async onFileData(name, chunk) {
        if (name === "video") {
          if (headBytes < MP4_HEAD_BYTES) {
            const room = MP4_HEAD_BYTES - headBytes;
            headChunks.push(chunk.slice(0, room));
            headBytes += Math.min(room, chunk.length);
          }
          // Awaited by the parser: R2 upload pace throttles the read loop.
          if (r2Writer && !streamError) await r2Writer.write(chunk);
        } else if (name === "audio") {
          audioChunks.push(chunk);
        }
      },
      onFileEnd(name) {
        if (name === "video" && r2Writer) {
          const w = r2Writer; r2Writer = null;
          w.close().catch(() => {});
        }
      },
    }).catch((e) => ({ parseError: String((e && e.message) || e).slice(0, 120) }));

    if (result.parseError) return json({ ok: false, error: "bad_upload", message: result.parseError }, 400);
    if (streamError) {
      try { if (videoKey) await env.PROPOSAL_ASSETS.delete(videoKey); } catch {}
      return json({ ok: false, error: "storage_failed" }, 500);
    }
    if (r2PutPromise) await r2PutPromise;
    if (streamError) {
      try { if (videoKey) await env.PROPOSAL_ASSETS.delete(videoKey); } catch {}
      return json({ ok: false, error: "storage_failed" }, 500);
    }
    if (!videoKey || !result.videoBytes) {
      return json({ ok: false, error: "missing_video" }, 400);
    }
    if (result.videoBytes > MAX_VIDEO_BYTES) {
      await env.PROPOSAL_ASSETS.delete(videoKey).catch(() => {});
      return json({ ok: false, error: "too_large", message: "Video must be under 1GB." }, 413);
    }

    const auditId = sanitize(result.fields.audit_id, 64);
    if (!/^[0-9a-f-]{36}$/i.test(auditId)) {
      await env.PROPOSAL_ASSETS.delete(videoKey).catch(() => {});
      return json({ ok: false, error: "invalid_audit_id" }, 400);
    }
    const row = await env.LEADS_DB.prepare(
      "SELECT id, status FROM audit_business_reports WHERE id = ?"
    ).bind(auditId).first();
    if (!row) {
      await env.PROPOSAL_ASSETS.delete(videoKey).catch(() => {});
      return json({ ok: false, error: "unknown_audit" }, 404);
    }
    if (!["intake", "failed", "paid"].includes(row.status)) {
      await env.PROPOSAL_ASSETS.delete(videoKey).catch(() => {});
      return json({ ok: false, error: "audit_locked", message: "This audit is already being built." }, 409);
    }

    // Rate limit: 5 uploads/day per audit.
    if (env?.INTAKE_KV) {
      const k = `audit:business:upload:${auditId}`;
      const n = Number((await env.INTAKE_KV.get(k)) || "0");
      if (n >= 5) {
        await env.PROPOSAL_ASSETS.delete(videoKey).catch(() => {});
        return json({ ok: false, error: "rate_limited" }, 429);
      }
      await env.INTAKE_KV.put(k, String(n + 1), { expirationTtl: 86400 });
    }

    // MP4 validation: magic bytes + server-side duration from moov/mvhd.
    let headBuf = concat(headChunks);
    let dur = parseMp4Duration(headBuf);
    if (!dur.ok && dur.error === "no_moov" && result.videoBytes > headBuf.length) {
      // Non-faststart: moov lives at the tail. Range-get the last 4MB.
      try {
        const tailObj = await env.PROPOSAL_ASSETS.get(videoKey, {
          range: { offset: Math.max(0, result.videoBytes - TAIL_BYTES), length: TAIL_BYTES },
        });
        if (tailObj) {
          const tailBuf = new Uint8Array(await tailObj.arrayBuffer());
          const tailDur = parseMp4Duration(tailBuf, { tail: true });
          if (tailDur.ok) dur = tailDur;
        }
      } catch (e) {
        console.error("audit upload tail read failed", e && e.message);
      }
    }
    if (!dur.ok) {
      await env.PROPOSAL_ASSETS.delete(videoKey).catch(() => {});
      const msg = dur.error === "not_mp4"
        ? "That file isn't an MP4. Please upload an MP4 video."
        : "We couldn't read that video's duration. Try re-exporting it as MP4.";
      return json({ ok: false, error: "invalid_video", message: msg }, 422);
    }
    if (!(dur.seconds > 0) || dur.seconds > MAX_DURATION_S) {
      await env.PROPOSAL_ASSETS.delete(videoKey).catch(() => {});
      return json({
        ok: false, error: "too_long",
        message: `That video is ${Math.round(dur.seconds / 60)} minutes — the walkthrough limit is 30 minutes.`,
      }, 413);
    }

    // Store the audio track (validated again at transcription time).
    let storedAudioKey = null;
    if (audioChunks.length && !result.audioTruncated) {
      const audioBuf = concat(audioChunks);
      if (audioBuf.length >= 44) {
        storedAudioKey = audioKey;
        await env.PROPOSAL_ASSETS.put(storedAudioKey, audioBuf);
      }
    }

    await env.LEADS_DB.prepare(
      "UPDATE audit_business_reports SET video_r2_key=?, audio_r2_key=?, status_changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?"
    ).bind(videoKey, storedAudioKey, auditId).run();

    // PII-safe log: key + duration + size only, never content.
    console.log(`[audit-business] upload ok audit=${auditId} key=${videoKey} ` +
      `duration_s=${Math.round(dur.seconds)} bytes=${result.videoBytes} audio=${storedAudioKey ? "yes" : "no"}`);

    return json({
      ok: true,
      audit_id: auditId,
      video_key: videoKey,
      duration_s: Math.round(dur.seconds),
      bytes: result.videoBytes,
      audio_stored: !!storedAudioKey,
      audio_truncated: !!result.audioTruncated,
    });
  } catch (e) {
    console.error("audit business upload error", e && e.message);
    return json({ ok: false, error: "upload_failed" }, 500);
  }
}

function concat(chunks) {
  let len = 0;
  for (const c of chunks) len += c.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
