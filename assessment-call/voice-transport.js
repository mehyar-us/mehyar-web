// assessment-call/voice-transport.js — VENDORED COPY (do not edit here).
// Source of truth: client/src/lib/assessment-call/voice-transport.js (voice track owns it).
// Vendored 2026-10-09 (full-QA fix F1) so the standalone /assessment-call/ page ships
// the real browser voice transport instead of the silent stub. Re-vendor on upstream change.

// Usage (FROZEN shape, §11): getUsage() returns the latest {t:"usage"} frame cached
// from the server, or the zeros shape before any arrives.
//
// Audio privacy: memory only — no audio is persisted anywhere. No third-party scripts.
// No PSTN/Telnyx anywhere in this path.

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

const DEFAULT_VOICE_HOST = "voice-transport.mehyar.workers.dev";
const FRAME_SAMPLES = 960; // 60ms @ 16kHz
const EVENT_TYPES = ["transcript", "bargein", "error", "ended"];

// AudioWorklet processor source, loaded from a Blob URL so the transport stays single-file.
// Downmixes to mono, box/average-resamples any device rate to 16kHz, and posts
// Int16Array frames of exactly 960 samples (60ms) to the port.
export const MIC_WORKLET_SOURCE = `
// mic-capture-16k: mono downmix + resample to 16kHz, 960-sample (60ms) Int16Array frames.
class MicCapture16k extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / 16000;
    this.pending = new Float32Array(0);
    this.carry = [];
  }
  process(inputs) {
    var chs = inputs && inputs[0];
    if (chs && chs.length) {
      var n = chs[0].length;
      var mono = new Float32Array(n);
      for (var i = 0; i < n; i++) {
        var s = 0;
        for (var c = 0; c < chs.length; c++) s += chs[c][i];
        mono[i] = s / chs.length;
      }
      var cat = new Float32Array(this.pending.length + n);
      cat.set(this.pending, 0);
      cat.set(mono, this.pending.length);
      var count = Math.floor(cat.length / this.step);
      for (var k = 0; k < count; k++) {
        var start = k * this.step;
        var end = (k + 1) * this.step;
        var sum = 0, cnt = 0;
        for (var j = Math.floor(start); j < end && j < cat.length; j++) { sum += cat[j]; cnt++; }
        this.carry.push(cnt ? sum / cnt : 0);
      }
      var consumed = Math.floor(count * this.step);
      this.pending = cat.slice(consumed);
      while (this.carry.length >= 960) {
        var frame = this.carry.splice(0, 960);
        var pcm = new Int16Array(960);
        for (var m = 0; m < 960; m++) {
          var v = frame[m];
          if (v > 1) v = 1; else if (v < -1) v = -1;
          pcm[m] = Math.round(v * 32767);
        }
        this.port.postMessage(pcm, [pcm.buffer]);
      }
    }
    return true;
  }
}
registerProcessor("mic-capture-16k", MicCapture16k);
`;

// Frozen usage shape (§11). audioMinutes/chars/neurons are zeros until the
// server pushes a {t:"usage"} frame.
export function zeroUsage() {
  return {
    stt: { model: "@cf/deepgram/flux", audioMinutes: 0, neurons: 0 },
    tts: { model: "@cf/deepgram/aura-1", chars: 0, cachedChars: 0, neurons: 0 },
    turn: { model: "@cf/pipecat-ai/smart-turn-v2", audioMinutes: 0, neurons: 0 },
  };
}

export class VoiceTransport {
  // Constructor options are test hooks only (timeouts); not part of the frozen API.
  constructor({ openTimeoutMs = 10000, ackTimeoutMs = 10000, pingIntervalMs = 25000 } = {}) {
    this._opts = { openTimeoutMs, ackTimeoutMs, pingIntervalMs };
    this._handlers = { transcript: new Set(), bargein: new Set(), error: new Set(), ended: new Set() };
    this._ws = null;
    this._ctx = null;
    this._stream = null;
    this._micNodes = null;
    this._workletUrl = null;
    this._listening = false;
    this._active = false;
    this._disposed = false;
    this._closedByUs = false;
    this._waiters = new Map(); // server msg type -> [{ resolve, reject, timer }]
    this._pendingSpeak = null;
    this._speakSeq = 0;
    this._sources = []; // scheduled AudioBufferSourceNodes (for instant cancel)
    this._nextPlayTime = 0; // cursor: when the next chunk starts playing
    this._playEndTime = 0; // cursor: when the last queued chunk finishes
    this._usage = zeroUsage();
    this._connectResolve = null;
    this._connectReject = null;
    this._pingTimer = null;
    this._brainSessionId = null;
    this._sessionId = null;
  }

