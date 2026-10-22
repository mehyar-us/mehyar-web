// functions/api/_shared/auditTranscribe.js
// Walkthrough-audio transcription for the "Audit My Business" product.
//
// DESIGN DECISION (honest + actually works in a Worker):
//   Workers cannot run ffmpeg, cannot decode AAC, and have ~128MB of memory —
//   so the worker CANNOT extract audio from the buyer's MP4 server-side.
//   Instead the audit page extracts the audio track CLIENT-SIDE (Web Audio
//   API: decodeAudioData on the MP4 -> downsample to 16kHz mono -> WAV) and
//   uploads it as the optional `audio` part of the /upload multipart body.
//   Frontend contract is documented at the top of upload.js.
//
//   This module then:
//     1. Reads the WAV from R2 (cap 64MB), validates the RIFF/WAVE header.
//     2. Slices 16-bit PCM into 25s chunks (Whisper's safe per-call window).
//     3. Runs each chunk through Workers AI Whisper (@cf/openai/whisper —
//        model ID VERIFIED live 2026-10-09 via the REST API) with 4-way
//        parallelism, concatenates the text.
//     4. Caps coverage at the FIRST 10 MINUTES of audio. The report states
//        the coverage window explicitly ("minutes 0:00-10:00").
//   If no audio was uploaded (or it is invalid), the transcript is null and
//   the report's video section says "couldn't be assessed" — never invented.
//
// Transport: Workers AI REST with legacy X-Auth-Email/X-Auth-Key (same as
// llmChat.js). env.AI binding is NOT wired in Pages (no [ai] in
// wrangler.toml), so REST is the only path — and it's the proven one.

const WHISPER_MODEL = "@cf/openai/whisper";
const SAMPLE_RATE = 16000;
const CHUNK_SECONDS = 25;
const CHUNK_SAMPLES = SAMPLE_RATE * CHUNK_SECONDS;
const MAX_CHUNKS = 24; // 24 x 25s = first 10 minutes
const PARALLEL = 4;
const MAX_AUDIO_BYTES = 64 * 1024 * 1024;

function whisperRestUrl(env) {
  const acct = env.CLOUDFLARE_ACCOUNT_ID || "";
  if (!acct) return null;
  return `https://api.cloudflare.com/client/v4/accounts/${acct}/ai/run/${WHISPER_MODEL}`;
}

function whisperHeaders(env) {
  const email = env.CLOUDFLARE_EMAIL || env.CF_EMAIL || "";
  const key = env.CLOUDFLARE_API_KEY || env.CF_API_KEY || env.CLOUDFLARE_GLOBAL_API_KEY || "";
  if (!email || !key) return null;
  return {
    "X-Auth-Email": email,
    "X-Auth-Key": key,
    "User-Agent": "Mozilla/5.0 (compatible; mehyar-audit-transcribe/1.0)",
  };
}

// Validate a 16-bit mono WAV at 16kHz; return PCM byte offset + sample count.
function parseWav(bytes) {
  if (bytes.length < 44) return { ok: false, error: "too_small" };
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  const ascii = (o, n) => String.fromCharCode(...bytes.slice(o, o + n));
  if (ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WAVE") return { ok: false, error: "not_wav" };
  if (ascii(12, 4) !== "fmt ") return { ok: false, error: "no_fmt" };
  const audioFormat = dv.getUint16(20, true);
  const channels = dv.getUint16(22, true);
  const sampleRate = dv.getUint32(24, true);
  const bitsPerSample = dv.getUint16(34, true);
  if (audioFormat !== 1) return { ok: false, error: "not_pcm" };
  if (channels !== 1 || sampleRate !== SAMPLE_RATE || bitsPerSample !== 16) {
    return { ok: false, error: `need_16k_mono_16bit:got_${sampleRate}hz_${channels}ch_${bitsPerSample}bit` };
  }
  // Find the "data" chunk (fmt may be followed by fact/list chunks).
  let o = 12 + 8 + dv.getUint32(16, true);
  while (o + 8 <= bytes.length) {
    const id = ascii(o, 4);
    const size = dv.getUint32(o + 4, true);
    if (id === "data") return { ok: true, dataOffset: o + 8, dataBytes: Math.min(size, bytes.length - o - 8) };
    o += 8 + size + (size % 2);
  }
  return { ok: false, error: "no_data_chunk" };
}

function wavChunkBytes(pcm, chunkIdx) {
  // Re-wrap 25s of raw PCM in a minimal WAV header for the Whisper call.
  const start = chunkIdx * CHUNK_SAMPLES * 2;
  const end = Math.min(pcm.length, start + CHUNK_SAMPLES * 2);
  const body = pcm.slice(start, end);
  const hdr = new ArrayBuffer(44);
  const dv = new DataView(hdr);
  const wstr = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  wstr(0, "RIFF"); dv.setUint32(4, 36 + body.length, true); wstr(8, "WAVE");
  wstr(12, "fmt "); dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, SAMPLE_RATE, true); dv.setUint32(28, SAMPLE_RATE * 2, true);
  dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  wstr(36, "data"); dv.setUint32(40, body.length, true);
  const out = new Uint8Array(44 + body.length);
  out.set(new Uint8Array(hdr), 0);
  out.set(body, 44);
  return out;
}

