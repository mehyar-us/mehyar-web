/**
 * Browser WebAudio plumbing for avatar lip-sync.
 *
 * Two sources, matching playSpeech(audio: ArrayBuffer | HTMLAudioElement):
 *   - ArrayBuffer: decoded via decodeAudioData, played through an
 *     AudioBufferSourceNode.
 *   - HTMLAudioElement: routed through createMediaElementSource (we take over
 *     playback via el.play()).
 *
 * In both cases the graph is source -> AnalyserNode -> destination, and
 * getFeatures() reads the analyser every animation frame using the pure
 * functions in lip-sync.ts (the same code the Node tests run against PCM).
 *
 * Failure modes (AvatarAudioError codes):
 *   - decode:   ArrayBuffer was not decodable audio.
 *   - cors:     the <audio> element's resource is cross-origin without CORS
 *               headers, so it cannot be analyzed. The avatar degrades to
 *               state-only animation (no fake mouth movement).
 *   - autoplay: the AudioContext stayed suspended (no user gesture yet).
 *   - aborted:  a newer playSpeech() superseded this one.
 */
import {
  computeTimeFeatures,
  computeSpectralFeatures,
  type AudioFeatures,
} from "./lip-sync.js";
import { AvatarAudioError } from "./types.js";

export interface AttachOpts {
  /**
   * When false, the audio graph ends in a zero-gain node: the analyser
   * still sees the full signal (lip-sync works) but nothing is audible.
   * For the integration where the voice transport plays the audible copy.
   */
  audible?: boolean;
}

export interface AttachedAudio {
  engine: AudioEngine;
  /** Resolves when playback ends naturally; rejects on error/abort. */
  done: Promise<void>;
  /** ms spent in decodeAudioData (buffer path); -1 when N/A. D5 telemetry. */
  decodeMs?: number;
}

function wireOutput(ctx: AudioContext, analyser: AnalyserNode, audible: boolean): void {
  analyser.connect(ctx.destination);
  if (!audible) {
    // Re-route through zero gain: keep the analyser fed, stay silent.
    try {
      analyser.disconnect();
    } catch {
      /* was not connected */
    }
    const g = ctx.createGain();
    g.gain.value = 0;
    analyser.connect(g);
    g.connect(ctx.destination);
  }
}

export interface AudioEngine {
  getFeatures(): AudioFeatures;
  stop(): void;
  dispose(): void;
}

const FFT_SIZE = 2048;

// ---------------------------------------------------------------------------
// Shared AudioContext (D5 latency).
// Creating the first AudioContext initializes the platform audio subsystem,
// which can cost hundreds of ms — so we create ONE context, warmed at
// mountAvatar() time (creation needs no user gesture; only resume/start
// do), and reuse it across playSpeech() calls. It is closed on dispose().
// ---------------------------------------------------------------------------
let sharedCtx: AudioContext | null = null;

function newAudioContext(): AudioContext {
  const w = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const AC = w.AudioContext ?? w.webkitAudioContext;
  if (!AC) throw new AvatarAudioError("unsupported", "Web Audio is not available in this browser.");
  return new AC();
}

/**
 * D5: warm up the shared AudioContext at mount time. Safe to call repeatedly;
 * never throws (a failed warmup just means the first playSpeech pays init).
 * Returns the warmup cost in ms, or -1 if unavailable.
 */
export function warmupAudio(): number {
  if (sharedCtx) return 0;
  if (typeof window === "undefined") return -1;
  const t0 = performance.now();
  try {
    sharedCtx = newAudioContext();
    return performance.now() - t0;
  } catch {
    sharedCtx = null;
    return -1;
  }
}

/** Close the shared context (called by mountAvatar dispose). */
export function closeSharedAudio(): void {
  const ctx = sharedCtx;
  sharedCtx = null;
  if (ctx) ctx.close().catch(() => undefined);
}

/**
 * Prime the audio pipeline from a user gesture (e.g. the "Join call" click).
 * Warms the shared AudioContext, resumes it, AND plays 120ms of silent
 * audio through the destination at zero gain — this forces the platform's
 * audio render path to spin up now, so the first playSpeech() never pays
 * the spin-up cost (measured ~1.5-2.5s in constrained environments).
 * Never throws. Infra crew: call this in the join handler.
 */
