// scripts/test-voice-transport.mjs — VoiceTransport unit tests (mocked browser globals).
//
// Run: node scripts/test-voice-transport.mjs
// Covers (no network, no audio hardware — everything mocked):
//   worklet source syntax, 7-method + getUsage surface, init validation
//   (unsupported / mic-denied / no-mic / ws-failed incl. 10s-open-timeout logic),
//   WS URL + default/custom voiceHost, start/stop listening ack flow,
//   mic frames sent only while listening, transcript/bargein/usage/ended re-emit,
//   speak -> first-chunk -> speak-end timing plumbing (ttsMs/vttMs/bargeinCount/cached,
//   onFirstAudio exactly once), cancelSpeech rejecting pending speak,
//   bargein incrementing bargeinCount, server error frame with speakId,
//   4401 -> error {code:'auth'}, unexpected drop -> ws-failed + ended network,
//   getUsage zeros shape, 16kHz->48kHz upsample, dispose/hangup.

import assert from "node:assert/strict";
import { Script } from "node:vm";

import { VoiceTransport, MIC_WORKLET_SOURCE, zeroUsage } from "../client/src/lib/assessment-call/voice-transport.js";

let N = 0;
const ok = (cond, msg) => { N++; assert.ok(cond, msg); };
const eq = (a, b, msg) => { N++; assert.equal(a, b, msg); };
const deep = (a, b, msg) => { N++; assert.deepEqual(a, b, msg); };

// ── browser mocks ─────────────────────────────────────────────────────────

class MockWebSocket {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    this.binaryType = "";
    MockWebSocket.instances.push(this);
  }
  send(data) { this.sent.push(data); }
  close(code = 1000, reason = "") { this.readyState = 3; if (this.onclose) this.onclose({ code, reason }); }
  _open() { this.readyState = 1; if (this.onopen) this.onopen({}); }
  _fail() { if (this.onerror) this.onerror({}); }
  _message(data) { if (this.onmessage) this.onmessage({ data }); }
  _close(code, reason = "") { this.readyState = 3; if (this.onclose) this.onclose({ code, reason }); }
  sentJson() { return this.sent.filter((s) => typeof s === "string").map((s) => JSON.parse(s)); }
  sentBinary() { return this.sent.filter((s) => typeof s !== "string"); }
}
MockWebSocket.instances = [];

class MockAudioBuffer {
  constructor(ch, len, rate) { this.length = len; this.sampleRate = rate; this._d = [new Float32Array(len)]; }
  getChannelData() { return this._d[0]; }
}
class MockSource {
  constructor() { this.startedAt = null; this.stopped = false; MockSource.instances.push(this); }
  connect() {} disconnect() {}
  start(when) { this.startedAt = when; }
  stop() { this.stopped = true; }
}
MockSource.instances = [];
class MockWorkletNode {
  constructor(ctx, name) {
    this.name = name;
    this.port = { postMessage() {}, onmessage: null };
    MockWorkletNode.instances.push(this);
  }
  connect() {} disconnect() {}
}
MockWorkletNode.instances = [];

class MockAudioContext {
  constructor(opts = {}) {
    this.sampleRate = globalThis.__mockSampleRate || opts.sampleRate || 48000;
    this.currentTime = 0;
    this.destination = {};
    this.audioWorklet = { addModule: async () => { this.moduleAdded = true; } };
    this.resumed = false;
    this.closed = false;
  }
  async resume() { this.resumed = true; }
  createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
  createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
  createBuffer(ch, len, rate) { return new MockAudioBuffer(ch, len, rate); }
  createBufferSource() { return new MockSource(); }
  async close() { this.closed = true; }
}

const realWS = globalThis.WebSocket;
const realAC = globalThis.AudioContext;
const realNav = globalThis.navigator;
const realBlob = globalThis.Blob;
const realCreateObjectURL = globalThis.URL && globalThis.URL.createObjectURL;

function installBrowser({ gumImpl, sampleRate } = {}) {
  globalThis.WebSocket = MockWebSocket;
  globalThis.AudioContext = MockAudioContext;
  globalThis.AudioWorkletNode = MockWorkletNode;
  globalThis.__mockSampleRate = sampleRate;
  Object.defineProperty(globalThis, "navigator", {
    value: {
      mediaDevices: {
        getUserMedia: gumImpl || (async () => ({ getAudioTracks: () => [{ stop() {} }], getTracks() { return this.getAudioTracks(); } })),
      },
    },
    configurable: true,
    writable: true,
  });
  globalThis.Blob = class { constructor(parts) { this.parts = parts; } };
  globalThis.URL.createObjectURL = () => "blob:mock-worklet";
  globalThis.URL.revokeObjectURL = () => {};
  MockWebSocket.instances = [];
  MockWorkletNode.instances = [];
  MockSource.instances = [];
}

