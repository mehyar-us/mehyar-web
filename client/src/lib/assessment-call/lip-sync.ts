/**
 * Lip-sync engine for the assessment-call avatar.
 *
 * HONEST SCOPE: this is prosody-driven pseudo-lip-sync, NOT phoneme-accurate
 * lip-sync. The TTS backend we use (internal Meta `tts` CLI -> MP3) emits no
 * viseme/timing metadata, and shipping a client-side phoneme aligner heavy
 * enough to be accurate would blow the mid-range-phone frame budget. So the
 * mouth is driven by real-time audio features:
 *
 *   - RMS energy        -> jaw opening (loud = open)
 *   - spectral centroid -> vowel shaping (low = open "ah", high = spread "ee"/sibilant)
 *   - spectral flux     -> onset/plosive detection (brief lip press on b/p/m-like bursts)
 *   - zero-crossing     -> helps separate sibilants (teeth together, lips spread)
 *
 * What this gets right: syllable-rate mouth pulsing (~4-6 Hz), jaw tracks
 * speech energy, mouth closes in pauses. What it does NOT do: match exact
 * phonemes. Documented as such in docs/assessment-call-avatar.md.
 *
 * All functions here are pure and deterministic (no DOM, no WebGL, no
 * WebAudio) so they run unmodified in Node tests, including against real
 * TTS audio decoded to PCM.
 */

export interface AudioFeatures {
  /** RMS energy of the frame, 0..1 (calibrated so conversational speech peaks ~0.3-0.6). */
  rms: number;
  /** Spectral centroid normalized 0..1 (0 = all energy at DC, 1 = Nyquist). */
  centroid: number;
  /** Spectral flux vs previous frame, 0..1 (onset strength). */
  flux: number;
  /** Zero-crossing rate normalized 0..1. */
  zcr: number;
  /** Band energies 0..1: low (<500Hz), mid (500-4kHz), high (>4kHz). */
  low: number;
  mid: number;
  high: number;
  /** True when the frame is effectively silent. */
  silent: boolean;
}

/** Blend-space weights consumed by the 3D head's mouth rig. All 0..1. */
export interface VisemeWeights {
  jawOpen: number;
  mouthWide: number;
  mouthRound: number;
  lipPress: number;
  /** Baseline friendliness, driven by call state (not by audio). */
  smile: number;
}

export const SILENCE_VISENE: VisemeWeights = {
  jawOpen: 0, mouthWide: 0, mouthRound: 0, lipPress: 0, smile: 0,
};

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Time-domain features from raw PCM (or AnalyserNode time-domain data). */
export function computeTimeFeatures(timeData: Float32Array): { rms: number; zcr: number } {
  let sum = 0;
  let crossings = 0;
  let prev = timeData[0] ?? 0;
  for (let i = 0; i < timeData.length; i++) {
    const s = timeData[i];
    sum += s * s;
    if ((prev >= 0 && s < 0) || (prev < 0 && s >= 0)) crossings++;
    prev = s;
  }
  const rms = Math.sqrt(sum / Math.max(1, timeData.length));
  // Normalize ZCR: speech sibilants hit ~0.3-0.5 crossings/sample at 48kHz
  // on 1024-sample frames; map generously and clamp.
  const zcr = clamp01(crossings / Math.max(1, timeData.length) / 0.45);
  return { rms: clamp01(rms * 3.2), zcr };
}

export interface SpectralFeatures {
  centroid: number;
  low: number;
  mid: number;
  high: number;
}

/**
 * Spectral features from LINEAR magnitudes (not dB). `magnitudes[k]`
 * corresponds to bin k of an fftSize-point spectrum at sampleRate.
 */
export function computeSpectralFeatures(
  magnitudes: Float32Array,
  sampleRate: number,
  fftSize: number,
): SpectralFeatures {
  const n = magnitudes.length;
  let sumMag = 0;
  let sumWeighted = 0;
  let low = 0, mid = 0, high = 0;
  const binHz = sampleRate / fftSize;
  for (let k = 1; k < n; k++) {
    const m = magnitudes[k];
    const hz = k * binHz;
    sumMag += m;
    sumWeighted += m * k;
    if (hz < 500) low += m;
    else if (hz < 4000) mid += m;
    else high += m;
  }
  const total = low + mid + high;
  const centroid = sumMag > 1e-9 ? sumWeighted / sumMag / n : 0;
  const norm = (v: number) => (total > 1e-9 ? clamp01((v / total) * 2.4) : 0);
  return { centroid: clamp01(centroid), low: norm(low), mid: norm(mid), high: norm(high) };
}

/**
 * Stateless mapping: audio features -> viseme blend weights.
 * Deterministic; smoothing lives in VisemeEngine.
 */