export async function primeAvatarAudio(): Promise<void> {
  try {
    warmupAudio();
    const ctx = sharedCtx;
    if (!ctx) return;
    if (ctx.state === "suspended") {
      await ctx.resume().catch(() => undefined);
    }
    // Spin up the render path with inaudible silence.
    const len = Math.floor(ctx.sampleRate * 0.12);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(g);
    g.connect(ctx.destination);
    const ended = new Promise<void>((r) => {
      src.onended = () => r();
      setTimeout(() => r(), 500);
    });
    src.start();
    await ended;
    src.disconnect();
    g.disconnect();
  } catch {
    /* warmup is best-effort */
  }
}

function getCtx(): AudioContext {
  if (!sharedCtx) {
    warmupAudio();
    if (!sharedCtx) {
      throw new AvatarAudioError("unsupported", "Web Audio is not available in this browser.");
    }
  }
  return sharedCtx;
}

async function ensureRunning(ctx: AudioContext): Promise<void> {
  if (ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch {
      /* fall through to the state check below */
    }
  }
  if (ctx.state === "suspended") {
    throw new AvatarAudioError(
      "autoplay",
      "Audio is blocked until the user interacts with the page (browser autoplay policy). Call playSpeech from a user gesture.",
    );
  }
}

class AnalyserEngine {
  private analyser: AnalyserNode;
  private timeData: Float32Array;
  private freqDb: Float32Array;
  private mags: Float32Array;
  private prevMags: Float32Array | null = null;
  private stopped = false;

  constructor(analyser: AnalyserNode) {
    this.analyser = analyser;
    this.timeData = new Float32Array(analyser.fftSize);
    this.freqDb = new Float32Array(analyser.frequencyBinCount);
    this.mags = new Float32Array(analyser.frequencyBinCount);
  }

  getFeatures(): AudioFeatures {
    if (this.stopped) {
      return { rms: 0, centroid: 0, flux: 0, zcr: 0, low: 0, mid: 0, high: 0, silent: true };
    }
    this.analyser.getFloatTimeDomainData(this.timeData);
    this.analyser.getFloatFrequencyData(this.freqDb);
    const { rms, zcr } = computeTimeFeatures(this.timeData);
    for (let k = 0; k < this.mags.length; k++) {
      const db = this.freqDb[k];
      this.mags[k] = db <= -100 ? 0 : Math.pow(10, db / 20);
    }
    const spec = computeSpectralFeatures(
      this.mags,
      this.analyser.context.sampleRate,
      this.analyser.fftSize,
    );
    let flux = 0;
    if (this.prevMags) {
      let num = 0;
      let den = 0;
      for (let k = 1; k < this.mags.length; k++) {
        const d = Math.max(0, this.mags[k] - (this.prevMags[k] ?? 0));
        num += d * d;
        den += this.mags[k] * this.mags[k];
      }
      // Raw 0..1, no arbitrary gain (see lip-sync.ts: the plosive trigger
      // adapts to the signal's own flux baseline).
      flux = den > 1e-12 ? Math.min(1, Math.sqrt(num / den)) : 0;
    }
    this.prevMags = this.mags.slice();
    const silent = rms < 0.012 && spec.mid < 0.05;
    return {
      rms, zcr, centroid: spec.centroid, flux,
      low: spec.low, mid: spec.mid, high: spec.high, silent,
    };
  }

  markStopped(): void {
    this.stopped = true;
  }

  dispose(): void {
    this.stopped = true;
    try {
      this.analyser.disconnect();
    } catch {
      /* already disconnected */
    }
  }
}