function restoreBrowser() {
  globalThis.WebSocket = realWS;
  globalThis.AudioContext = realAC;
  globalThis.AudioWorkletNode = undefined;
  if (realNav === undefined) delete globalThis.navigator;
  else Object.defineProperty(globalThis, "navigator", { value: realNav, configurable: true, writable: true });
  globalThis.Blob = realBlob;
  if (realCreateObjectURL) globalThis.URL.createObjectURL = realCreateObjectURL;
  delete globalThis.__mockSampleRate;
}

function lastWs() { return MockWebSocket.instances[MockWebSocket.instances.length - 1]; }

// init() up to (not incl.) the socket opening; returns { t, ws, promise }
async function initPending(t, args = { brainSessionId: "b1", sessionId: "s1" }) {
  MockWebSocket.instances = [];
  const promise = t.init(args);
  for (let i = 0; i < 200 && MockWebSocket.instances.length === 0; i++) await tick();
  const ws = lastWs();
  ok(!!ws, "websocket created during init");
  return { t, ws, promise };
}
async function initOk(t, args) {
  const { ws, promise } = await initPending(t, args);
  ws._open();
  await promise;
  return ws;
}

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

// ── worklet source ────────────────────────────────────────────────────────

{
  new Script(MIC_WORKLET_SOURCE); // syntax check
  ok(MIC_WORKLET_SOURCE.includes('registerProcessor("mic-capture-16k"'), "worklet registers mic-capture-16k");
  ok(MIC_WORKLET_SOURCE.includes("960"), "worklet frames are 960 samples");
  N += 0;
}

// ── method surface ────────────────────────────────────────────────────────

{
  installBrowser();
  const t = new VoiceTransport();
  for (const m of ["init", "startListening", "stopListening", "on", "speak", "cancelSpeech", "dispose", "getUsage"]) {
    ok(typeof t[m] === "function", `surface: ${m}() exists`);
  }
  t.dispose();
  restoreBrowser();
}

// ── init requires BOTH ids ────────────────────────────────────────────────

{
  installBrowser();
  const t = new VoiceTransport();
  await assert.rejects(() => t.init({ brainSessionId: "b" }), /both brainSessionId and sessionId/); N++;
  await assert.rejects(() => t.init({ sessionId: "s" }), /both brainSessionId and sessionId/); N++;
  await assert.rejects(() => t.init(), /both brainSessionId and sessionId/); N++;
  t.dispose();
  restoreBrowser();
}

// ── unsupported environment ─────────────────────────────────────────────

{
  installBrowser();
  delete globalThis.WebSocket;
  const t = new VoiceTransport();
  const errs = [];
  t.on("error", (e) => errs.push(e));
  await assert.rejects(() => t.init({ brainSessionId: "b", sessionId: "s" })); N++;
  eq(errs.length, 1, "unsupported: one error event");
  eq(errs[0].code, "unsupported", "unsupported: code");
  restoreBrowser();
}
{
  installBrowser();
  const AC = globalThis.AudioContext;
  delete globalThis.AudioContext;
  delete globalThis.webkitAudioContext;
  const t = new VoiceTransport();
  const errs = [];
  t.on("error", (e) => errs.push(e));
  await assert.rejects(() => t.init({ brainSessionId: "b", sessionId: "s" })); N++;
  eq(errs[0].code, "unsupported", "no AudioContext -> unsupported");
  globalThis.AudioContext = AC;
  restoreBrowser();
}

// ── mic-denied / no-mic ───────────────────────────────────────────────────

{
  installBrowser({ gumImpl: async () => { const e = new Error("denied"); e.name = "NotAllowedError"; throw e; } });
  const t = new VoiceTransport();
  const errs = [];
  t.on("error", (e) => errs.push(e));
  await assert.rejects(() => t.init({ brainSessionId: "b", sessionId: "s" }), /denied/i); N++;
  eq(errs[0].code, "mic-denied", "NotAllowedError -> mic-denied");
  restoreBrowser();
}
{
  installBrowser({ gumImpl: async () => ({ getAudioTracks: () => [], getTracks: () => [] }) });
  const t = new VoiceTransport();
  const errs = [];
  t.on("error", (e) => errs.push(e));
  await assert.rejects(() => t.init({ brainSessionId: "b", sessionId: "s" })); N++;
  eq(errs[0].code, "no-mic", "no audio tracks -> no-mic");
  restoreBrowser();
}