export function featuresToViseme(f: AudioFeatures): VisemeWeights {
  if (f.silent || f.rms < 0.015) return { ...SILENCE_VISENE };

  // Jaw: energy-driven, compressed so conversational speech sits mid-range and
  // shouts don't peg. Calibration anchor: real TTS speech has normalized
  // frame RMS p50 ~0.09 / p95 ~0.28; this maps those to jaw ~0.36 / ~0.80.
  // High-centroid frames (sibilants) pull the jaw toward teeth-together;
  // low-centroid frames (open vowels) push it open.
  const energy = Math.pow(clamp01(f.rms * 2.6), 0.7);
  const openBias = 1 - 0.55 * clamp01((f.centroid - 0.45) / 0.4); // high centroid -> less open
  const lowBoost = 1 + 0.35 * clamp01((0.3 - f.centroid) / 0.3); // low centroid -> more open
  const jawOpen = clamp01(energy * openBias * lowBoost);

  // Wide/spread mouth ("ee", sibilants): high centroid + high ZCR.
  const mouthWide = clamp01(
    0.75 * clamp01((f.centroid - 0.5) / 0.35) * clamp01(0.35 + f.zcr) +
      0.45 * clamp01((f.high - 0.45) / 0.4),
  );

  // Rounded mouth ("oo"/"oh"): low-mid centroid with real energy, and NOT
  // a sibilant (zcr low). Bell response peaking around centroid 0.22.
  const roundBell = Math.exp(-Math.pow((f.centroid - 0.22) / 0.16, 2));
  const mouthRound = clamp01(roundBell * clamp01(energy * 1.4) * (1 - f.zcr * 0.7) * (1 - mouthWide * 0.6));

  // Lip press (b/p/m-like closures): only ABOVE-BASELINE flux presses.
  // Flux is normalized 0..1 with typical speech sitting ~0.3-0.5, so the
  // 0.5 dead-zone keeps normal vowel flow from pressing the lips; genuine
  // onset bursts (0.7+) drive the closure. The envelope is applied in
  // VisemeEngine; here we just emit the trigger strength.
  const lipPress = clamp01((f.flux - 0.5) * 2.0) * clamp01(1.2 - energy);

  return { jawOpen, mouthWide, mouthRound, lipPress, smile: 0 };
}

export interface VisemeEngineOpts {
  /** Expected syllables/sec; adapts articulation speed. Null = default. */
  syllableRate?: number | null;
}

/**
 * Stateful smoother + plosive envelope around featuresToViseme.
 *
 * - Fast attack / slower release (mouths open faster than they close).
 * - Plosive trigger: a flux spike emits a 120ms lip-press envelope that
 *   forces the jaw shut — the visible "b/p/m" closure.
 * - Silence: everything decays to closed within ~120ms.
 */
export class VisemeEngine {
  private prev: VisemeWeights = { ...SILENCE_VISENE };
  private pressEnv = 0; // 0..1 remaining lip-press envelope
  private prevFlux = 0;
  private fluxEma = 0.3; // slow baseline of flux; plosives must beat it clearly
  private attackMs: number;
  private releaseMs: number;

  constructor(opts: VisemeEngineOpts = {}) {
    const rate = opts.syllableRate ?? 4.5;
    // Faster speech -> snappier articulation. Heuristic, documented.
    this.attackMs = Math.min(90, Math.max(30, 110 - rate * 12));
    this.releaseMs = Math.min(220, Math.max(80, 240 - rate * 22));
  }

  get timeConstantsMs(): { attackMs: number; releaseMs: number } {
    return { attackMs: this.attackMs, releaseMs: this.releaseMs };
  }

  update(f: AudioFeatures, dtMs: number): VisemeWeights {
    const target = featuresToViseme(f);
    const dt = Math.max(1, dtMs);

    // Plosive envelope: trigger on a flux spike that clearly beats the
    // signal's own baseline (adaptive — different voices/mics have
    // different flux floors). The envelope bypasses smoothing: it IS the
    // fast path, decaying over ~120ms.
    const fluxRise = f.flux - this.prevFlux;
    const energyNow = Math.pow(clamp01(f.rms * 2.6), 0.7);
    if (
      f.flux > 0.3 &&
      f.flux > this.fluxEma * 1.9 &&
      fluxRise > 0.05 &&
      energyNow > 0.04 &&
      energyNow < 0.75
    ) {
      this.pressEnv = 1;
    }
    this.prevFlux = f.flux;
    this.fluxEma += (f.flux - this.fluxEma) * (1 - Math.exp(-dt / 400));
    this.pressEnv = Math.max(0, this.pressEnv - dt / 120);

    const out: VisemeWeights = { ...this.prev };
    const keys: Array<keyof VisemeWeights> = ["jawOpen", "mouthWide", "mouthRound", "lipPress", "smile"];
    for (const k of keys) {
      const t = target[k];
      const p = this.prev[k];
      // Asymmetric smoothing: attack fast, release slow. Lip-press always fast.
      const tc = t > p || k === "lipPress" ? this.attackMs : this.releaseMs;
      const a = 1 - Math.exp(-dt / tc);
      out[k] = p + (t - p) * a;
    }
    // The envelope bypasses smoothing — a triggered closure is immediate.
    out.lipPress = Math.max(out.lipPress, this.pressEnv);
    // A pressed lip forces the jaw shut — the visible closure. Applied to
    // the OUTPUT ONLY: the stored state keeps the unsuppressed value so the
    // suppression does not compound across frames (fixed-point bug).
    const suppressed: VisemeWeights = { ...out, jawOpen: out.jawOpen * (1 - out.lipPress * 0.9) };
    this.prev = out;
    return suppressed;
  }

