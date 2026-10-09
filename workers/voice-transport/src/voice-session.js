// workers/voice-transport/src/voice-session.js — VoiceSession Durable Object.
//
// One DO per call. Owns the browser WebSocket, the Workers AI realtime
// sockets (flux WS streaming STT, aura-1 WS streaming TTS), endpointing
// (energy VAD + smart-turn-v2 async confirmation), barge-in, the 45-min cap,
// per-call usage and per-turn timings.
//
// Wire protocol (browser <-> DO), single WebSocket:
//   Browser -> DO : JSON control frames + binary PCM16 16kHz mono mic audio.
//     {t:"start-listen"}            -> DO opens flux WS, replies {t:"listening"}
//     {t:"stop-listen"}             -> DO closes flux WS, replies {t:"stopped"}
//     {t:"speak", id, text}         -> DO synthesizes, streams binary audio back,
//                                      then {t:"speak-end", id, cached}
//     {t:"cancel-speak", id}        -> DO aborts TTS, clears queue
//     {t:"get-usage", req}         -> DO replies {t:"usage", req, usage}
//     binary                        PCM16 LE 16kHz mono mic frames (any chunk size)
//   DO -> browser : JSON control frames + binary PCM16 16kHz mono TTS audio.
//     {t:"listening"} / {t:"stopped"}
//     {t:"transcript", text, isFinal, timing:{sttMs}}
//     {t:"bargein"}
//     {t:"speak-end", id, cached}
//     {t:"usage", req?, usage:{stt:{model,audioMinutes,neurons},
//                             tts:{model,chars,cachedChars,neurons},
//                             turn:{model,audioMinutes,neurons}}}
//     {t:"ended", reason}           reason: hangup|remote|timeout|network
//     {t:"error", message, code}    code: stt-failed|tts-failed|ws-failed|auth
//     binary                        PCM16 LE 16kHz mono TTS chunks
//
// Validated 2026-10-09 (live, from inside this DO):
//   flux WS:  env.AI.run("@cf/deepgram/flux", {sample_rate:"16000"},
//             {websocket:true}) -> Response.webSocket -> accept() ->
//             binary PCM in, TurnInfo JSON out (interim + word timings).
//   aura-1 WS: env.AI.run("@cf/deepgram/aura-1",
//             {sample_rate:"16000", speaker:"asteria"}, {websocket:true}) ->
//             send {type:"Speak",text}+{type:"Flush"} per utterance ->
//             PCM16 16kHz binary chunks; server closes after Flushed.
//   smart-turn-v2: env.AI.run(model, {audio:{body:stream,
//             contentType:"application/octet-stream"}}) (WAV-wrapped PCM)
//             -> {is_complete, probability}.
//   aura-1 REST: {text, speaker, encoding:"linear16", sample_rate:16000,
//             container:"none"} -> raw PCM16 (used by precache).
//
// Privacy: no raw audio is persisted anywhere. Utterance buffers live in
// DO memory only and are released after the turn. The KV TTS cache holds
// only synthesized AGENT speech keyed by text hash — never caller audio.

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });

// Frozen usage rates (docs/voice-adapter-answers.md §11).
// ttsPerKChar tracks the configured TTS model (aura-2-en default: 2727.27;
// aura-1 fallback: 1363.64).
const NEURON = {
  sttPerMin: 700, // flux WebSocket
  ttsPerKChar: 2727.27, // aura-2-en
  turnPerMin: 0.51, // smart-turn-v2
};

// VAD tuning (30ms frames @16kHz = 480 samples).
const VAD_FRAME = 480;
const VAD_SPEECH_RMS = 0.02;
const VAD_MIN_SPEECH_MS = 300;
const VAD_HANGOVER_MS = 320; // silence -> utterance end
const MAX_UTTERANCE_MS = 30000;
// Barge-in: ignore interims for this long after TTS starts (speaker onset).
const BARGE_IN_GRACE_MS = 500;