// ── ws open failure -> ws-failed ──────────────────────────────────────────

{
  installBrowser();
  const t = new VoiceTransport({ openTimeoutMs: 50 });
  const errs = [];
  t.on("error", (e) => errs.push(e));
  const { ws, promise } = await initPending(t);
  ws._close(1006); // immediate failure
  await assert.rejects(() => promise, /failed/); N++;
  eq(errs[0].code, "ws-failed", "ws close during init -> ws-failed");
  restoreBrowser();
}
{
  installBrowser();
  const t = new VoiceTransport({ openTimeoutMs: 40 });
  const errs = [];
  t.on("error", (e) => errs.push(e));
  await assert.rejects(() => t.init({ brainSessionId: "b", sessionId: "s" }), /timed out/); N++;
  eq(errs[0].code, "ws-failed", "ws open timeout -> ws-failed");
  t.dispose();
  restoreBrowser();
}

// ── happy init: URL, default + custom voiceHost ───────────────────────────

{
  installBrowser({ sampleRate: 16000 });
  const t = new VoiceTransport();
  const ws = await initOk(t);
  eq(ws.url, "wss://voice-transport.mehyar.workers.dev/voice?session=s1", "default voiceHost URL");
  eq(ws.binaryType, "arraybuffer", "binaryType arraybuffer");
  ok(t._ctx.resumed, "ctx.resume() called at init");
  ok(t._ctx.moduleAdded, "worklet module added");
  eq(MockWorkletNode.instances.length, 1, "worklet node created");
  eq(MockWorkletNode.instances[0].name, "mic-capture-16k", "worklet name mic-capture-16k");
  t.dispose();
  restoreBrowser();
}
{
  installBrowser({ sampleRate: 16000 });
  const t = new VoiceTransport();
  const ws = await initOk(t, { brainSessionId: "b", sessionId: "s", voiceHost: "custom.example.com" });
  eq(ws.url, "wss://custom.example.com/voice?session=s", "custom voiceHost URL");
  t.dispose();
  restoreBrowser();
}

// ── start/stop listening ack flow + mic gating ────────────────────────────

{
  installBrowser({ sampleRate: 16000 });
  const t = new VoiceTransport({ ackTimeoutMs: 50 });
  const ws = await initOk(t);
  const node = MockWorkletNode.instances[0];
  ok(typeof node.port.onmessage === "function", "mic port handler wired");

  // frames before listening are NOT sent
  node.port.onmessage({ data: new Int16Array(960) });
  eq(ws.sentBinary().length, 0, "no mic frames before startListening");

  const p = t.startListening();
  deep(ws.sentJson().at(-1), { t: "start-listen" }, "start-listen sent");
  ws._message(JSON.stringify({ t: "listening" }));
  await p;
  node.port.onmessage({ data: new Int16Array(960) });
  eq(ws.sentBinary().length, 1, "mic frame sent while listening");

  const p2 = t.stopListening();
  deep(ws.sentJson().at(-1), { t: "stop-listen" }, "stop-listen sent");
  ws._message(JSON.stringify({ t: "stopped" }));
  await p2;
  node.port.onmessage({ data: new Int16Array(960) });
  eq(ws.sentBinary().length, 1, "no mic frames after stopListening");
  t.dispose();
  restoreBrowser();
}

// ── transcript re-emit ────────────────────────────────────────────────────

{
  installBrowser({ sampleRate: 16000 });
  const t = new VoiceTransport();
  const ws = await initOk(t);
  const got = [];
  t.on("transcript", (e) => got.push(e));
  ws._message(JSON.stringify({ t: "transcript", text: "hello", isFinal: true, timing: { sttMs: 210 } }));
  ws._message(JSON.stringify({ t: "transcript", text: "hel", isFinal: false, timing: { sttMs: 0 } }));
  deep(got[0], { text: "hello", isFinal: true, timing: { sttMs: 210 } }, "final transcript shape");
  deep(got[1], { text: "hel", isFinal: false, timing: { sttMs: 0 } }, "interim transcript passes through");
  t.dispose();
  restoreBrowser();
}