  reset(): void {
    this.prev = { ...SILENCE_VISENE };
    this.pressEnv = 0;
    this.prevFlux = 0;
    this.fluxEma = 0.3;
  }
}

/**
 * Rough syllable-rate estimate from a transcript: vowel-group count divided
 * by an estimated duration (150 wpm -> 0.4s/word). Used ONLY as a
 * syllableRate prior for VisemeEngine. Returns null when unusable.
 */
export function estimateSyllableRate(text: string | null | undefined): number | null {
  if (!text) return null;
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return null;
  let syllables = 0;
  for (const w of words) {
    const groups = w.toLowerCase().replace(/[^a-z]/g, "").match(/[aeiouy]+/g);
    syllables += Math.max(1, groups ? groups.length : 1);
  }
  const estSecs = words.length * 0.4;
  const rate = syllables / estSecs;
  return rate > 1 && rate < 12 ? rate : null;
}

// ---------------------------------------------------------------------------
// Minimal radix-2 FFT (test/offline path): turns PCM into linear magnitudes
// so Node tests can run the exact same spectral code as the browser.
// ---------------------------------------------------------------------------

export function fftMagnitudes(samples: Float32Array, fftSize = 1024): Float32Array {
  const n = fftSize;
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  const len = Math.min(samples.length, n);
  // Hann window to tame leakage.
  for (let i = 0; i < len; i++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / len));
    re[i] = samples[i] * w;
  }
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const t = re[i]; re[i] = re[j]; re[j] = t;
      const u = im[i]; im[i] = im[j]; im[j] = u;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const ang = (-2 * Math.PI) / size;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += size) {
      let cwr = 1, cwi = 0;
      for (let k = 0; k < size / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + size / 2] * cwr - im[i + k + size / 2] * cwi;
        const vi = re[i + k + size / 2] * cwi + im[i + k + size / 2] * cwr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + size / 2] = ur - vr; im[i + k + size / 2] = ui - vi;
        const nwr = cwr * wr - cwi * wi;
        cwi = cwr * wi + cwi * wr;
        cwr = nwr;
      }
    }
  }
  const mags = new Float32Array(n / 2);
  for (let k = 0; k < n / 2; k++) mags[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]) / n;
  return mags;
}

export interface FrameFeatures extends AudioFeatures {}

/**
 * Offline feature extraction over PCM (Node test path / analysis tooling).
 * Frames of 1024 samples @ hop 512. Flux is computed between consecutive
 * frames; the first frame gets flux 0.
 */
export function extractFeaturesFromPCM(
  samples: Float32Array,
  sampleRate: number,
  frameSize = 1024,
  hop = 512,
): FrameFeatures[] {
  const out: FrameFeatures[] = [];
  let prevMags: Float32Array | null = null;
  for (let start = 0; start + frameSize <= samples.length; start += hop) {
    const frame = samples.subarray(start, start + frameSize);
    const { rms, zcr } = computeTimeFeatures(frame);
    const mags = fftMagnitudes(frame, frameSize);
    const spec = computeSpectralFeatures(mags, sampleRate, frameSize);
    let flux = 0;
    if (prevMags) {
      let num = 0, den = 0;
      for (let k = 1; k < mags.length; k++) {
        const d = Math.max(0, mags[k] - prevMags[k]);
        num += d * d;
        den += mags[k] * mags[k];
      }
      // No arbitrary gain: raw 0..1. Typical speech sits ~0.3-0.5; the
      // plosive trigger in VisemeEngine is adaptive to the baseline.
      flux = den > 1e-12 ? Math.min(1, Math.sqrt(num / den)) : 0;
    }
    prevMags = mags;
    const silent = rms < 0.012 && spec.mid < 0.05;
    out.push({ rms, zcr, centroid: spec.centroid, flux, low: spec.low, mid: spec.mid, high: spec.high, silent });
  }
  return out;
}