export class VoiceSession {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.reset();
  }

  reset() {
    this.browserWs = null;
    this.fluxWs = null;
    this.ttsWs = null; // warm socket, opened speculatively
    this.listening = false;
    this.sessionId = null;
    this.testMode = false;
    this.vad = { inSpeech: false, silenceMs: 0, speechMs: 0, startAt: 0 };
    this.utterBuf = []; // Int16Array chunks of the current utterance
    this.utterSamples = 0;
    this.lastInterim = { text: "", at: 0 };
    this.emittedPrefix = ""; // flux transcript text already emitted (flux turns
                             // span multiple utterances; we diff per utterance)
    this.speechEndAt = 0;
    this.ttsPlaying = false;
    this.ttsStartAt = 0;
    this.ttsQueue = [];
    this.ttsBusy = false;
    this.currentSpeakId = null;
    this.currentSpeakText = "";
    this.ttsAccum = [];
    this.usage = { sttSec: 0, ttsCharsFresh: 0, ttsCharsCached: 0, turnSec: 0 };
    this.bargeinCount = 0; // per call (browser tracks per-turn)
    this.capTimer = null;
    this.ended = false;
  }

  // ── HTTP routes ────────────────────────────────────────────────────

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/probe" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      return json(await this.probeRealtime(body));
    }
    if (url.pathname === "/admin-precache" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      return json(await this.precache(body.texts));
    }
    if (url.pathname === "/voice") {
      return this.handleVoice(request);
    }
    return json({ ok: false, error: "unknown DO route" }, 404);
  }

  // ── session auth ───────────────────────────────────────────────────

  async validateSession(sessionId) {
    if (!sessionId || !/^[0-9a-f]{32}$/.test(sessionId))
      return { ok: false, reason: "bad session id format" };
    // Validation bypass for transport testing (secret, never shipped to clients).
    if (this.env.VALIDATION_SESSION && sessionId === this.env.VALIDATION_SESSION)
      return { ok: true, secondsRemaining: 2700, testMode: true };
    try {
      const res = await fetch(`${this.env.VOICE_AUTH_ORIGIN}/api/assessment-call/heartbeat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data && data.ok !== false && data.secondsRemaining > 0)
        return { ok: true, secondsRemaining: data.secondsRemaining, testMode: false };
      return { ok: false, reason: "session not active" };
    } catch (e) {
      return { ok: false, reason: `auth check failed: ${e.message}` };
    }
  }

  async handleVoice(request) {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get("session") || "";
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket")
      return json({ ok: false, error: "websocket required" }, 426);

    const gate = await this.validateSession(sessionId);
    if (!gate.ok) {
      // 4401: the transport surfaces error {code:'auth'}.
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      server.accept();
      server.close(4401, gate.reason || "unauthorized");
      return new Response(null, { status: 101, webSocket: client });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.attachBrowser(server, {
      sessionId,
      secondsRemaining: gate.secondsRemaining,
      testMode: gate.testMode,
    });
    return new Response(null, { status: 101, webSocket: client });
  }

  // ── browser socket ─────────────────────────────────────────────────

  attachBrowser(ws, { sessionId, secondsRemaining, testMode }) {
    this.reset();
    this.sessionId = sessionId;
    this.testMode = !!testMode;
    this.browserWs = ws;
    ws.accept();

    // 45-min cap (server-side; the shell enforces it client-side too).
    const capMs = Math.max(1000, Math.min(secondsRemaining, 2700) * 1000);
    this.capTimer = setTimeout(() => this.endCall("timeout"), capMs);
    // Keep exactly one warm TTS socket: refresh when idle >8s so a speak
    // never waits on a handshake (saves ~200ms of ttsMs variance).
    this.ttsRefreshTimer = setInterval(() => {
      if (this.ended || this.ttsBusy) return;
      const age = this.ttsWsAt ? Date.now() - this.ttsWsAt : Infinity;
      if (age > 8000 || !this.ttsWs) this.warmTts();
    }, 5000);

    ws.addEventListener("message", (ev) => {
      try {
        if (typeof ev.data === "string") this.onControl(JSON.parse(ev.data));
        else this.onMicAudio(ev.data);
      } catch (e) {
        this.send({ t: "error", message: `bad frame: ${e.message}`, code: "ws-failed" });
      }
    });
    const onClose = () => this.cleanup();
    ws.addEventListener("close", onClose);
    ws.addEventListener("error", onClose);
  }

  send(obj) {
    try {
      this.browserWs && this.browserWs.send(JSON.stringify(obj));
    } catch {}
  }

  sendBinary(u8) {
    try {
      this.browserWs && this.browserWs.send(u8);
    } catch {}
  }

  onControl(msg) {
    if (this.ended) return;
    switch (msg.t) {
      case "start-listen":
        this.startListen();
        break;
      case "stop-listen":
        this.stopListen();
        this.send({ t: "stopped" });
        break;
      case "speak":
        this.enqueueSpeak(msg.id, String(msg.text || ""));
        break;
      case "cancel-speak":
        this.abortTts();
        break;
      case "get-usage":
        this.send({ t: "usage", req: msg.req || null, usage: this.usageReport() });
        break;
      case "hangup":
        this.endCall("hangup");
        break;
      case "ping":
        this.send({ t: "pong" });
        break;
      default:
        break;
    }
  }

  // ── STT: flux streaming ────────────────────────────────────────────

  async openAiWs(model, params) {
    const res = await this.env.AI.run(model, params, { websocket: true });
    const ws = res && res.webSocket ? res.webSocket : null;
    if (!ws) throw new Error(`${model}: no webSocket in ai.run response`);
    ws.accept();
    return ws;
  }

  async startListen() {
    if (this.listening) {
      this.send({ t: "listening" });
      return;
    }
    try {
      this.fluxWs = await this.openAiWs(this.env.STT_MODEL || "@cf/deepgram/flux", {
        sample_rate: "16000",
      });
    } catch (e) {
      this.send({ t: "error", message: `STT unavailable: ${e.message}`, code: "stt-failed" });
      return;
    }
    this.fluxWs.addEventListener("message", (ev) => {
      if (typeof ev.data !== "string") return;
      try {
        this.onFluxMessage(JSON.parse(ev.data));
      } catch {}
    });
    this.fluxWs.addEventListener("close", () => {
      if (this.listening && !this.ended) {
        // One reopen attempt; then surface the failure.
        this.fluxWs = null;
        this.reopenFlux().catch(() =>
          this.send({ t: "error", message: "STT stream dropped", code: "stt-failed" })
        );
      }
    });
    this.listening = true;
    this.send({ t: "listening" });
  }

  async reopenFlux() {
    this.fluxWs = await this.openAiWs(this.env.STT_MODEL || "@cf/deepgram/flux", {
      sample_rate: "16000",
    });
    this.fluxWs.addEventListener("message", (ev) => {
      if (typeof ev.data !== "string") return;
      try {
        this.onFluxMessage(JSON.parse(ev.data));
      } catch {}
    });
  }

  stopListen() {
    this.listening = false;
    try {
      this.fluxWs && this.fluxWs.close(1000, "stop-listen");
    } catch {}
    this.fluxWs = null;
    this.flushUtterance(true);
  }

  onMicAudio(data) {
    if (!this.listening || !this.fluxWs || this.ended) return;
    // Binary may arrive as ArrayBuffer, a view, or a Blob (binaryType).
    if (data && typeof data.arrayBuffer === "function" && !(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data)) {
      data.arrayBuffer().then((ab) => this.onMicAudio(ab)).catch(() => {});
      return;
    }
    let bytes;
    if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
    else if (ArrayBuffer.isView(data)) bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    else return;
    if (bytes.length === 0 || bytes.length % 2 !== 0) return;
    try {
      this.fluxWs.send(bytes);
    } catch {
      return;
    }
    this.usage.sttSec += bytes.length / 2 / 16000;
    this.vadProcess(bytes);
  }

  vadProcess(bytes) {
    const n = bytes.length / 2;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    this.vad.lastFrameAt = Date.now();
    // 30ms frames.
    for (let off = 0; off + VAD_FRAME * 2 <= bytes.length; off += VAD_FRAME * 2) {
      let sum = 0;
      for (let i = 0; i < VAD_FRAME; i++) {
        const s = view.getInt16(off + i * 2, true) / 32768;
        sum += s * s;
      }
      const rms = Math.sqrt(sum / VAD_FRAME);
      const speech = rms >= VAD_SPEECH_RMS;
      if (speech) {
        if (!this.vad.inSpeech) {
          this.vad.inSpeech = true;
          this.vad.speechMs = 0;
          this.vad.startAt = Date.now();
          this.utterBuf = [];
          this.utterSamples = 0;
          this.ensureVadWatchdog();
          // Speculative TTS warm-up: a reply is coming; overlap the
          // socket handshake with the caller's utterance.
          this.warmTts();
        }
        this.vad.speechMs += 30;
        this.vad.silenceMs = 0;
      } else if (this.vad.inSpeech) {
        this.vad.silenceMs += 30;
        if (this.vad.silenceMs >= VAD_HANGOVER_MS && this.vad.speechMs >= VAD_MIN_SPEECH_MS) {
          this.speechEndAt = Date.now() - this.vad.silenceMs;
          this.vad.inSpeech = false;
          this.onUtteranceEnd();
        } else if (this.vad.silenceMs >= 3000) {
          // Long silence without min speech: reset (noise blip).
          this.vad.inSpeech = false;
          this.utterBuf = [];
          this.utterSamples = 0;
        }
      }
    }
    // Keep utterance audio (cap at MAX_UTTERANCE_MS).
    if (this.vad.inSpeech || this.utterBuf.length) {
      const maxSamples = (MAX_UTTERANCE_MS / 1000) * 16000;
      if (this.utterSamples < maxSamples) {
        const copy = new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
        const room = maxSamples - this.utterSamples;
        this.utterBuf.push(room >= copy.length ? copy : copy.subarray(0, room));
        this.utterSamples += Math.min(room, copy.length);
        if (this.utterSamples >= maxSamples && this.vad.inSpeech) {
          this.speechEndAt = Date.now();
          this.vad.inSpeech = false;
          this.onUtteranceEnd();
        }
      }
    }
  }

  // Watchdog: if mic frames stop arriving mid-utterance (network gap, or a
  // test client that only sends speech), silence must still be detected.
  ensureVadWatchdog() {
    if (this.vadWatchdog || this.ended) return;
    this.vadWatchdog = setInterval(() => {
      if (this.ended) {
        clearInterval(this.vadWatchdog);
        this.vadWatchdog = null;
        return;
      }
      if (
        this.vad.inSpeech &&
        this.vad.speechMs >= VAD_MIN_SPEECH_MS &&
        Date.now() - (this.vad.lastFrameAt || 0) >= VAD_HANGOVER_MS
      ) {
        this.speechEndAt = this.vad.lastFrameAt || Date.now();
        this.vad.inSpeech = false;
        this.onUtteranceEnd();
      }
    }, 50);
  }

  onFluxMessage(msg) {
    if (!msg || msg.type === "Connected") return;
    if (msg.type !== "TurnInfo") return;
    const text = String(msg.transcript || "");
    const words = Array.isArray(msg.words) ? msg.words : [];
    if (text) this.lastInterim = { text, at: Date.now() };
    // Barge-in: live words while our TTS is playing (past the onset grace).
    // Echo guard: if the interim matches what WE are saying (speaker echo
    // leaking through echoCancellation), it is not the caller interrupting.
    if (
      this.ttsPlaying &&
      words.length > 0 &&
      this.vad.inSpeech &&
      Date.now() - this.ttsStartAt > BARGE_IN_GRACE_MS &&
      !this.isEcho(text)
    ) {
      this.bargeinCount++;
      this.abortTts();
      this.send({ t: "bargein", count: this.bargeinCount });
    }
  }

  isEcho(interimText) {
    const norm = (s) =>
      String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
    const agent = norm(this.currentSpeakText);
    const interim = norm(interimText);
    if (!agent || !interim || interim.length < 4) return false;
    return agent.includes(interim) || interim.includes(agent);
  }

  onUtteranceEnd() {
    const full = (this.lastInterim.text || "").trim();
    // Flux turns accumulate across utterances: emit only the NEW words.
    // If flux revised earlier text (rare after the hangover), fall back to
    // the full text rather than emitting nothing.
    let text = full;
    if (full.startsWith(this.emittedPrefix)) {
      text = full.slice(this.emittedPrefix.length).trim();
    }
    this.emittedPrefix = full;
    const sttMs = this.speechEndAt ? Math.max(0, Date.now() - this.speechEndAt) : 0;
    // Snapshot utterance audio for the async turn-confirm (memory only).
    const utterWav = this.utterBuf.length ? this.wavWrap(this.concatInt16(this.utterBuf)) : null;
    this.utterBuf = [];
    this.utterSamples = 0;
    if (text) {
      this.send({ t: "transcript", text, isFinal: true, timing: { sttMs } });
      // Speculative TTS warm-up: the adapter is about to call speak()
      // (brain round-trip), so open the socket now to overlap the handshake.
      this.warmTts().catch(() => {});
    }
    if (utterWav) this.confirmTurnAsync(utterWav).catch(() => {});
  }

  flushUtterance(silent) {
    if (this.vad.inSpeech && this.vad.speechMs >= VAD_MIN_SPEECH_MS) {
      this.speechEndAt = Date.now();
      this.vad.inSpeech = false;
      if (!silent) this.onUtteranceEnd();
    }
    this.utterBuf = [];
    this.utterSamples = 0;
  }

  concatInt16(chunks) {
    let n = 0;
    for (const c of chunks) n += c.length;
    const out = new Int16Array(n);
    let o = 0;
    for (const c of chunks) {
      out.set(c, o);
      o += c.length;
    }
    return out;
  }

  wavWrap(pcm) {
    const n = pcm.length * 2;
    const buf = new ArrayBuffer(44 + n);
    const v = new DataView(buf);
    const wstr = (o, s) => {
      for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
    };
    wstr(0, "RIFF");
    v.setUint32(4, 36 + n, true);
    wstr(8, "WAVE");
    wstr(12, "fmt ");
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, 16000, true);
    v.setUint32(28, 32000, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    wstr(36, "data");
    v.setUint32(40, n, true);
    new Int16Array(buf, 44).set(pcm);
    return buf;
  }

  // Async turn confirmation (diagnostic + usage; NOT gating the transcript).
  async confirmTurnAsync(wavBuf) {
    const sec = wavBuf.byteLength / 32000;
    try {
      const out = await this.env.AI.run(this.env.TURN_MODEL || "@cf/pipecat-ai/smart-turn-v2", {
        audio: {
          body: new ReadableStream({ start: (c) => { c.enqueue(new Uint8Array(wavBuf)); c.close(); } }),
          contentType: "application/octet-stream",
        },
      });
      this.usage.turnSec += sec;
      if (this.state && this.state.waitUntil) {
        // no-op: keeps the DO alive pattern explicit
      }
      return out;
    } catch {
      return null;
    }
  }

  // ── TTS: aura-1 streaming ──────────────────────────────────────────

  ttsKey(text) {
    return `tts:v1:${this.env.TTS_VOICE || "asteria"}:${this.env.TTS_MODEL || "@cf/deepgram/aura-2-en"}:${text}`;
  }

  async sha256Hex(s) {
    const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // Warm (speculative) TTS socket. Opened when the caller STARTS speaking so
  // the ~400ms handshake overlaps their utterance + the brain round-trip.
  // Returns a promise for the in-flight open; concurrent callers share it.
  warmTts() {
    if (this.ended) return Promise.resolve();
    const TTS_WARM_MAX_AGE_MS = 15000;
    const fresh =
      this.ttsWs && Date.now() - (this.ttsWsAt || 0) <= TTS_WARM_MAX_AGE_MS;
    if (fresh) return Promise.resolve();
    if (this.ttsWarmPromise) return this.ttsWarmPromise;
    // Recycle stale/missing socket. Idle server-side closes leave half-open
    // sockets that would hang a speak; the first-audio timeout + retry is the
    // backstop for anything this misses.
    try {
      if (this.ttsWs) this.ttsWs.close(1000, "stale");
    } catch {}
    this.ttsWs = null;
    this.ttsWarmPromise = (async () => {
      try {
        const ws = await this.openAiWs(this.env.TTS_MODEL || "@cf/deepgram/aura-2-en", {
          sample_rate: "16000",
          speaker: this.env.TTS_VOICE || "asteria",
        });
        if (this.ended) {
          try { ws.close(1000, "ended"); } catch {}
          return;
        }
        this.ttsWs = ws;
        this.ttsWsAt = Date.now();
        ws.addEventListener("close", () => {
          // Expected: the server closes after each Flushed. Unexpected
          // mid-speak closes are surfaced by the speak pump.
          if (this.ttsWs === ws) this.ttsWs = null;
        });
        ws.addEventListener("error", () => {
          if (this.ttsBusy && this.currentSpeakId)
            this.send({ t: "error", message: "TTS stream failed", code: "tts-failed", speakId: this.currentSpeakId });
          try { ws.close(); } catch {}
          if (this.ttsWs === ws) this.ttsWs = null;
          this.ttsBusy = false;
        });
      } catch {
        this.ttsWs = null;
      } finally {
        this.ttsWarmPromise = null;
      }
    })();
    return this.ttsWarmPromise;
  }

  enqueueSpeak(id, text) {
    const clean = text.trim().slice(0, 2000);
    if (!clean) {
      this.send({ t: "speak-end", id, cached: false, empty: true });
      return;
    }
    this.ttsQueue.push({ id, text: clean });
    this.pumpTts().catch((e) =>
      this.send({ t: "error", message: `TTS failed: ${e.message}`, code: "tts-failed", speakId: id })
    );
  }

  async pumpTts() {
    if (this.ttsBusy || this.ended) return;
    const job = this.ttsQueue.shift();
    if (!job) return;
    this.ttsBusy = true;
    this.currentSpeakId = job.id;
    this.currentSpeakText = job.text; // for the barge-in echo guard
    const ttsJobStart = Date.now();
    const serverTiming = {};

    // 1) KV cache (static lines: $0 marginal, ~instant) AND socket warm-up
    // run in parallel — neither blocks the other.
    try {
      const key = `tts:v1:${await this.sha256Hex(this.ttsKey(job.text))}`;
      const cacheStart = Date.now();
      const cacheP = this.env.TTS_CACHE.get(key, "arrayBuffer");
      const warmP = this.warmTts();
      const cached = await cacheP;
      serverTiming.cacheMs = Date.now() - cacheStart;
      await warmP;
      if (cached && cached.byteLength > 0) {
        this.usage.ttsCharsCached += job.text.length;
        this.streamToBrowser(new Uint8Array(cached), job.id);
        this.send({ t: "speak-end", id: job.id, cached: true, serverTiming });
        this.ttsBusy = false;
        this.currentSpeakId = null;
        this.currentSpeakText = "";
        this.pumpTts().catch(() => {});
        return;
      }
      // 2) Fresh synthesis on the warmed socket (recycled above if stale).
      const warmStart = Date.now();
      await this.warmTts();
      serverTiming.warmMs = Date.now() - warmStart;
      serverTiming.socketAgeMs = this.ttsWsAt ? Date.now() - this.ttsWsAt : -1;
      if (!this.ttsWs) throw new Error("TTS socket unavailable");
      this.usage.ttsCharsFresh += job.text.length;
      this.ttsAccum = [];
      this.ttsPlaying = true;
      this.ttsStartAt = Date.now();
      const cacheKey = key;
      const speakStart = Date.now();
      let firstAudioAt = 0;
      await new Promise((resolve, reject) => {
        const ws = this.ttsWs;
        let settled = false;
        const done = (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(firstAudioTimer);
          this.ttsPlaying = false;
          if (!err) {
            const bytes = this.concatBytes(this.ttsAccum);
            if (bytes.length > 0 && this.state.waitUntil) {
              this.state.waitUntil(
                this.env.TTS_CACHE.put(cacheKey, bytes, { expirationTtl: 30 * 86400 }).catch(() => {})
              );
            }
          }
          err ? reject(err) : resolve();
        };
        // Fail fast instead of hanging on a half-open socket.
        const firstAudioTimer = setTimeout(() => {
          if (!firstAudioAt) {
            cleanup();
            done(new Error("TTS first-audio timeout"));
          }
        }, 5000);
        const onMessage = (ev) => {
          if (typeof ev.data === "string") {
            try {
              const m = JSON.parse(ev.data);
              if (m.type === "Flushed") {
                cleanup();
                done(null);
              }
            } catch {}
            return;
          }
          const handleBin = (binData) => {
            let u8;
            if (binData instanceof ArrayBuffer) u8 = new Uint8Array(binData);
            else if (ArrayBuffer.isView(binData))
              u8 = new Uint8Array(binData.buffer, binData.byteOffset, binData.byteLength);
            else return;
            if (u8.length === 0) return;
            if (!firstAudioAt) firstAudioAt = Date.now();
            this.ttsAccum.push(u8);
            this.streamToBrowser(u8, job.id);
          };
          if (ev.data && typeof ev.data.arrayBuffer === "function" &&
              !(ev.data instanceof ArrayBuffer) && !ArrayBuffer.isView(ev.data)) {
            ev.data.arrayBuffer().then(handleBin).catch(() => {});
            return;
          }
          handleBin(ev.data);
        };
        const onClose = () => {
          cleanup();
          // Server closes after Flushed (expected); anything else mid-speak
          // with no audio yet is a failure.
          if (this.ttsAccum.length === 0) done(new Error("TTS closed before audio"));
          else done(null);
        };
        const onError = () => {
          cleanup();
          done(new Error("TTS stream error"));
        };
        const cleanup = () => {
          ws.removeEventListener("message", onMessage);
          ws.removeEventListener("close", onClose);
          ws.removeEventListener("error", onError);
        };
        ws.addEventListener("message", onMessage);
        ws.addEventListener("close", onClose);
        ws.addEventListener("error", onError);
        // Abort hook: barge-in / cancel-speak closes this socket; the
        // pump detects it via ttsWs being nulled.
        this.ttsAbort = () => {
          cleanup();
          try { ws.close(1000, "aborted"); } catch {}
          done(new Error("aborted"));
        };
        try {
          ws.send(JSON.stringify({ type: "Speak", text: job.text }));
          ws.send(JSON.stringify({ type: "Flush" }));
        } catch (e) {
          cleanup();
          done(e);
        }
      });
      this.send({
        t: "speak-end",
        id: job.id,
        cached: false,
        serverTiming: {
          ...serverTiming,
          speakMs: Date.now() - speakStart,
          firstAudioMs: firstAudioAt ? firstAudioAt - speakStart : -1,
        },
      });
    } catch (e) {
      if (e && e.message !== "aborted")
        this.send({ t: "error", message: `TTS failed: ${e.message}`, code: "tts-failed", speakId: job.id });
    } finally {
      this.ttsBusy = false;
      this.currentSpeakId = null;
      this.currentSpeakText = "";
      this.ttsWs = null; // server closes after each Flush; the refresh
                         // interval re-warms in the background
      this.ttsAbort = null;
      this.pumpTts().catch(() => {});
    }
  }

  concatBytes(chunks) {
    let n = 0;
    for (const c of chunks) n += c.length;
    const out = new Uint8Array(n);
    let o = 0;
    for (const c of chunks) {
      out.set(c, o);
      o += c.length;
    }
    return out;
  }

  streamToBrowser(u8, speakId) {
    // Forward PCM16 chunks to the browser for immediate playback.
    // Generation guard: after an abort, the (closing) socket may still
    // deliver buffered chunks — never forward those.
    if (speakId !== this.currentSpeakId) {
      if (this.env.TTS_DEBUG === "1") console.log(`streamToBrowser: dropping stale chunk for ${speakId} (current=${this.currentSpeakId})`);
      return;
    }
    this.sendBinary(u8);
  }

  abortTts() {
    // Barge-in / cancel-speak: stop synthesis and drop the queue.
    if (this.env.TTS_DEBUG === "1") console.log(`abortTts: busy=${this.ttsBusy} hasAbort=${!!this.ttsAbort} queue=${this.ttsQueue.length}`);
    this.ttsQueue = [];
    this.ttsPlaying = false;
    try {
      if (this.ttsAbort) this.ttsAbort();
      else if (this.ttsWs) this.ttsWs.close(1000, "aborted");
    } catch {}
    this.ttsWs = null;
    this.ttsBusy = false;
    this.currentSpeakId = null;
    this.currentSpeakText = "";
  }

  // ── usage / lifecycle ──────────────────────────────────────────────

  usageReport() {
    const sttMin = this.usage.sttSec / 60;
    const turnMin = this.usage.turnSec / 60;
    const ttsK = this.usage.ttsCharsFresh / 1000;
    return {
      stt: {
        model: this.env.STT_MODEL || "@cf/deepgram/flux",
        audioMinutes: Math.round(sttMin * 100) / 100,
        neurons: Math.round(sttMin * NEURON.sttPerMin * 100) / 100,
      },
      tts: {
        model: this.env.TTS_MODEL || "@cf/deepgram/aura-2-en",
        chars: this.usage.ttsCharsFresh,
        cachedChars: this.usage.ttsCharsCached,
        neurons: Math.round(ttsK * NEURON.ttsPerKChar * 100) / 100,
      },
      turn: {
        model: this.env.TURN_MODEL || "@cf/pipecat-ai/smart-turn-v2",
        audioMinutes: Math.round(turnMin * 100) / 100,
        neurons: Math.round(turnMin * NEURON.turnPerMin * 100) / 100,
      },
    };
  }

  endCall(reason) {
    if (this.ended) return;
    this.ended = true;
    try {
      this.send({ t: "usage", usage: this.usageReport() });
      this.send({ t: "ended", reason });
    } catch {}
    this.cleanup();
  }

  cleanup() {
    if (this.capTimer) clearTimeout(this.capTimer);
    this.capTimer = null;
    if (this.ttsRefreshTimer) clearInterval(this.ttsRefreshTimer);
    this.ttsRefreshTimer = null;
    if (this.vadWatchdog) clearInterval(this.vadWatchdog);
    this.vadWatchdog = null;
    this.listening = false;
    for (const ws of [this.fluxWs, this.ttsWs, this.browserWs]) {
      try {
        ws && ws.close(1000, "cleanup");
      } catch {}
    }
    this.fluxWs = this.ttsWs = this.browserWs = null;
    this.utterBuf = [];
  }

  // ── precache (admin) ───────────────────────────────────────────────

  async precache(texts) {
    if (!Array.isArray(texts) || !texts.length)
      return { ok: false, error: "texts[] required" };
    const out = { ok: true, cached: 0, synthesized: 0, failed: [] };
    for (const raw of texts.slice(0, 50)) {
      const text = String(raw || "").trim().slice(0, 2000);
      if (!text) continue;
      try {
        const key = `tts:v1:${await this.sha256Hex(this.ttsKey(text))}`;
        const hit = await this.env.TTS_CACHE.get(key, "arrayBuffer");
        if (hit && hit.byteLength > 0) {
          out.cached++;
          continue;
        }
        // One-shot REST synthesis (no streaming needed for precache).
        const resp = await this.env.AI.run(this.env.TTS_MODEL || "@cf/deepgram/aura-2-en", {
          text,
          speaker: this.env.TTS_VOICE || "asteria",
          encoding: "linear16",
          sample_rate: 16000,
          container: "none",
        }, { returnRawResponse: true });
        const buf = new Uint8Array(await resp.arrayBuffer());
        if (buf.length > 0) {
          await this.env.TTS_CACHE.put(key, buf, { expirationTtl: 30 * 86400 });
          out.synthesized++;
        } else {
          out.failed.push(text.slice(0, 40));
        }
      } catch (e) {
        out.failed.push(`${text.slice(0, 40)}: ${e.message}`);
      }
    }
    return out;
  }

  // ── Phase-1 handshake probe (kept for future validation) ──────────

  async probeRealtime({ model, params = {}, send = [], listenMs = 5000, saveBinary = false } = {}) {
    const report = { ok: false, model, stages: [], messages: [], error: null };
    if (!model) {
      report.error = "model required";
      return report;
    }
    let ws;
    try {
      report.stages.push("ai.run:start");
      ws = await this.env.AI.run(model, params, { websocket: true });
      report.stages.push("ai.run:returned");
    } catch (e) {
      report.stages.push("ai.run:threw");
      report.error = `ai.run threw: ${e && e.message ? e.message : String(e)}`;
      return report;
    }
    report.returnType = Object.prototype.toString.call(ws);
    if (report.returnType === "[object Response]" && ws.webSocket) {
      report.stages.push("response.webSocket:present");
      ws = ws.webSocket;
      try {
        ws.accept();
        report.stages.push("ws.accept:ok");
      } catch (e) {
        report.stages.push(`ws.accept:threw:${e.message}`);
      }
      report.returnType = Object.prototype.toString.call(ws) + " (via response.webSocket)";
    }
    if (report.returnType === "[object Response]") {
      try {
        report.respStatus = ws.status;
        report.respHeaders = {};
        for (const [k, v] of ws.headers.entries()) {
          if (k.toLowerCase().startsWith("cf-") || k.toLowerCase() === "content-type")
            report.respHeaders[k] = v;
        }
        const reader = ws.body.getReader();
        const chunks = [];
        const deadline = Date.now() + 4000;
        while (Date.now() < deadline) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(Buffer.from(value).toString("utf8").slice(0, 500));
          if (chunks.join("").length > 1500) break;
        }
        try { reader.cancel(); } catch {}
        report.respBodyPreview = chunks.join("").slice(0, 1500);
        report.stages.push("response:body-inspected");
      } catch (e) {
        report.respInspectError = e.message;
      }
    }
    report.hasSend = typeof ws?.send === "function";
    report.hasClose = typeof ws?.close === "function";
    try {
      report.readyState = ws.readyState;
    } catch (e) {
      report.readyState = `unreadable: ${e.message}`;
    }
    if (typeof ws?.send !== "function") {
      report.error = "ai.run did not return a WebSocket-like object";
      try { ws && ws.close && ws.close(); } catch {}
      return report;
    }

    const t0 = Date.now();
    const events = [];
    await new Promise((resolve) => {
      let done = false;
      const finish = (why) => {
        if (done) return;
        done = true;
        events.push({ t: "finish", atMs: Date.now() - t0, why });
        resolve();
      };
      try {
        ws.onopen = () => events.push({ t: "open", atMs: Date.now() - t0 });
        ws.onmessage = (ev) => {
          let data = ev.data;
          if (typeof data !== "string") {
            try {
              const n = data.byteLength ?? data.size ?? -1;
              if (saveBinary) {
                const ab = data.arrayBuffer ? data.arrayBuffer() : data;
                Promise.resolve(ab).then((b) => {
                  const u8 = new Uint8Array(b);
                  let s = "";
                  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
                  events.push({ t: "message", atMs: Date.now() - t0, binaryB64: btoa(s), binaryBytes: n });
                }).catch(() => events.push({ t: "message", atMs: Date.now() - t0, data: `<binary ${n} bytes>` }));
                return;
              }
              data = `<binary ${n} bytes>`;
            } catch {
              data = "<binary>";
            }
          } else if (data.length > 2000) {
            data = data.slice(0, 2000) + `…<${data.length} chars>`;
          }
          events.push({ t: "message", atMs: Date.now() - t0, data });
        };
        ws.onerror = (ev) => {
          let detail = "";
          try { detail = ev.message || JSON.stringify(ev); } catch { detail = String(ev); }
          events.push({ t: "error", atMs: Date.now() - t0, detail });
        };
        ws.onclose = (ev) =>
          events.push({ t: "close", atMs: Date.now() - t0, code: ev.code, reason: String(ev.reason || "").slice(0, 300) });
      } catch (e) {
        events.push({ t: "handler-attach-failed", detail: e.message });
      }
      (async () => {
        for (const step of send) {
          await new Promise((r) => setTimeout(r, Math.max(0, step.waitMs || 0)));
          if (done) break;
          try {
            if (step.json !== undefined) {
              const s = JSON.stringify(step.json);
              ws.send(s);
              events.push({ t: "sent", atMs: Date.now() - t0, kind: "json", bytes: s.length });
            } else if (step.bytes) {
              const buf = Uint8Array.from(Buffer.from(step.bytes, "base64"));
              ws.send(buf);
              events.push({ t: "sent", atMs: Date.now() - t0, kind: "binary", bytes: buf.length });
            }
          } catch (e) {
            events.push({ t: "send-failed", atMs: Date.now() - t0, detail: e.message });
          }
        }
      })();
      setTimeout(() => finish("listen-timeout"), Math.max(500, listenMs));
    });

    try { ws.close(1000, "probe done"); } catch {}
    report.messages = events;
    const sawOpen = events.some((e) => e.t === "open");
    const sawMessage = events.some((e) => e.t === "message");
    report.ok = sawOpen || sawMessage;
    if (!report.ok && !report.error) {
      const closeEv = events.find((e) => e.t === "close");
      report.error = closeEv
        ? `no open/message; closed code=${closeEv.code} reason=${closeEv.reason}`
        : "no open/message within listen window";
    }
    return report;
  }
}
