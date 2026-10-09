// assessment-call/stubs.js — test doubles for the two crews' APIs.
//
// 1) createStubAvatar() — the exact avatar-crew API:
//      mountAvatar(container, opts), setSpeaking(bool),
//      setState('idle'|'listening'|'thinking'|'speaking'),
//      playSpeech(audio) -> Promise, dispose()
//    playSpeech(audio): audio = { kind:'text', text } | { kind:'audio', src }.
//    The shell owns real playback; playSpeech lets the avatar visualize.
//    No stop method by design — the shell cancels its own playback on barge-in.
//
// 2) createStubVoiceTransport() — implements the TRANSPORT contract we request
//    from the voice team (see docs/voice-adapter-contract.md § Transport API):
//      init({ brainSessionId }), startListening(), stopListening(),
//      on('transcript'|'bargein'|'error'|'ended', handler),
//      speak(text, { onFirstAudio, onEnd }) -> Promise (resolves at speech end),
//      cancelSpeech(), dispose()
//    Test helpers: emitTranscript(text, {isFinal, sttMs}), emitBargeIn(),
//    emitError(message), emitEnded(reason).
//
// Both record every call in `log` for the test harness.

export function createStubAvatar() {
  const log = [];
  const avatar = {
    log,
    mounted: false,
    speaking: false,
    state: "idle",
    mountAvatar(container, opts = {}) {
      avatar.mounted = true;
      avatar.container = container || null;
      avatar.opts = opts;
      log.push({ call: "mountAvatar", opts });
      return avatar;
    },
    setSpeaking(on) {
      avatar.speaking = !!on;
      log.push({ call: "setSpeaking", on: !!on });
    },
    setState(state) {
      const valid = ["idle", "listening", "thinking", "speaking"];
      if (!valid.includes(state)) throw Error(`bad avatar state: ${state}`);
      avatar.state = state;
      log.push({ call: "setState", state });
    },
    async playSpeech(audio) {
      if (!audio || (audio.kind !== "text" && audio.kind !== "audio"))
        throw Error("playSpeech needs {kind:'text'|'audio'}");
      log.push({ call: "playSpeech", kind: audio.kind, len: (audio.text || audio.src || "").length });
      const ms = audio.kind === "text" ? Math.min(120, 20 + audio.text.length) : 60;
      await new Promise((r) => setTimeout(r, ms));
    },
    dispose() {
      avatar.mounted = false;
      log.push({ call: "dispose" });
    },
  };
  return avatar;
}

export function createStubVoiceTransport() {
  const log = [];
  const handlers = { transcript: [], bargein: [], error: [], ended: [] };
  const t = {
    log,
    listening: false,
    speaking: false,
    cancelled: 0,
    on(evt, fn) {
      if (!handlers[evt]) throw Error(`unknown transport event: ${evt}`);
      handlers[evt].push(fn);
      log.push({ call: "on", evt });
    },
    async init({ brainSessionId } = {}) {
      t.brainSessionId = brainSessionId || null;
      log.push({ call: "init", brainSessionId: t.brainSessionId });
    },
    async startListening() {
      t.listening = true;
      log.push({ call: "startListening" });
    },
    async stopListening() {
      t.listening = false;
      log.push({ call: "stopListening" });
    },
    // Speak simulation: onFirstAudio fires ~immediately (like streaming TTS),
    // the promise resolves after a text-length-proportional delay.
    async speak(text, { onFirstAudio, onEnd } = {}) {
      if (t.cancelledToken) throw Error("cancelled");
      t.speaking = true;
      log.push({ call: "speak", len: String(text).length });
      const start = Date.now();
      if (onFirstAudio) {
        await new Promise((r) => setTimeout(r, 5));
        if (t.cancelledToken) throw Error("cancelled");
        onFirstAudio({ atMs: Date.now() - start });
      }
      const totalMs = Math.min(400, 30 + String(text).length * 2);
      const token = {};
      t.cancelledToken = token;
      await new Promise((r) => setTimeout(r, totalMs));
      if (t.cancelledToken !== token) throw Error("cancelled");
      t.cancelledToken = null;
      t.speaking = false;
      if (onEnd) onEnd({});
      log.push({ call: "speak:end" });
    },
    cancelSpeech() {
      t.cancelled++;
      t.cancelledToken = null;
      t.speaking = false;
      log.push({ call: "cancelSpeech" });
    },
    dispose() {
      t.listening = false;
      t.speaking = false;
      log.push({ call: "dispose" });
    },
    // ── test drivers ──
    emitTranscript(text, { isFinal = true, sttMs = 280 } = {}) {
      for (const fn of handlers.transcript) fn({ text, isFinal, timing: { sttMs } });
    },
    emitBargeIn() {
      for (const fn of handlers.bargein) fn({});
    },
    emitError(message) {
      for (const fn of handlers.error) fn({ message });
    },
    emitEnded(reason = "remote") {
      for (const fn of handlers.ended) fn({ reason });
    },
  };
  return t;
}