// ── speak timing plumbing ─────────────────────────────────────────────────

{
  installBrowser({ sampleRate: 16000 });
  const t = new VoiceTransport();
  const ws = await initOk(t);
  let firstAudio = 0, onEnd = 0;
  const p = t.speak("hello world", { onFirstAudio: () => firstAudio++, onEnd: () => onEnd++ });
  const speakMsg = ws.sentJson().find((m) => m.t === "speak");
  ok(speakMsg && speakMsg.text === "hello world" && typeof speakMsg.id === "string", "speak sent with id+text");

  // two chunks: onFirstAudio fires exactly once
  ws._message(new Int16Array(960).buffer);
  await tick();
  ws._message(new Int16Array(480).buffer);
  await tick();
  eq(firstAudio, 1, "onFirstAudio fired exactly once");
  eq(MockSource.instances.length, 2, "two chunks scheduled as sources");
  ok(MockSource.instances[0].startedAt != null, "chunk scheduled via source.start");

  ws._message(JSON.stringify({ t: "speak-end", id: speakMsg.id, cached: true }));
  const res = await p;
  eq(res.cached, true, "cached from speak-end");
  eq(res.bargeinCount, 0, "bargeinCount 0");
  ok(typeof res.ttsMs === "number" && res.ttsMs >= 0, `ttsMs number (${res.ttsMs})`);
  ok(typeof res.vttMs === "number" && res.vttMs >= res.ttsMs, `vttMs >= ttsMs (${res.vttMs})`);
  eq(onEnd, 1, "onEnd fired once");
  t.dispose();
  restoreBrowser();
}

// ── speak rejects on empty text / double speak ────────────────────────────

{
  installBrowser({ sampleRate: 16000 });
  const t = new VoiceTransport();
  const ws = await initOk(t);
  await assert.rejects(() => t.speak("   "), /non-empty/); N++;
  const p1 = t.speak("one");
  await assert.rejects(() => t.speak("two"), /already-speaking/); N++;
  t.cancelSpeech();
  await assert.rejects(() => p1, (e) => e.message === "cancelled"); N++;
  t.dispose();
  restoreBrowser();
}

// ── cancelSpeech rejects pending speak ────────────────────────────────────

{
  installBrowser({ sampleRate: 16000 });
  const t = new VoiceTransport();
  const ws = await initOk(t);
  const p = t.speak("long text here");
  const speakMsg = ws.sentJson().find((m) => m.t === "speak");
  ws._message(new Int16Array(960).buffer);
  await tick();
  t.cancelSpeech();
  await assert.rejects(() => p, (e) => e.message === "cancelled"); N++;
  const cancelMsg = ws.sentJson().find((m) => m.t === "cancel-speak");
  deep(cancelMsg, { t: "cancel-speak", id: speakMsg.id }, "cancel-speak sent with id");
  ok(MockSource.instances.every((s) => s.stopped), "all scheduled sources stopped");
  t.dispose();
  restoreBrowser();
}

// ── bargein increments bargeinCount; handler gets {} ───────────────────────

{
  installBrowser({ sampleRate: 16000 });
  const t = new VoiceTransport();
  const ws = await initOk(t);
  const got = [];
  t.on("bargein", (e) => got.push(e)); // note: NOT calling cancelSpeech here
  const p = t.speak("talking...");
  const speakMsg = ws.sentJson().find((m) => m.t === "speak");
  ws._message(JSON.stringify({ t: "bargein", count: 1 }));
  ws._message(JSON.stringify({ t: "bargein", count: 2 }));
  deep(got, [{}, {}], "bargein handlers get {}");
  ws._message(JSON.stringify({ t: "speak-end", id: speakMsg.id, cached: false }));
  const res = await p;
  eq(res.bargeinCount, 2, "bargeinCount increments per bargein event while speak pending");
  t.dispose();
  restoreBrowser();
}

// ── server error frame: re-emit + reject matching speak ───────────────────

{
  installBrowser({ sampleRate: 16000 });
  const t = new VoiceTransport();
  const ws = await initOk(t);
  const errs = [];
  t.on("error", (e) => errs.push(e));
  const p = t.speak("boom");
  const speakMsg = ws.sentJson().find((m) => m.t === "speak");
  ws._message(JSON.stringify({ t: "error", message: "tts exploded", code: "tts-failed", speakId: speakMsg.id }));
  await assert.rejects(() => p, /tts exploded/); N++;
  eq(errs.length, 1, "server error re-emitted");
  deep(errs[0], { message: "tts exploded", code: "tts-failed" }, "error event shape");
  t.dispose();
  restoreBrowser();
}