  // ── events ──────────────────────────────────────────────────────────────

  on(type, handler) {
    if (!EVENT_TYPES.includes(type)) throw Error(`VoiceTransport.on: unknown event "${type}"`);
    if (typeof handler !== "function") throw Error("VoiceTransport.on: handler must be a function");
    this._handlers[type].add(handler);
    return () => this._handlers[type].delete(handler);
  }

  _emit(type, payload) {
    for (const h of this._handlers[type]) {
      try {
        h(payload);
      } catch {
        /* a handler must never break the transport */
      }
    }
  }

  _fail(code, message) {
    this._emit("error", { message, code });
    throw Object.assign(new Error(message), { code });
  }

  _assertReady() {
    if (this._disposed) throw Error("VoiceTransport is disposed");
    if (!this._ws || !this._active) throw Error("VoiceTransport not initialized — call init() first");
  }

  // ── init ────────────────────────────────────────────────────────────────

  // Requires BOTH brainSessionId (brain HTTP route) and sessionId (voice WS auth).
  async init({ brainSessionId, sessionId, voiceHost = DEFAULT_VOICE_HOST } = {}) {
    if (this._disposed) throw Error("VoiceTransport is disposed");
    if (!brainSessionId || !sessionId) {
      throw Error("VoiceTransport.init requires both brainSessionId and sessionId");
    }
    const g = globalThis;
    const hasWS = typeof g.WebSocket !== "undefined";
    const AC = g.AudioContext || g.webkitAudioContext;
    const hasMic = !!(g.navigator && g.navigator.mediaDevices && g.navigator.mediaDevices.getUserMedia);
    if (!hasWS || !AC || !hasMic) {
      this._fail("unsupported", "voice call needs WebSocket + AudioContext + microphone (getUserMedia)");
    }

    // Mic first: fail fast on permission / missing hardware before touching the socket.
    let stream;
    try {
      stream = await g.navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      const name = (e && e.name) || "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        this._fail("mic-denied", "microphone permission denied");
      }
      this._fail("no-mic", `no microphone available (${name || "getUserMedia failed"})`);
    }
    const tracks = stream.getAudioTracks ? stream.getAudioTracks() : [];
    if (!tracks.length) {
      try {
        stream.getTracks().forEach((tr) => tr.stop());
      } catch {}
      this._fail("no-mic", "microphone produced no audio tracks");
    }

    // One shared AudioContext at 16kHz (the wire rate); chunks are upsampled
    // with linear interpolation only if the browser refuses the 16kHz hint.
    this._ctx = new AC({ sampleRate: 16000 });
    try {
      await this._ctx.resume(); // autoplay policy
    } catch {}

    // Mic capture via AudioWorklet from a Blob URL (single-file).
    this._workletUrl = g.URL.createObjectURL(new g.Blob([MIC_WORKLET_SOURCE], { type: "application/javascript" }));
    await this._ctx.audioWorklet.addModule(this._workletUrl);
    const src = this._ctx.createMediaStreamSource(stream);
    const node = new g.AudioWorkletNode(this._ctx, "mic-capture-16k");
    const mute = this._ctx.createGain(); // keep the node pulled without audible output
    mute.gain.value = 0;
    src.connect(node);
    node.connect(mute);
    mute.connect(this._ctx.destination);
    node.port.onmessage = (ev) => {
      if (this._listening && this._ws && this._ws.readyState === 1) {
        try {
          this._ws.send(ev.data); // Int16Array frame -> binary
        } catch {}
      }
    };
    this._micNodes = { src, node, mute };
    this._stream = stream;