async function whisperChunk(env, url, headers, wavBytes) {
  const boundary = "----auditwhisper" + Math.random().toString(36).slice(2);
  const enc = new TextEncoder();
  const head = enc.encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="chunk.wav"\r\nContent-Type: audio/wav\r\n\r\n`
  );
  const tail = enc.encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(head.length + wavBytes.length + tail.length);
  body.set(head, 0); body.set(wavBytes, head.length); body.set(tail, head.length + wavBytes.length);
  const resp = await fetch(url, {
    method: "POST",
    headers: { ...headers, "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body,
    signal: AbortSignal.timeout(90000),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`whisper_http_${resp.status}:${t.slice(0, 120)}`);
  }
  const json = await resp.json().catch(() => null);
  if (!json || json.success !== true) {
    throw new Error(`whisper_api_error:${JSON.stringify(json && json.errors).slice(0, 120)}`);
  }
  const text = (json.result && json.result.text) || "";
  return String(text).trim();
}

// transcribeWalkthrough(env, audioBytes) -> { ok, transcript, coverage, chunks, error }
// audioBytes: the 16kHz mono 16-bit WAV uploaded with the video.
export async function transcribeWalkthrough(env, audioBytes) {
  if (!audioBytes || audioBytes.length < 44) {
    return { ok: false, error: "no_audio" };
  }
  const bytes = audioBytes instanceof Uint8Array ? audioBytes : new Uint8Array(audioBytes);
  const wav = parseWav(bytes.slice(0, Math.min(bytes.length, MAX_AUDIO_BYTES)));
  if (!wav.ok) return { ok: false, error: wav.error };

  const url = whisperRestUrl(env);
  const headers = whisperHeaders(env);
  if (!url || !headers) return { ok: false, error: "no_whisper_transport" };

  const pcm = bytes.slice(wav.dataOffset, wav.dataOffset + wav.dataBytes);
  const totalChunks = Math.min(MAX_CHUNKS, Math.ceil(pcm.length / (CHUNK_SAMPLES * 2)));
  if (totalChunks === 0) return { ok: false, error: "empty_audio" };

  const texts = new Array(totalChunks).fill("");
  const errors = [];
  // 4-way parallel batches.
  for (let b = 0; b < totalChunks; b += PARALLEL) {
    const idxs = [];
    for (let i = b; i < Math.min(b + PARALLEL, totalChunks); i++) idxs.push(i);
    const results = await Promise.all(idxs.map(async (i) => {
      try {
        return { i, text: await whisperChunk(env, url, headers, wavChunkBytes(pcm, i)) };
      } catch (e) {
        return { i, text: "", error: String((e && e.message) || e).slice(0, 100) };
      }
    }));
    for (const r of results) {
      texts[r.i] = r.text;
      if (r.error) errors.push(`chunk${r.i}:${r.error}`);
    }
  }

  const coveredSeconds = Math.min(totalChunks * CHUNK_SECONDS, Math.floor(pcm.length / 2 / SAMPLE_RATE));
  const audioSeconds = Math.floor(pcm.length / 2 / SAMPLE_RATE);
  const transcript = texts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim().slice(0, 30000);
  const coverage = audioSeconds <= MAX_CHUNKS * CHUNK_SECONDS
    ? `full audio (${fmtTime(audioSeconds)})`
    : `first ${fmtTime(MAX_CHUNKS * CHUNK_SECONDS)} of ${fmtTime(audioSeconds)}`;

  return {
    ok: true,
    transcript: transcript || null,
    empty: !transcript,
    coverage,
    chunks: totalChunks,
    chunkErrors: errors.slice(0, 8),
    audioSeconds,
    coveredSeconds,
  };
}

function fmtTime(s) {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

// Exported for unit tests.
export { parseWav, wavChunkBytes, WHISPER_MODEL, CHUNK_SECONDS, MAX_CHUNKS };