// ── 4401 -> error {code:'auth'} ────────────────────────────────────────────

{
  installBrowser({ sampleRate: 16000 });
  const t = new VoiceTransport();
  const ws = await initOk(t);
  const errs = [];
  const ended = [];
  t.on("error", (e) => errs.push(e));
  t.on("ended", (e) => ended.push(e));
  ws._close(4401, "unknown session");
  eq(errs.length, 1, "4401: one error event");
  eq(errs[0].code, "auth", "4401 -> auth");
  eq(errs[0].message, "unknown session", "4401: server reason as message");
  eq(ended.length, 0, "4401: no ended event");
  t.dispose();
  restoreBrowser();
}

// ── unexpected drop -> ws-failed then ended network ───────────────────────

{
  installBrowser({ sampleRate: 16000 });
  const t = new VoiceTransport();
  const ws = await initOk(t);
  const errs = [];
  const ended = [];
  t.on("error", (e) => errs.push(e));
  t.on("ended", (e) => ended.push(e));
  ws._close(1006);
  eq(errs.length, 1, "drop: one error event");
  eq(errs[0].code, "ws-failed", "drop -> ws-failed");
  deep(ended, [{ reason: "network" }], "drop -> ended network");
  t.dispose();
  restoreBrowser();
}

// ── server {t:"ended"} re-emit ────────────────────────────────────────────

{
  installBrowser({ sampleRate: 16000 });
  const t = new VoiceTransport();
  const ws = await initOk(t);
  const ended = [];
  t.on("ended", (e) => ended.push(e));
  ws._message(JSON.stringify({ t: "ended", reason: "remote" }));
  deep(ended, [{ reason: "remote" }], "ended reason passes through");
  t.dispose();
  restoreBrowser();
}

// ── getUsage: zeros shape, then cached server frame ───────────────────────

{
  installBrowser({ sampleRate: 16000 });
  const t = new VoiceTransport();
  const ws = await initOk(t);
  deep(t.getUsage(), zeroUsage(), "zeros shape before any usage frame");
  const usage = {
    stt: { model: "@cf/deepgram/flux", audioMinutes: 12.4, neurons: 8680 },
    tts: { model: "@cf/deepgram/aura-1", chars: 8230, cachedChars: 100, neurons: 11224 },
    turn: { model: "@cf/pipecat-ai/smart-turn-v2", audioMinutes: 45, neurons: 23 },
  };
  ws._message(JSON.stringify({ t: "usage", req: "r1", usage }));
  deep(t.getUsage(), usage, "latest usage frame cached");
  t.dispose();
  restoreBrowser();
}

// ── 16kHz -> 48kHz linear upsample ─────────────────────────────────────────

{
  installBrowser({ sampleRate: 48000 });
  const t = new VoiceTransport();
  const ws = await initOk(t);
  const p = t.speak("hi");
  const speakMsg = ws.sentJson().find((m) => m.t === "speak");
  ws._message(new Int16Array(960).buffer);
  await tick();
  const src = MockSource.instances.at(-1);
  eq(src.buffer.length, 2880, "960 samples @16kHz -> 2880 @48kHz");
  t.cancelSpeech();
  await assert.rejects(() => p); N++;
  t.dispose();
  restoreBrowser();
}

// ── dispose: hangup sent, socket closed, idempotent ────────────────────────

{
  installBrowser({ sampleRate: 16000 });
  const t = new VoiceTransport();
  const ws = await initOk(t);
  t.dispose();
  deep(ws.sentJson().at(-1), { t: "hangup" }, "hangup sent on dispose");
  eq(ws.readyState, 3, "socket closed on dispose");
  t.dispose(); // idempotent, no throw
  ok(true, "dispose idempotent");
  restoreBrowser();
}

// ── on() unknown event throws ─────────────────────────────────────────────

{
  installBrowser();
  const t = new VoiceTransport();
  assert.throws(() => t.on("nope", () => {}), /unknown event/); N++;
  t.dispose();
  restoreBrowser();
}

console.log(`All ${N} voice-transport assertions passed.`);