    // Voice WebSocket.
    this._sessionId = sessionId;
    this._brainSessionId = brainSessionId;
    const url = `wss://${voiceHost}/voice?session=${encodeURIComponent(sessionId)}`;
    await new Promise((resolve, reject) => {
      this._connectResolve = resolve;
      this._connectReject = reject;
      const ws = new g.WebSocket(url);
      ws.binaryType = "arraybuffer";
      const timer = setTimeout(() => {
        this._connectResolve = null;
        this._connectReject = null;
        this._emit("error", { message: "voice socket open timed out", code: "ws-failed" });
        try {
          ws.close();
        } catch {}
        reject(Object.assign(new Error("voice socket open timed out"), { code: "ws-failed" }));
      }, this._opts.openTimeoutMs);
      const settled = () => {
        clearTimeout(timer);
        this._connectResolve = null;
        this._connectReject = null;
      };
      ws.onopen = () => {
        settled();
        resolve();
      };
      ws.onerror = () => {
        // Some stacks fire onerror without onclose; fail the connect here,
        // guarded so a following onclose can't double-reject.
        if (this._connectReject) {
          const rej = this._connectReject;
          settled();
          this._emit("error", { message: "voice socket failed to open", code: "ws-failed" });
          rej(Object.assign(new Error("voice socket failed to open"), { code: "ws-failed" }));
        }
      };
      ws.onclose = (ev) => this._onClose(ev);
      ws.onmessage = (ev) => this._onMessage(ev);
      this._ws = ws;
    });

