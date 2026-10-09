// assessment-call/voice-adapter.js — OUR side of the voice seam.
//
// Wires the voice team's transport -> the brain crew's /api/assessment/turn
// -> the avatar crew's avatar API + the transport's TTS.
//
// The adapter adds ~zero latency: it is pure glue (event -> fetch -> speak).
// Overhead is measured in scripts/test-assessment-call.mjs (event->fetch and
// response->speak must each be < 50ms in-process).
//
// Transport contract (requested from the voice team —
// docs/voice-adapter-contract.md):
//   init({ brainSessionId }), startListening(), stopListening(),
//   on('transcript'|'bargein'|'error'|'ended', handler),
//   speak(text, { onFirstAudio, onEnd }) -> Promise,
//   cancelSpeech(), dispose()
// Avatar contract: mountAvatar, setSpeaking, setState, playSpeech, dispose.

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export class VoiceAdapter {
  constructor({ transport, avatar, apiBase = "", fetchFn = fetch } = {}) {
    if (!transport) throw Error("VoiceAdapter needs a voice transport");
    if (!avatar) throw Error("VoiceAdapter needs an avatar implementing the avatar API");
    this.transport = transport;
    this.avatar = avatar;
    this.apiBase = apiBase;
    this.fetchFn = fetchFn;
    this.brainSessionId = null;
    this.callSessionId = null;
    this.active = false;
    this.speaking = false;
    this.events = []; // test hook
    this.marks = {}; // latency-proof hook: { toFetchMs, toSpeakMs, tttMs, ttsMs }
  }

  emit(type, data = {}) {
    this.events.push({ type, ...data });
  }

  async startCall({ brainSessionId, callSessionId }) {
    if (!brainSessionId || !callSessionId) throw Error("startCall needs brainSessionId + callSessionId");
    this.brainSessionId = brainSessionId;
    this.callSessionId = callSessionId;
    this.active = true;
    await this.transport.init({ brainSessionId });
    this.transport.on("transcript", (e) => this.onTranscript(e));
    this.transport.on("bargein", () => this.onBargeIn());
    this.transport.on("error", (e) => this.emit("transport_error", e));
    this.transport.on("ended", (e) => this.emit("transport_ended", e));
    await this.transport.startListening();
    this.avatar.setState("listening");
    this.avatar.setSpeaking(false);
    this.emit("started");
  }

  async onTranscript({ text, isFinal, timing } = {}) {
    if (!this.active || !isFinal) return;
    const clean = String(text || "").trim().slice(0, 2000);
    if (!clean) return;
    const t0 = now();
    this.avatar.setState("thinking");
    this.avatar.setSpeaking(false);
    this.emit("thinking", { text: clean });
    let data;
    try {
      const fetchP = this.fetchFn(`${this.apiBase}/api/assessment/turn`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: this.brainSessionId, user_text: clean }),
      });
      this.marks.eventToFetchMs = Math.round(now() - t0); // adapter overhead: event -> fetch
      const res = await fetchP;
      data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw Error(data.error || `turn_${res.status}`);
    } catch (e) {
      this.emit("turn_error", { message: e.message });
      this.avatar.setState("listening");
      return;
    }
    const tttMs = Math.round(now() - t0); // transcript-final -> first reply byte
    this.marks.tttMs = tttMs;
    this.emit("reply", { replyText: data.reply_text, actions: data.actions });
    const endCall = (data.actions || []).some((a) => a.type === "endCall");
    await this.speak(data.reply_text || "", {
      userText: clean,
      sttMs: timing?.sttMs ?? null,
      tttMs,
      brainMs: data.brain_ms ?? null,
      usage: data.usage && typeof data.usage === "object" ? data.usage : undefined,
      endCall,
    });
  }

  async speak(text, { userText, sttMs, tttMs, brainMs, usage, endCall } = {}) {
    if (!this.active) return;
    this.speaking = true;
    const s0 = now();
    this.avatar.setState("speaking");
    this.avatar.setSpeaking(true);
    this.emit("speaking", { text });
    let ttsMs = null;
    try {
      const speakP = this.transport.speak(text, {
        onFirstAudio: () => {
          if (ttsMs === null) ttsMs = Math.round(now() - s0);
        },
        onEnd: () => {},
      });
      this.marks.responseToSpeakMs = Math.round(now() - s0); // adapter overhead: reply -> speak
      await speakP;
      // Let the avatar visualize/lip-sync the same reply.
      await this.avatar.playSpeech({ kind: "text", text });
    } catch (e) {
      this.emit("speak_cancelled", { message: e.message });
    } finally {
      this.speaking = false;
      this.avatar.setSpeaking(false);
    }
    this.marks.ttsMs = ttsMs;
    // Persist the turn + latency log on OUR session record (text only).
    try {
      await this.fetchFn(`${this.apiBase}/api/assessment-call/turn-complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: this.callSessionId,
          userText,
          replyText: text,
          timings: { sttMs, tttMs, brainMs, ttsMs },
          ...(usage ? { usage } : {}),
        }),
      });
    } catch {
      /* latency log is best-effort; the call continues */
    }
    this.emit("spoken", { ttsMs });
    if (endCall) {
      await this.endCall("brain");
      return;
    }
    if (this.active) this.avatar.setState("listening");
  }

  async onBargeIn() {
    if (!this.active || !this.speaking) return;
    this.emit("bargein");
    this.transport.cancelSpeech();
    this.speaking = false;
    this.avatar.setSpeaking(false);
    this.avatar.setState("listening");
    try {
      await this.fetchFn(`${this.apiBase}/api/assessment-call/interrupt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: this.callSessionId }),
      });
    } catch {
      /* best effort */
    }
  }

  async endCall(reason = "user") {
    if (!this.active) return;
    this.active = false;
    this.emit("end", { reason });
    try {
      await this.transport.stopListening();
    } catch {}
    try {
      await this.fetchFn(`${this.apiBase}/api/assessment-call/end`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: this.callSessionId }),
      });
    } catch {}
    this.avatar.setState("idle");
    this.avatar.setSpeaking(false);
  }

  dispose() {
    this.active = false;
    try {
      this.transport.dispose();
    } catch {}
    try {
      this.avatar.dispose();
    } catch {}
  }
}
