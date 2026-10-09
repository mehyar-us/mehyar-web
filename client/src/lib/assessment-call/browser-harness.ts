/**
 * Headless-browser test harness (vanilla TS, no React).
 *
 * Loaded by client/avatar-demo.html under vite dev. Mounts the avatar with
 * the exact mountAvatar() contract, exposes hooks on window for the
 * Playwright driver, and records latency/FPS metrics.
 */
import { mountAvatar, primeAvatarAudio } from "./mayor-avatar.js";
import { synthesizeSpeechLikeWav } from "./stub-audio.js";
import type { AvatarHandle, AvatarReadyMetrics, AvatarState } from "./types.js";

declare global {
  interface Window {
    __avatar: AvatarHarness;
  }
}

export interface PlayMetrics {
  /** ms from playSpeech() call to the synchronous speaking-state switch. */
  callToSpeakingMs: number;
  /** ms spent in decodeAudioData for this clip (real browser decode). */
  decodeMs: number;
  /** ms from playSpeech() call to the first rendered tick with jawOpen > 0.1. */
  callToFirstMouthMs: number;
}

interface AvatarHarness {
  ready: boolean;
  handle: AvatarHandle | null;
  metrics: AvatarReadyMetrics | null;
  fpsSamples: number[];
  pixelRatioReductions: number[];
  lastDecodeMs: number;
  playing: boolean;
  lastPlay: PlayMetrics | null;
  jawTrace: number[];
  setState(s: AvatarState): void;
  prime(): Promise<void>;
  playSynthetic(): Promise<PlayMetrics>;
  playWavBase64(b64: string): Promise<PlayMetrics>;
}

function b64ToBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

// ---- first-mouth sampler -------------------------------------------------
// Records the first animation tick where the jaw actually opens, so the
// driver can measure playSpeech() -> visible mouth movement end to end.
let playT0 = -1;
let firstMouthAt = -1;
let latestJawOpen = 0;

function samplerLoop() {
  if (playT0 >= 0 && firstMouthAt < 0 && latestJawOpen > 0.1) {
    firstMouthAt = performance.now();
  }
  requestAnimationFrame(samplerLoop);
}

async function playBuffer(buf: ArrayBuffer, handle: AvatarHandle): Promise<PlayMetrics> {
  playT0 = performance.now();
  firstMouthAt = -1;
  harness.playing = true;
  const p = handle.playSpeech(buf);
  const callToSpeakingMs = performance.now() - playT0;
  const deadline = playT0 + 8000;
  while (firstMouthAt < 0 && performance.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10));
  }
  await p;
  const out: PlayMetrics = {
    callToSpeakingMs,
    decodeMs: harness.lastDecodeMs,
    callToFirstMouthMs: firstMouthAt >= 0 ? firstMouthAt - playT0 : -1,
  };
  playT0 = -1;
  harness.playing = false;
  harness.lastPlay = out;
  return out;
}

const stage = document.getElementById("stage") ?? document.body;
const params = new URLSearchParams(location.search);
const nullRenderer = params.get("null") === "1";

// Jaw trajectory trace for lip-sync validation (sampled while playing).
const jawTrace: number[] = [];
setInterval(() => {
  if (harness.playing && jawTrace.length < 900) jawTrace.push(Math.round(latestJawOpen * 1000) / 1000);
}, 100);

const harness: AvatarHarness = {
  ready: false,
  handle: null,
  metrics: null,
  fpsSamples: [],
  pixelRatioReductions: [],
  lastDecodeMs: -1,
  playing: false,
  lastPlay: null,
  jawTrace,
  setState(s: AvatarState) {
    harness.handle?.setState(s);
  },
  async prime() {
    await primeAvatarAudio();
  },
  async playSynthetic() {
    if (!harness.handle) throw new Error("avatar not ready");
    return playBuffer(synthesizeSpeechLikeWav(6), harness.handle);
  },
  async playWavBase64(b64: string) {
    if (!harness.handle) throw new Error("avatar not ready");
    return playBuffer(b64ToBuffer(b64), harness.handle);
  },
};
window.__avatar = harness;

const handle = mountAvatar(stage as HTMLElement, {
  forceNullRenderer: nullRenderer,
  onReady: (m) => {
    harness.metrics = m;
    harness.ready = true;
  },
  onFps: (fps) => {
    harness.fpsSamples.push(fps);
    if (harness.fpsSamples.length > 180) harness.fpsSamples.shift();
  },
  onPixelRatioReduced: (pr) => harness.pixelRatioReductions.push(pr),
  onViseme: (w) => {
    latestJawOpen = w.jawOpen;
  },
  onAudioAttached: (info) => {
    harness.lastDecodeMs = info.decodeMs;
  },
});
harness.handle = handle;
samplerLoop();