    this._active = true;
    this._closedByUs = false;
    this._nextPlayTime = this._ctx.currentTime;
    this._playEndTime = this._ctx.currentTime;
    this._startPing();
  }

  // ── listening ───────────────────────────────────────────────────────────

  async startListening() {
    this._assertReady();
    if (this._listening) return;
    const ack = this._awaitServerMsg("listening", "start-listen timed out");
    this._send({ t: "start-listen" });
    await ack;
    this._listening = true;
  }

  async stopListening() {
    this._assertReady();
    if (!this._listening) return;
    const ack = this._awaitServerMsg("stopped", "stop-listen timed out");
    this._send({ t: "stop-listen" });
    await ack;
    this._listening = false;
  }

  // ── speech ──────────────────────────────────────────────────────────────

  // Resolves { ttsMs, vttMs, bargeinCount, cached } at speech end.
  // Rejects Error("cancelled") when cancelSpeech() is called mid-speech.
  async speak(text, { onFirstAudio, onEnd } = {}) {
    this._assertReady();
    if (typeof text !== "string" || !text.trim()) throw Error("speak needs non-empty text");
    if (this._pendingSpeak) {
      throw Object.assign(new Error("already-speaking"), { code: "already-speaking" });
    }
    const id = `spk-${++this._speakSeq}-${Date.now().toString(36)}`;
    const startedAt = now();
    let resolveFn, rejectFn;
    const promise = new Promise((res, rej) => {
      resolveFn = res;
      rejectFn = rej;
    });
    this._pendingSpeak = {
      id,
      startedAt,
      resolve: resolveFn,
      reject: rejectFn,
      onFirstAudio,
      onEnd,
      ttsMs: null,
      firstAudioFired: false,
      bargeinCount: 0, // reset at each speak() call
      endTimer: null,
    };
    this._send({ t: "speak", id, text });
    return promise;
  }

  // Stops audible audio near-instantly and rejects the pending speak().
  cancelSpeech() {
    const p = this._pendingSpeak;
    for (const src of this._sources) {
      try {
        src.stop();
      } catch {}
      try {
        src.disconnect();
      } catch {}
    }
    this._sources = [];
    if (this._ctx) {
      this._nextPlayTime = this._ctx.currentTime;
      this._playEndTime = this._ctx.currentTime;
    }
    if (p) {
      this._pendingSpeak = null;
      if (p.endTimer) clearTimeout(p.endTimer);
      if (this._ws && this._ws.readyState === 1) this._send({ t: "cancel-speak", id: p.id });
      p.reject(Object.assign(new Error("cancelled"), { code: "cancelled" }));
    }
  }

  // ── teardown ────────────────────────────────────────────────────────────

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._active = false;
    this._listening = false;
    this._failWaiters("disposed");
    const p = this._pendingSpeak;
    this._pendingSpeak = null;
    if (p) {
      if (p.endTimer) clearTimeout(p.endTimer);
      p.reject(Object.assign(new Error("cancelled"), { code: "cancelled" }));
    }
    if (this._pingTimer) {
      clearInterval(this._pingTimer);
      this._pingTimer = null;
    }
    try {
      if (this._ws && this._ws.readyState === 1) this._send({ t: "hangup" });
    } catch {}
    this._closedByUs = true;
    try {
      if (this._ws) this._ws.close(1000, "hangup");
    } catch {}
    this._ws = null;
    try {
      if (this._micNodes) {
        this._micNodes.node.disconnect();
        this._micNodes.src.disconnect();
      }
    } catch {}
    this._micNodes = null;
    try {
      if (this._stream) this._stream.getTracks().forEach((tr) => tr.stop());
    } catch {}
    this._stream = null;
    try {
      if (this._workletUrl) globalThis.URL.revokeObjectURL(this._workletUrl);
    } catch {}
    this._workletUrl = null;
    for (const src of this._sources) {
      try {
        src.disconnect();
      } catch {}
    }
    this._sources = [];
    try {
      if (this._ctx && this._ctx.close) this._ctx.close();
    } catch {}
    this._ctx = null;
    for (const k of Object.keys(this._handlers)) this._handlers[k].clear();
  }

  // ── usage ───────────────────────────────────────────────────────────────

  // Last {t:"usage"} frame pushed by the server; zeros shape before any arrives.
  getUsage() {
    return JSON.parse(JSON.stringify(this._usage));
  }

  // ── internals ───────────────────────────────────────────────────────────

  _send(obj) {
    if (!this._ws || this._ws.readyState !== 1) throw Error("voice socket not open");
    this._ws.send(JSON.stringify(obj));
  }

  _awaitServerMsg(type, timeoutMessage) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const list = this._waiters.get(type) || [];
        this._waiters.delete(type);
        for (const w of list) w.reject(Object.assign(new Error(timeoutMessage), { code: "ws-failed" }));
      }, this._opts.ackTimeoutMs);
      const entry = { resolve, reject, timer };
      if (!this._waiters.has(type)) this._waiters.set(type, []);
      this._waiters.get(type).push(entry);
    });
  }

  _failWaiters(message) {
    for (const [, list] of this._waiters) {
      for (const w of list) {
        clearTimeout(w.timer);
        w.reject(Object.assign(new Error(message), { code: "ws-failed" }));
      }
    }
    this._waiters.clear();
  }

  _startPing() {
    if (this._pingTimer) clearInterval(this._pingTimer);
    this._pingTimer = setInterval(() => {
      try {
        if (this._ws && this._ws.readyState === 1) this._send({ t: "ping" });
      } catch {}
    }, this._opts.pingIntervalMs);
    if (this._pingTimer.unref) this._pingTimer.unref();
  }

  _onClose(ev) {
    const code = ev && typeof ev.code === "number" ? ev.code : 1006;
    const reason = (ev && ev.reason) || "";
    if (this._pingTimer) {
      clearInterval(this._pingTimer);
      this._pingTimer = null;
    }
    // Still connecting (init in flight): fail init.
    if (this._connectReject) {
      const rej = this._connectReject;
      this._connectResolve = null;
      this._connectReject = null;
      const errCode = code === 4401 ? "auth" : "ws-failed";
      const msg = code === 4401 ? reason || "unknown/mismatched session" : `voice socket failed (close ${code})`;
      this._emit("error", { message: msg, code: errCode });
      rej(Object.assign(new Error(msg), { code: errCode }));
      return;
    }
    if (this._closedByUs || this._disposed) return;
    // 4401: unknown/mismatched session -> auth error (no ended event; init never completed).
    if (code === 4401) {
      this._active = false;
      this._listening = false;
      this._emit("error", { message: reason || "unknown/mismatched session", code: "auth" });
      return;
    }
    // Unexpected drop while active.
    if (this._active) {
      this._active = false;
      this._listening = false;
      this._failWaiters("voice socket closed");
      this._emit("error", { message: `voice socket closed (${code}${reason ? ": " + reason : ""})`, code: "ws-failed" });
      this._emit("ended", { reason: "network" });
    }
  }

  _onMessage(ev) {
    const data = ev && ev.data;
    if (typeof data === "string") {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
      this._onServerJson(msg);
      return;
    }
    if (data) this._onTtsChunk(data);
  }

  _onServerJson(msg) {
    const t = msg && msg.t;
    if (this._waiters.has(t)) {
      const list = this._waiters.get(t);
      this._waiters.delete(t);
      for (const w of list) {
        clearTimeout(w.timer);
        w.resolve(msg);
      }
    }
    switch (t) {
      case "transcript":
        this._emit("transcript", {
          text: msg.text || "",
          isFinal: !!msg.isFinal,
          timing: { sttMs: msg.timing && msg.timing.sttMs != null ? msg.timing.sttMs : null },
        });
        break;
      case "bargein": {
        const p = this._pendingSpeak;
        if (p) p.bargeinCount += 1;
        this._emit("bargein", {});
        break;
      }
      case "speak-end":
        this._onSpeakEnd(msg);
        break;
      case "usage":
        if (msg.usage && typeof msg.usage === "object") this._usage = msg.usage;
        break;
      case "ended":
        this._active = false;
        this._listening = false;
        this._emit("ended", { reason: msg.reason || "remote" });
        break;
      case "error": {
        const payload = { message: msg.message || "voice server error", code: msg.code || "network" };
        this._emit("error", payload);
        const p = this._pendingSpeak;
        if (p && msg.speakId && msg.speakId === p.id) {
          this._pendingSpeak = null;
          p.reject(new Error(payload.message));
        }
        break;
      }
      // "listening" / "stopped" / "pong": consumed by waiters above.
      default:
        break;
    }
  }

  _onTtsChunk(buf) {
    if (!this._ctx) return;
    const pcm = buf instanceof Int16Array ? buf : new Int16Array(buf);
    if (!pcm.length) return;
    const p = this._pendingSpeak;
    // ttsMs: speak() call -> first audible chunk queued (onFirstAudio fires exactly once).
    if (p && !p.firstAudioFired) {
      p.firstAudioFired = true;
      p.ttsMs = Math.round(now() - p.startedAt);
      try {
        if (p.onFirstAudio) p.onFirstAudio();
      } catch {}
    }
    const data = this._pcm16ToFloat(pcm);
    const sr = this._ctx.sampleRate;
    const abuf = this._ctx.createBuffer(1, data.length, sr);
    abuf.getChannelData(0).set(data);
    const source = this._ctx.createBufferSource();
    source.buffer = abuf;
    source.connect(this._ctx.destination);
    const startAt = Math.max(this._ctx.currentTime, this._nextPlayTime);
    try {
      source.start(startAt);
    } catch {}
    this._nextPlayTime = startAt + data.length / sr;
    this._playEndTime = this._nextPlayTime;
    this._sources.push(source);
  }

  // 16kHz PCM16 -> Float32 at the context rate (linear interpolation upsample
  // only when the browser refused the 16kHz hint).
  _pcm16ToFloat(pcm) {
    const sr = this._ctx.sampleRate;
    const n = pcm.length;
    if (sr === 16000) {
      const f = new Float32Array(n);
      for (let i = 0; i < n; i++) f[i] = pcm[i] / 32768;
      return f;
    }
    const m = Math.max(1, Math.round((n * sr) / 16000));
    const f = new Float32Array(m);
    for (let i = 0; i < m; i++) {
      const pos = m === 1 ? 0 : (i * (n - 1)) / (m - 1);
      const i0 = Math.floor(pos);
      const i1 = Math.min(n - 1, i0 + 1);
      const frac = pos - i0;
      f[i] = (pcm[i0] * (1 - frac) + pcm[i1] * frac) / 32768;
    }
    return f;
  }

  _onSpeakEnd(msg) {
    const p = this._pendingSpeak;
    if (!p || p.id !== msg.id) return;
    const done = () => {
      if (this._pendingSpeak !== p) return; // cancelled meanwhile
      this._pendingSpeak = null;
      // vttMs: speak() call -> last audio finished playing (we resolve then).
      const vttMs = Math.round(now() - p.startedAt);
      try {
        if (p.onEnd) p.onEnd();
      } catch {}
      p.resolve({ ttsMs: p.ttsMs, vttMs, bargeinCount: p.bargeinCount, cached: !!msg.cached });
    };
    const waitMs = Math.max(0, (this._playEndTime - this._ctx.currentTime) * 1000);
    if (waitMs <= 1) done();
    else p.endTimer = setTimeout(done, waitMs);
  }
}