export async function attachBufferAudio(audio: ArrayBuffer, opts: AttachOpts = {}): Promise<AttachedAudio> {
  const ctx = getCtx();
  await ensureRunning(ctx);
  let decoded: AudioBuffer;
  const d0 = performance.now();
  try {
    decoded = await ctx.decodeAudioData(audio.slice(0));
  } catch {
    // Shared context stays open; only this attach failed.
    throw new AvatarAudioError("decode", "Could not decode the audio data (unsupported or corrupt).");
  }
  const decodeMs = performance.now() - d0;
  const src = ctx.createBufferSource();
  src.buffer = decoded;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  analyser.smoothingTimeConstant = 0; // we do our own smoothing
  src.connect(analyser);
  wireOutput(ctx, analyser, opts.audible !== false);
  const base = new AnalyserEngine(analyser);

  let settled = false;
  let onEnded: () => void = () => undefined;
  let onError: (e: Error) => void = () => undefined;
  const done = new Promise<void>((resolve, reject) => {
    onEnded = () => { if (!settled) { settled = true; resolve(); } };
    onError = (e) => { if (!settled) { settled = true; reject(e); } };
  });
  src.onended = () => {
    base.markStopped();
    onEnded();
  };
  const stopAll = () => {
    if (settled) return;
    settled = true;
    try {
      src.onended = null;
      src.stop();
    } catch {
      /* already stopped */
    }
    base.markStopped();
    base.dispose();
    onError(new AvatarAudioError("aborted", "Playback was superseded by a newer playSpeech call."));
  };
  const engine: AudioEngine = {
    getFeatures: () => base.getFeatures(),
    stop: stopAll,
    dispose: stopAll,
  };
  src.start();
  return { engine, done, decodeMs };
}

export async function attachElementAudio(el: HTMLAudioElement, opts: AttachOpts = {}): Promise<AttachedAudio> {
  const ctx = getCtx();
  await ensureRunning(ctx);
  let src: MediaElementAudioSourceNode;
  try {
    src = ctx.createMediaElementSource(el);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new AvatarAudioError(
      /secure|taint|cors/i.test(msg) ? "cors" : "unsupported",
      "Could not tap the audio element for analysis (" + msg + "). " +
        "Lip-sync needs same-origin or CORS-enabled audio; the avatar will animate state only.",
    );
  }
  const analyser = ctx.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  analyser.smoothingTimeConstant = 0;
  src.connect(analyser);
  wireOutput(ctx, analyser, opts.audible !== false);
  const base = new AnalyserEngine(analyser);

  let settled = false;
  let onEnded: () => void = () => undefined;
  let onError: (e: Error) => void = () => undefined;
  const done = new Promise<void>((resolve, reject) => {
    onEnded = () => { if (!settled) { settled = true; resolve(); } };
    onError = (e) => { if (!settled) { settled = true; reject(e); } };
  });
  const cleanup = () => {
    el.removeEventListener("ended", handleEnded);
    el.removeEventListener("pause", handlePause);
    el.removeEventListener("error", handleError);
    base.dispose();
    try {
      src.disconnect();
    } catch {
      /* noop */
    }
    // Shared context stays open for the next utterance.
  };
  const handleEnded = () => { base.markStopped(); onEnded(); cleanup(); };
  const handlePause = () => { if (!el.ended) { base.markStopped(); onEnded(); cleanup(); } };
  const handleError = () => {
    onError(new AvatarAudioError("decode", "The audio element failed to load or play."));
    cleanup();
  };
  el.addEventListener("ended", handleEnded);
  el.addEventListener("pause", handlePause);
  el.addEventListener("error", handleError);

  try {
    await el.play();
  } catch (e) {
    cleanup();
    const name = e instanceof Error ? e.name : "";
    throw new AvatarAudioError(
      name === "NotAllowedError" ? "autoplay" : "unsupported",
      "The browser refused to start audio playback. Call playSpeech from a user gesture.",
    );
  }
  const stopAll = () => {
    if (!settled) {
      settled = true;
      try {
        el.pause();
      } catch {
        /* noop */
      }
      base.markStopped();
      onError(new AvatarAudioError("aborted", "Playback was superseded by a newer playSpeech call."));
    }
    cleanup();
  };
  const engine: AudioEngine = {
    getFeatures: () => base.getFeatures(),
    stop: stopAll,
    dispose: stopAll,
  };
  return { engine, done };
}

/** Default factory used by mountAvatar; overridable via opts for tests. */
export async function defaultAudioFactory(
  audio: ArrayBuffer | HTMLAudioElement,
  opts: AttachOpts = {},
): Promise<AttachedAudio> {
  return audio instanceof ArrayBuffer
    ? attachBufferAudio(audio, opts)
    : attachElementAudio(audio, opts);
}
